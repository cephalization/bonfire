/**
 * Agent provisioning: get an opencode server running inside a VM.
 *
 * The agent image ships opencode (docker/Dockerfile.agent). Attaching an agent
 * to a conversation runs, over SSH as the `agent` user:
 *
 * 1. write `~/.config/opencode/opencode.json` with the organization's provider
 *    keys, permissions set to allow (the VM is the sandbox) and sharing off;
 * 2. create the conversation's workspace directory;
 * 3. start `opencode serve` on port 4096, protected by a per-VM basic-auth
 *    password, unless one is already listening.
 *
 * The API then talks to `http://<vm ip>:4096` (services/agent/opencode.ts).
 * Everything that touches the VM goes through the injected SSH service so the
 * unit tests run with the mock from services/ssh.ts.
 */

import type { SSHService } from "../ssh";

/** Username baked into the agent VM image. Matches routes/vms.ts. */
export const VM_SSH_USERNAME = "agent";
export const AGENT_SERVER_PORT = 4096;
export const AGENT_SERVER_USERNAME = "opencode";
const WORKSPACES_DIR = "/home/agent/workspaces";
const CONFIG_PATH = "/home/agent/.config/opencode/opencode.json";
const LOG_PATH = "/home/agent/.bonfire-agent.log";

export interface ProvisionAgentOptions {
  host: string;
  privateKey: string;
  sshService: SSHService;
  /** opencode provider id → API key. */
  providerKeys: Record<string, string>;
  /** Basic-auth password the server must require. */
  password: string;
  /** Directory name under the workspaces dir for this conversation. */
  workspace: string;
}

export interface ProvisionedAgent {
  /** Absolute working directory of the conversation inside the VM. */
  directory: string;
  /** True when a server was started by this call (false: reused a running one). */
  started: boolean;
}

/** The opencode configuration written into the VM. */
export function buildOpencodeConfig(providerKeys: Record<string, string>): Record<string, unknown> {
  const provider: Record<string, { options: { apiKey: string } }> = {};
  for (const [id, apiKey] of Object.entries(providerKeys)) {
    if (apiKey) provider[id] = { options: { apiKey } };
  }
  return {
    $schema: "https://opencode.ai/config.json",
    // The VM is the sandbox; asking for permission would stall a group chat.
    permission: "allow",
    share: "disabled",
    autoupdate: false,
    provider,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Validate a workspace name so it can be used unquoted in a path. */
export function isSafeWorkspaceName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name);
}

export function workspaceDirectory(workspace: string): string {
  return `${WORKSPACES_DIR}/${workspace}`;
}

/**
 * The script run over SSH. Exported so tests can check it without a VM.
 *
 * `start` restarts the server when the password changes (a stale server on the
 * port would otherwise reject every request), and is a no-op when a server
 * that accepts the password is already listening.
 */
export function buildProvisionScript(options: {
  configJson: string;
  password: string;
  workspace: string;
}): string {
  const configB64 = Buffer.from(options.configJson, "utf8").toString("base64");
  const dir = workspaceDirectory(options.workspace);
  return [
    "set -e",
    `mkdir -p ${shellQuote(dir)} "$(dirname ${CONFIG_PATH})"`,
    `umask 077`,
    `echo ${configB64} | base64 -d > ${CONFIG_PATH}`,
    `chmod 600 ${CONFIG_PATH}`,
    `OPENCODE_BIN="$(command -v opencode || true)"`,
    `[ -n "$OPENCODE_BIN" ] || OPENCODE_BIN=/home/agent/.opencode/bin/opencode`,
    `[ -x "$OPENCODE_BIN" ] || { echo "opencode is not installed in this VM" >&2; exit 3; }`,
    `if curl -sf -u ${AGENT_SERVER_USERNAME}:${shellQuote(options.password)} http://127.0.0.1:${AGENT_SERVER_PORT}/api/health >/dev/null 2>&1; then echo REUSED; exit 0; fi`,
    `pkill -f "opencode serve" >/dev/null 2>&1 || true`,
    `sleep 0.5`,
    `cd ${shellQuote(dir)}`,
    `OPENCODE_SERVER_PASSWORD=${shellQuote(options.password)} nohup setsid "$OPENCODE_BIN" serve --hostname 0.0.0.0 --port ${AGENT_SERVER_PORT} >${LOG_PATH} 2>&1 < /dev/null &`,
    `echo STARTED`,
  ].join("\n");
}

export async function provisionAgent(options: ProvisionAgentOptions): Promise<ProvisionedAgent> {
  const { host, privateKey, sshService, providerKeys, password, workspace } = options;
  if (!isSafeWorkspaceName(workspace)) {
    throw new Error(`Invalid workspace name: ${workspace}`);
  }

  const script = buildProvisionScript({
    configJson: JSON.stringify(buildOpencodeConfig(providerKeys), null, 2),
    password,
    workspace,
  });

  const conn = await sshService.connect({ host, username: VM_SSH_USERNAME, privateKey });
  try {
    const result = await sshService.exec(conn, `bash -s <<'BONFIRE_EOF'\n${script}\nBONFIRE_EOF`);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new Error(
        `Provisioning the agent failed (exit ${result.code})${detail ? `: ${detail}` : ""}`
      );
    }
    return {
      directory: workspaceDirectory(workspace),
      started: result.stdout.includes("STARTED"),
    };
  } finally {
    await sshService.disconnect(conn);
  }
}
