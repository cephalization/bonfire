/**
 * Bootstrap Service
 *
 * Handles serial-console bootstrap (no SSH):
 * 1. Claim the VM serial console (exclusive)
 * 2. Wait for a shell prompt on ttyS0 (requires autologin)
 * 3. Configure guest networking
 * 4. Create workspace + clone repo
 * 5. Start OpenCode
 * 6. Poll health endpoint until ready
 * 7. Update session status
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { agentSessions } from "../db/schema";
import { createSerialConsole } from "./firecracker";
import {
  clearActiveSerialConnection,
  hasActiveSerialConnection,
  setActiveSerialConnection,
} from "./firecracker/serial-connections";
import { createSerialRunner, type SerialRunnerLike } from "./firecracker/serial-runner";

/**
 * OpenCode configuration structure
 */
export interface OpenCodeConfig {
  share: "disabled" | "enabled";
  permission: "allow" | "deny" | "ask";
  autoupdate: boolean;
  server: {
    port: number;
    hostname: string;
  };
}

/**
 * Generate OpenCode configuration for a session
 */
export function generateOpenCodeConfig(workspacePath: string): OpenCodeConfig {
  return {
    share: "disabled",
    permission: "allow",
    autoupdate: false,
    server: {
      port: 4096,
      hostname: "0.0.0.0",
    },
  };
}

/**
 * Serialize OpenCode config for environment variable injection
 */
export function serializeOpenCodeConfig(config: OpenCodeConfig): string {
  return JSON.stringify(config);
}

export interface BootstrapConfig {
  sessionId: string;
  repoUrl: string;
  branch?: string | null;
  vmId: string;
  vmIp: string;
  workspaceBasePath?: string;
  opencodePort?: number;
  healthPollIntervalMs?: number;
  healthPollTimeoutMs?: number;
  pipeDir?: string;
}

export interface BootstrapResult {
  success: boolean;
  workspacePath?: string;
  errorMessage?: string;
}

export interface BootstrapService {
  bootstrap(config: BootstrapConfig): Promise<BootstrapResult>;
  pollHealthEndpoint(
    vmIp: string,
    port?: number,
    timeoutMs?: number,
    intervalMs?: number
  ): Promise<boolean>;
}

export interface SerialBootstrapDeps {
  /** For tests/DI: provide a runner without touching real serial pipes. */
  createRunner?: (config: { vmId: string; pipeDir?: string }) => Promise<SerialRunnerLike>;
  /** For tests/DI: override terminal/serial exclusivity check. */
  isSerialConsoleInUse?: (vmId: string) => boolean;
}

export class RealBootstrapService implements BootstrapService {
  private db: BetterSQLite3Database<typeof schema>;
  private deps: SerialBootstrapDeps;

  constructor(db: BetterSQLite3Database<typeof schema>, deps: SerialBootstrapDeps = {}) {
    this.db = db;
    this.deps = deps;
  }

  async bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
    const {
      sessionId,
      repoUrl,
      branch,
      vmId,
      vmIp,
      workspaceBasePath = "/home/agent/workspaces",
      opencodePort = 4096,
      healthPollIntervalMs = 2000,
      healthPollTimeoutMs = 60000,
      pipeDir,
    } = config;

    let workspacePath = `${workspaceBasePath}/${sessionId}`;

    if (!isValidIpv4(vmIp)) {
      throw new Error(`Invalid VM IP address: '${vmIp}'`);
    }

