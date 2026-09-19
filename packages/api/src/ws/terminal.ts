import type { IncomingMessage, Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import { vms } from "../db/schema";
import { parseResizeMessage } from "../routes/terminal";
import { findMembership } from "../lib/authz";
import { resolvePrincipal, type Principal } from "../middleware/auth";
import type { Auth } from "../lib/auth";
import { loadPrivateKey } from "../services/ssh-keys";
import {
  sshService as defaultSSHService,
  type SSHService,
  type SSHShellSession,
} from "../services/ssh";
import type { TerminalTicketStore } from "../lib/terminal-tickets";

/** Username baked into the agent VM image. Matches routes/vms.ts. */
const VM_SSH_USERNAME = "agent";

/** Terminal size used until the client sends its first resize. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type PrivateKeyLoader = (vmId: string) => Promise<string | null>;

export type TerminalWsConfig = {
  db: BetterSQLite3Database<typeof schema>;
  auth: Auth;
  ticketStore: TerminalTicketStore;
  /** Injected so tests can drive the bridge without a VM. */
  sshService?: SSHService;
  loadPrivateKeyFn?: PrivateKeyLoader;
};

function extractVmIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/api\/vms\/([^/]+)\/terminal$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function headersFromNodeRequest(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return headers;
}

export type UpgradeAuthenticator = {
  ticketStore: TerminalTicketStore;
  /** Resolves a principal from the handshake headers (cookie or X-API-Key). */
  resolvePrincipalFn: (headers: Headers) => Promise<Principal | null>;
  /** Whether that principal belongs to the VM's organization. */
  isMemberFn: (userId: string, organizationId: string) => Promise<boolean>;
};

/**
 * Authenticate a WebSocket upgrade for a VM.
 *
 * Two accepted forms: a single-use `ticket` query parameter, minted by an
 * already-authorized POST (see lib/terminal-tickets.ts), or ordinary request
 * credentials, an X-API-Key header or the session cookie, in which case the
 * principal must be a member of the VM's organization. Browsers use tickets
 * because they cannot set headers on a handshake and may be cross-origin.
 */
export async function authenticateUpgrade(
  url: URL,
  headers: Headers,
  vm: { id: string; organizationId: string | null },
  authenticator: UpgradeAuthenticator
): Promise<boolean> {
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    return authenticator.ticketStore.redeem(ticket, vm.id);
  }

  if (!vm.organizationId) return false;

  const principal = await authenticator.resolvePrincipalFn(headers);
  if (!principal) return false;

  return authenticator.isMemberFn(principal.user.id, vm.organizationId);
}

/**
 * Bridge an open WebSocket to a PTY shell on the VM.
 *
 * Protocol, matching web/src/components/Terminal.tsx:
 * - server sends `{"ready":true}` once the shell is open, then raw output
 * - server sends `{"error":"..."}` for anything the user should see
 * - client sends raw input, or `{"resize":{"cols":N,"rows":N}}`
 *
 * Exported for tests; the WebSocket is treated as a minimal duck type so a
 * fake can stand in for a real socket.
 */
