/**
 * Bootstrap Service
 *
 * Handles the SSH-based VM bootstrap sequence:
 * 1. Wait for VM to be running + SSH available
 * 2. SSH into VM and execute bootstrap commands:
 *    a. Create workspace directory
 *    b. Clone repository
 *    c. Checkout branch if specified
 *    d. Start OpenCode via systemctl
 * 3. Poll health endpoint until ready
 * 4. Update session status
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { SSHService, SSHConfig } from "./ssh";
import { sshService } from "./ssh";
import * as schema from "../db/schema";
import { agentSessions } from "../db/schema";

export interface BootstrapConfig {
  sessionId: string;
  repoUrl: string;
  branch?: string | null;
  vmId: string;
  vmIp: string;
  sshUsername?: string;
  sshPrivateKey?: string;
  workspaceBasePath?: string;
  opencodePort?: number;
  healthPollIntervalMs?: number;
  healthPollTimeoutMs?: number;
}

export interface BootstrapResult {
  success: boolean;
  workspacePath?: string;
  errorMessage?: string;
}

export interface BootstrapService {
  bootstrap(config: BootstrapConfig): Promise<BootstrapResult>;
  waitForSSH(config: SSHConfig, timeoutMs?: number, intervalMs?: number): Promise<boolean>;
  pollHealthEndpoint(
    vmIp: string,
    port?: number,
    timeoutMs?: number,
    intervalMs?: number
  ): Promise<boolean>;
}

export class RealBootstrapService implements BootstrapService {
  private db: BetterSQLite3Database<typeof schema>;
  private sshService: SSHService;

  constructor(
    db: BetterSQLite3Database<typeof schema>,
    sshServiceInstance: SSHService = sshService
  ) {
    this.db = db;
    this.sshService = sshServiceInstance;
  }

  async bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
    const {
      sessionId,
      repoUrl,
      branch,
      vmId,
      vmIp,
      sshUsername = "agent",
      sshPrivateKey,
      workspaceBasePath = "/home/agent/workspaces",
      opencodePort = 4096,
      healthPollIntervalMs = 2000,
      healthPollTimeoutMs = 60000,
    } = config;

    const workspacePath = `${workspaceBasePath}/${sessionId}`;
    const sshConfig: SSHConfig = {
      host: vmIp,
      username: sshUsername,
      privateKey: sshPrivateKey,
    };

    try {
      // Update session with VM ID and workspace path
      const now = new Date();
      await this.db
        .update(agentSessions)
        .set({
          vmId,
          workspacePath,
          updatedAt: now,
        })
        .where(eq(agentSessions.id, sessionId));

      // Wait for SSH to be available
      const sshReady = await this.waitForSSH(sshConfig, 120000, 2000);
      if (!sshReady) {
        throw new Error("SSH connection timed out");
      }

      // Connect to VM
      const conn = await this.sshService.connect(sshConfig);

      try {
        // 1. Create workspace directory
        const mkdirResult = await this.sshService.exec(conn, `mkdir -p ${workspacePath}`);
        if (mkdirResult.code !== 0) {
          throw new Error(`Failed to create workspace: ${mkdirResult.stderr}`);
        }

        // 2. Clone repository
        const cloneResult = await this.sshService.exec(
          conn,
          `git clone ${repoUrl} ${workspacePath}`
        );
        if (cloneResult.code !== 0) {
          throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
        }

        // 3. Checkout branch if specified
        if (branch) {
          const checkoutResult = await this.sshService.exec(
            conn,
            `git -C ${workspacePath} checkout ${branch}`
          );
          if (checkoutResult.code !== 0) {
            throw new Error(`Failed to checkout branch: ${checkoutResult.stderr}`);
          }
        }

        // 4. Start OpenCode via systemctl
        const startResult = await this.sshService.exec(
          conn,
          `systemctl --user start opencode@${sessionId}`
        );
        if (startResult.code !== 0) {
          throw new Error(`Failed to start OpenCode: ${startResult.stderr}`);
        }
      } finally {
        // Always disconnect
        await this.sshService.disconnect(conn);
      }

      // 5. Poll health endpoint
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

  async waitForSSH(
    config: SSHConfig,
    timeoutMs: number = 120000,
    intervalMs: number = 2000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const isReady = await this.sshService.testConnection(config, intervalMs);
      if (isReady) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
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
}

/**
 * Mock bootstrap service for testing
 */
export interface MockBootstrapService extends BootstrapService {
  calls: {
    bootstrap: Array<{ config: BootstrapConfig }>;
    waitForSSH: Array<{ config: SSHConfig; timeoutMs: number; intervalMs: number }>;
    pollHealthEndpoint: Array<{
      vmIp: string;
      port: number;
      timeoutMs: number;
      intervalMs: number;
    }>;
  };
  clearCalls(): void;
  setBootstrapResult(result: BootstrapResult): void;
  setSSHAvailable(available: boolean): void;
  setHealthReady(ready: boolean): void;
}

export function createMockBootstrapService(): MockBootstrapService {
  const calls = {
    bootstrap: [] as Array<{ config: BootstrapConfig }>,
    waitForSSH: [] as Array<{ config: SSHConfig; timeoutMs: number; intervalMs: number }>,
    pollHealthEndpoint: [] as Array<{
      vmIp: string;
      port: number;
      timeoutMs: number;
      intervalMs: number;
    }>,
  };

  let bootstrapResult: BootstrapResult = { success: true, workspacePath: "/mock/workspace" };
  let sshAvailable = true;
  let healthReady = true;

  const service: MockBootstrapService = {
    async bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
      calls.bootstrap.push({ config });
      return bootstrapResult;
    },

    async waitForSSH(
      config: SSHConfig,
      timeoutMs: number = 120000,
      intervalMs: number = 2000
    ): Promise<boolean> {
      calls.waitForSSH.push({ config, timeoutMs, intervalMs });
      return sshAvailable;
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
      calls.waitForSSH.length = 0;
      calls.pollHealthEndpoint.length = 0;
    },

    setBootstrapResult(result: BootstrapResult) {
      bootstrapResult = result;
    },

    setSSHAvailable(available: boolean) {
      sshAvailable = available;
    },

    setHealthReady(ready: boolean) {
      healthReady = ready;
    },
  };

  return service;
}