    try {
      // Update session with VM ID and workspace path (status remains 'creating').
      const now = new Date();
      await this.db
        .update(agentSessions)
        .set({
          vmId,
          workspacePath,
          errorMessage: "Bootstrapping: connecting serial",
          updatedAt: now,
        })
        .where(eq(agentSessions.id, sessionId));

      const { runner, cleanup } = await this.createRunnerWithCleanup({ vmId, pipeDir });
      try {
        await runner.connect();

        const isRoot = await isRunningAsRoot(runner);

        await this.updateCreatingMessage(sessionId, "Bootstrapping: configuring network");
        await execOk(
          runner,
          buildNetworkSetupCommand(vmIp),
          "Failed to configure guest networking"
        );

        await this.updateCreatingMessage(sessionId, "Bootstrapping: preparing workspace");

        const resolved = await ensureWorkspacePath(runner, {
          preferredPath: workspacePath,
          sessionId,
        });
        if (resolved.workspacePath !== workspacePath) {
          workspacePath = resolved.workspacePath;
          await this.db
            .update(agentSessions)
            .set({
              workspacePath,
              updatedAt: new Date(),
            })
            .where(eq(agentSessions.id, sessionId));
        }

        await this.updateCreatingMessage(sessionId, "Bootstrapping: cloning repo");
        await ensureGitAvailable(runner, sessionId);
        await execOk(
          runner,
          withTmpHome(`git clone ${shQuote(repoUrl)} ${shQuote(workspacePath)}`, sessionId),
          "Failed to clone repository (is it private? are credentials configured in the image?)"
        );

        if (branch) {
          await execOk(
            runner,
            withTmpHome(`git -C ${shQuote(workspacePath)} checkout ${shQuote(branch)}`, sessionId),
            "Failed to checkout branch"
          );
        }

        await this.updateCreatingMessage(sessionId, "Bootstrapping: starting OpenCode");

        const openCodeConfig = generateOpenCodeConfig(workspacePath);
        const configContent = serializeOpenCodeConfig(openCodeConfig);

        const shouldUseSystemdUser = !isRoot && workspacePath.startsWith("/home/agent/workspaces/");
        if (shouldUseSystemdUser) {
          const startCmd =
            `export OPENCODE_CONFIG_CONTENT=${shQuote(configContent)} ` +
            `&& export XDG_RUNTIME_DIR=/run/user/1000 ` +
            `&& systemctl --user import-environment OPENCODE_CONFIG_CONTENT XDG_RUNTIME_DIR ` +
            `&& systemctl --user start opencode@${sessionId}`;

          const startResult = await runner.run(startCmd);
          if (startResult.exitCode !== 0) {
            throw new Error(`Failed to start OpenCode: ${truncate(startResult.output)}`);
          }
        } else {
          const fallbackCmd =
            `cd ${shQuote(workspacePath)} ` +
            `&& ${tmpHomePrelude(sessionId)} ` +
            `export OPENCODE_SERVER_PASSWORD=${shQuote(sessionId)} OPENCODE_CONFIG_CONTENT=${shQuote(configContent)} ` +
            `&& nohup /home/agent/.opencode/bin/opencode web --port ${opencodePort} --hostname 0.0.0.0 ` +
            `> ${shQuote(`/tmp/opencode-${sessionId}.log`)} 2>&1 &`;

          await execOk(runner, `bash -lc ${shQuote(fallbackCmd)}`, "Failed to start OpenCode");
        }
      } finally {
        await cleanup();
      }

      // 5. Poll health endpoint
      await this.updateCreatingMessage(sessionId, "Bootstrapping: waiting for OpenCode health");
      const healthReady = await this.pollHealthEndpoint(
        vmIp,
        opencodePort,
        healthPollTimeoutMs,
        healthPollIntervalMs
      );

      if (!healthReady) {
        throw new Error("Health check timed out");
      }

      // Update session to ready
      await this.db
        .update(agentSessions)
        .set({
          status: "ready",
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId));

      return {
        success: true,
        workspacePath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update session to error
      await this.db
        .update(agentSessions)
        .set({
          status: "error",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId));

      return {
        success: false,
        errorMessage,
      };
    }
  }

  async pollHealthEndpoint(
    vmIp: string,
    port: number = 4096,
    timeoutMs: number = 60000,
    intervalMs: number = 2000
  ): Promise<boolean> {
    const startTime = Date.now();
    const healthUrl = `http://${vmIp}:${port}/global/health`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(healthUrl, {
          method: "GET",
        });

        if (response.ok) {
          return true;
        }
      } catch {
        // Ignore fetch errors (VM not ready yet)
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
  }

  private async updateCreatingMessage(sessionId: string, errorMessage: string): Promise<void> {
    await this.db
      .update(agentSessions)
      .set({
        // Intentionally stored in errorMessage while status=creating.
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, sessionId));
  }

  private async createRunnerWithCleanup(config: {
    vmId: string;
    pipeDir?: string;
  }): Promise<{ runner: SerialRunnerLike; cleanup: () => Promise<void> }> {
    if (this.deps.createRunner) {
      const runner = await this.deps.createRunner(config);
      return {
        runner,
        cleanup: async () => {
          await runner.close();
        },
      };
    }

    const inUse = this.deps.isSerialConsoleInUse ?? hasActiveSerialConnection;
    if (inUse(config.vmId)) {
      throw new Error("VM terminal in use");
    }

    const serialConsole = await createSerialConsole({
      vmId: config.vmId,
      pipeDir: config.pipeDir,
    });
    setActiveSerialConnection(config.vmId, serialConsole);

    const runner = await createSerialRunner({
      vmId: config.vmId,
      serialConsole,
    });

    return {
      runner,
      cleanup: async () => {
        clearActiveSerialConnection(config.vmId, serialConsole);
        await runner.close().catch(() => {});
      },
    };
  }
}