export async function bridgeShellToWebSocket(
  ws: Pick<WebSocket, "send" | "close" | "on">,
  options: {
    host: string;
    privateKey: string;
    sshService: SSHService;
    onClosed?: () => void;
  }
): Promise<void> {
  const { host, privateKey, sshService } = options;

  let shell: SSHShellSession | null = null;
  let conn: Awaited<ReturnType<SSHService["connect"]>> | null = null;
  let teardownDone = false;

  const teardown = () => {
    if (teardownDone) return;
    teardownDone = true;
    try {
      shell?.close();
    } catch {
      // The shell may already be gone; nothing useful to do.
    }
    if (conn) {
      void sshService.disconnect(conn).catch(() => {
        // Best effort: the VM may have died underneath us.
      });
    }
    options.onClosed?.();
  };

  // A client that hangs up before or during SSH setup must still release the
  // VM's terminal slot, so register teardown before any await.
  ws.on("close", () => {
    teardown();
    try {
      ws.close();
    } catch {
      // Already closing.
    }
  });
  ws.on("error", teardown);

  try {
    conn = await sshService.connect({
      host,
      username: VM_SSH_USERNAME,
      privateKey,
    });

    shell = await sshService.shell(conn, {
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
  } catch (error) {
    ws.send(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to open shell on VM",
      })
    );
    teardown();
    ws.close();
    return;
  }

  // The client clears its screen on `ready` and ignores anything before it, so
  // this must be sent before the first byte of shell output.
  ws.send(JSON.stringify({ ready: true }));

  shell.onData((chunk) => {
    try {
      ws.send(chunk);
    } catch {
      // Socket went away mid-write; the close handler will tear down.
    }
  });

  shell.onClose(() => {
    teardown();
    try {
      ws.close();
    } catch {
      // Already closing.
    }
  });

  ws.on("message", (raw: unknown) => {
    const data = typeof raw === "string" ? raw : String(raw);

    // Control messages are JSON; everything else is keystrokes. Only attempt a
    // parse when it could plausibly be a control frame, so that typing a `{`
    // into the shell is not swallowed.
    if (data.startsWith("{")) {
      const resize = parseResizeMessage(data);
      if (resize) {
        shell?.resize(resize.cols, resize.rows);
        return;
      }
    }

    shell?.write(data);
  });
}

export function attachTerminalWebSocketServer(server: Server, wsConfig: TerminalWsConfig): void {
  const wss = new WebSocketServer({ noServer: true });
  const sshService = wsConfig.sshService ?? defaultSSHService;
  const loadKey = wsConfig.loadPrivateKeyFn ?? ((vmId: string) => loadPrivateKey(vmId));

  // A VM has one pty slot at a time; the OpenAPI contract documents 409 for a
  // second connection and the e2e suite asserts it.
  const activeConnections = new Set<string>();

  /** Accept the upgrade purely so the client gets a readable reason. */
  const rejectWith = (req: IncomingMessage, socket: any, head: Buffer, message: string) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ error: message }));
      ws.close();
    });
  };

  const authenticator: UpgradeAuthenticator = {
    ticketStore: wsConfig.ticketStore,
    resolvePrincipalFn: (headers) =>
      resolvePrincipal({ auth: wsConfig.auth, db: wsConfig.db }, headers),
    isMemberFn: async (userId, organizationId) =>
      (await findMembership(wsConfig.db, userId, organizationId)) !== null,
  };

  server.on("upgrade", (req, socket: any, head) => {
    (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const vmId = extractVmIdFromPath(url.pathname);
      if (!vmId) return; // Not ours

      const [vm] = await wsConfig.db.select().from(vms).where(eq(vms.id, vmId));

      // Authenticate before revealing whether the VM exists.
      const headers = headersFromNodeRequest(req);
      const authorized = vm && (await authenticateUpgrade(url, headers, vm, authenticator));
      if (!authorized) {
        rejectWith(req, socket, head, "Unauthorized - valid ticket, session or API key required");
        return;
      }

      if (vm.status !== "running") {
        rejectWith(req, socket, head, `VM is not running. Current status: '${vm.status}'`);
        return;
      }

      // Guard against stale DB state (e.g. API hot-reload killed Firecracker).
      if (!vm.pid || !vm.socketPath) {
        rejectWith(req, socket, head, "VM is not running (missing runtime info)");
        return;
      }
      try {
        process.kill(vm.pid, 0);
      } catch {
        rejectWith(req, socket, head, "VM is not running (firecracker process is not alive)");
        return;
      }

      if (!vm.ipAddress) {
        rejectWith(req, socket, head, "VM has no IP address assigned");
        return;
      }

      const privateKey = await loadKey(vmId);
      if (!privateKey) {
        rejectWith(req, socket, head, "No SSH key available for this VM");
        return;
      }

      if (activeConnections.has(vmId)) {
        rejectWith(req, socket, head, "Terminal already connected");
        return;
      }
      activeConnections.add(vmId);

      wss.handleUpgrade(req, socket, head, (ws) => {
        void bridgeShellToWebSocket(ws, {
          host: vm.ipAddress!,
          privateKey,
          sshService,
          onClosed: () => activeConnections.delete(vmId),
        });
      });
    })().catch((err) => {
      rejectWith(req, socket, head, err instanceof Error ? err.message : "Internal server error");
    });
  });
}