/**
 * Mock bootstrap service for testing
 */
export interface MockBootstrapService extends BootstrapService {
  calls: {
    bootstrap: Array<{ config: BootstrapConfig }>;
    pollHealthEndpoint: Array<{
      vmIp: string;
      port: number;
      timeoutMs: number;
      intervalMs: number;
    }>;
  };
  clearCalls(): void;
  setBootstrapResult(result: BootstrapResult): void;
  setHealthReady(ready: boolean): void;
}

export function createMockBootstrapService(): MockBootstrapService {
  const calls = {
    bootstrap: [] as Array<{ config: BootstrapConfig }>,
    pollHealthEndpoint: [] as Array<{
      vmIp: string;
      port: number;
      timeoutMs: number;
      intervalMs: number;
    }>,
  };

  let bootstrapResult: BootstrapResult = { success: true, workspacePath: "/mock/workspace" };
  let healthReady = true;

  const service: MockBootstrapService = {
    async bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
      calls.bootstrap.push({ config });
      return bootstrapResult;
    },

    async pollHealthEndpoint(
      vmIp: string,
      port: number = 4096,
      timeoutMs: number = 60000,
      intervalMs: number = 2000
    ): Promise<boolean> {
      calls.pollHealthEndpoint.push({ vmIp, port, timeoutMs, intervalMs });
      return healthReady;
    },

    get calls() {
      return calls;
    },

    clearCalls() {
      calls.bootstrap.length = 0;
      calls.pollHealthEndpoint.length = 0;
    },

    setBootstrapResult(result: BootstrapResult) {
      bootstrapResult = result;
    },

    setHealthReady(ready: boolean) {
      healthReady = ready;
    },
  };

  return service;
}

async function execOk(runner: SerialRunnerLike, command: string, message: string): Promise<void> {
  const result = await runner.run(command);
  if (result.exitCode !== 0) {
    throw new Error(`${message}: ${truncate(result.output)}`);
  }
}

async function isRunningAsRoot(runner: SerialRunnerLike): Promise<boolean> {
  const result = await runner.run("id -u");
  if (result.exitCode !== 0) return false;
  return result.output.trim().split(/\s+/)[0] === "0";
}

function asAgentCommand(command: string, opts: { isRoot: boolean }): string {
  const wrapped = `bash -lc ${shQuote(command)}`;
  if (!opts.isRoot) return wrapped;

  // We might be autologged in as root (or an image without sudo). Ensure workspace
  // and OpenCode run as the 'agent' user.
  const runner =
    "if command -v runuser >/dev/null 2>&1; then " +
    `runuser -u agent -- ${wrapped}; ` +
    "elif command -v su >/dev/null 2>&1; then " +
    `su - agent -c ${shQuote(command)}; ` +
    "else echo 'Neither runuser nor su is available to switch to agent user' >&2; exit 127; fi";

  return `bash -lc ${shQuote(runner)}`;
}

async function ensureWorkspacePath(
  runner: SerialRunnerLike,
  opts: { preferredPath: string; sessionId: string }
): Promise<{ workspacePath: string }> {
  const preferred = await runner.run(`mkdir -p ${shQuote(opts.preferredPath)}`);
  if (preferred.exitCode === 0) return { workspacePath: opts.preferredPath };

  if (/read-only file system/i.test(preferred.output)) {
    const fallbackPath = `/tmp/bonfire-workspaces/${opts.sessionId}`;
    const fallback = await runner.run(`mkdir -p ${shQuote(fallbackPath)}`);
    if (fallback.exitCode !== 0) {
      throw new Error(
        `Failed to create workspace (preferred path is read-only; fallback also failed): ${truncate(
          fallback.output
        )}`
      );
    }
    return { workspacePath: fallbackPath };
  }

  throw new Error(`Failed to create workspace: ${truncate(preferred.output)}`);
}

async function ensureGitAvailable(runner: SerialRunnerLike, sessionId: string): Promise<void> {
  const check = await runner.run("command -v git >/dev/null 2>&1");
  if (check.exitCode === 0) return;

  // Best-effort install. This requires a writable root filesystem.
  const script =
    "set -euo pipefail; " +
    "if command -v git >/dev/null 2>&1; then exit 0; fi; " +
    "if command -v apt-get >/dev/null 2>&1; then " +
    "  export DEBIAN_FRONTEND=noninteractive; " +
    "  apt-get update -y; " +
    "  apt-get install -y git ca-certificates; " +
    "  exit 0; " +
    "fi; " +
    "echo 'git is not installed and no supported package manager was found' >&2; " +
    "exit 127";

  const result = await runner.run(`bash -lc ${shQuote(script)}`, {
    timeoutMs: 180000,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git is not available in the VM (install failed): ${truncate(result.output)}. ` +
        `Rebuild the agent image with git preinstalled or use a writable rootfs.`
    );
  }

  // Ensure it actually exists after install.
  const verify = await runner.run("command -v git >/dev/null 2>&1");
  if (verify.exitCode !== 0) {
    throw new Error(
      `git is not available in the VM after install attempt. Rebuild the agent image with git preinstalled.`
    );
  }

  // If the VM is root and has no writable /root, ensure git won't try to write there later.
  await runner.run(withTmpHome("true", sessionId));
}

function tmpHomePrelude(sessionId: string): string {
  const base = `/tmp/bonfire-home/${sessionId}`;
  return (
    `export HOME=${shQuote(base)} ` +
    `XDG_CONFIG_HOME=${shQuote(`${base}/.config`)} ` +
    `XDG_CACHE_HOME=${shQuote(`${base}/.cache`)} ` +
    `XDG_STATE_HOME=${shQuote(`${base}/.state`)} ` +
    `XDG_DATA_HOME=${shQuote(`${base}/.local/share`)} ` +
    `&& mkdir -p ${shQuote(base)} ${shQuote(`${base}/.config`)} ${shQuote(`${base}/.cache`)} ` +
    `${shQuote(`${base}/.state`)} ${shQuote(`${base}/.local/share`)}`
  );
}

function withTmpHome(command: string, sessionId: string): string {
  return `bash -lc ${shQuote(`${tmpHomePrelude(sessionId)} && ${command}`)}`;
}

function truncate(text: string, max: number = 2000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isValidIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((p) => Number.parseInt(p, 10));
  return parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

function buildNetworkSetupCommand(vmIp: string): string {
  // Firecracker boot args do not configure guest networking.
  // Do it from serial to make SSH/health checks reachable.
  const script =
    "set -euo pipefail; " +
    'IFACE="$(ls -1 /sys/class/net | grep -v lo | head -n 1)"; ' +
    '[ -n "$IFACE" ]; ' +
    'SUDO=""; ' +
    'if [ "$(id -u)" -ne 0 ]; then ' +
    '  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; ' +
    "  else echo 'sudo not found (need passwordless sudo or root autologin on ttyS0)' >&2; exit 127; fi; " +
    "fi; " +
    '$SUDO ip link set dev "$IFACE" up; ' +
    `$SUDO ip addr add ${vmIp}/24 dev \"$IFACE\" || true; ` +
    "$SUDO ip route replace default via 10.0.100.1; " +
    // DNS: prefer systemd-resolved tooling because /etc/resolv.conf may be read-only.
    "if command -v resolvectl >/dev/null 2>&1; then " +
    '  $SUDO resolvectl dns "$IFACE" 1.1.1.1 8.8.8.8; ' +
    "  $SUDO resolvectl domain \"$IFACE\" '~.' || true; " +
    "elif command -v systemd-resolve >/dev/null 2>&1; then " +
    '  $SUDO systemd-resolve --interface="$IFACE" --set-dns=1.1.1.1 --set-dns=8.8.8.8; ' +
    "else " +
    '  if [ -w /etc/resolv.conf ]; then echo "nameserver 1.1.1.1" | $SUDO tee /etc/resolv.conf >/dev/null; ' +
    "  else echo '/etc/resolv.conf is not writable; DNS may be unavailable' >&2; fi; " +
    "fi; " +
    // Validate L2/L3 and (best-effort) DNS.
    "ping -c 1 -W 1 10.0.100.1; " +
    "if command -v getent >/dev/null 2>&1; then getent hosts github.com >/dev/null 2>&1 || true; fi";

  return `bash -lc ${shQuote(script)}`;
}
