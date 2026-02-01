import type { IncomingMessage, Server } from "http";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import { vms } from "../db/schema";
import {
  createSerialConsole,
  SerialConsoleError,
  type SerialConsole,
} from "../services/firecracker";
import {
  formatOutputData,
  parseResizeMessage,
  _unsafeGetActiveConnectionsForWsLayer,
} from "../routes/terminal";
import type { Auth } from "../lib/auth";

type TerminalWsConfig = {
  db: BetterSQLite3Database<typeof schema>;
  auth: Auth;
  pipeDir?: string;
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

function rejectUpgrade(socket: any, status: number, body: { error: string }): void {
  const payload = JSON.stringify(body);
  socket.write(
    `HTTP/1.1 ${status} \r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
      "Connection: close\r\n" +
      "\r\n" +
      payload
  );
  socket.destroy();
}

export function attachTerminalWebSocketServer(server: Server, config: TerminalWsConfig): void {
  const wss = new WebSocketServer({ noServer: true });
  const activeConnections = _unsafeGetActiveConnectionsForWsLayer();

  const handleConnection = (ws: WebSocket, vmId: string) => {
    let serialConsole: SerialConsole | null = null;
    let isReady = false;

    const cleanup = async () => {
      if (!serialConsole) return;
      const current = activeConnections.get(vmId);
      if (current === serialConsole) activeConnections.delete(vmId);
      await serialConsole.close().catch(() => {});
      serialConsole = null;
    };

    (async () => {
      try {
        serialConsole = await createSerialConsole({
          vmId,
          pipeDir: config.pipeDir,
        });
        activeConnections.set(vmId, serialConsole);

        // Sync/reset terminal state.
        await serialConsole.write("\x1bc\x1b[2J\x1b[H");
        await new Promise((r) => setTimeout(r, 200));
        await serialConsole.write("\n");

        serialConsole.onData((data) => {
          if (!isReady) return;
          if (ws.readyState === ws.OPEN) {
            ws.send(formatOutputData(data));
          }
        });

        await new Promise((r) => setTimeout(r, 100));
        ws.send(JSON.stringify({ ready: true, vmId }));
        isReady = true;
      } catch (error) {
        let errorMessage = "Failed to connect to VM serial console";
        if (error instanceof SerialConsoleError) {
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ error: errorMessage }));
        }
        ws.close();
        await cleanup();
      }
    })();

    ws.on("message", async (raw: RawData) => {
      if (!serialConsole) return;

      try {
        if (typeof raw === "string") {
          const resize = parseResizeMessage(raw);
          if (resize) return; // ignore
          await serialConsole.write(raw);
          return;
        }

        if (Buffer.isBuffer(raw)) {
          await serialConsole.write(new Uint8Array(raw));
          return;
        }

        if (raw instanceof ArrayBuffer) {
          await serialConsole.write(new Uint8Array(raw));
          return;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to process message";
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ error: msg }));
        }
      }
    });

    ws.on("close", () => {
      cleanup();
    });

    ws.on("error", () => {
      cleanup();
    });
  };

  server.on("upgrade", (req, socket: any, head) => {
    (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const vmId = extractVmIdFromPath(url.pathname);
      if (!vmId) return; // Not ours

      // Authenticate WS handshake.
      const headers = headersFromNodeRequest(req);
      const cookieFromQuery = url.searchParams.get("cookie");
      if (cookieFromQuery) headers.set("cookie", cookieFromQuery);

      const session = await config.auth.api.getSession({ headers });
      if (!session) {
        rejectUpgrade(socket, 401, {
          error: "Unauthorized - valid session required",
        });
        return;
      }

      // Enforce exclusivity.
      if (activeConnections.has(vmId)) {
        rejectUpgrade(socket, 409, {
          error: "Terminal already connected. Only one connection allowed per VM.",
        });
        return;
      }

      // Validate VM state.
      const [vm] = await config.db.select().from(vms).where(eq(vms.id, vmId));
      if (!vm) {
        rejectUpgrade(socket, 404, { error: "VM not found" });
        return;
      }
      if (vm.status !== "running") {
        rejectUpgrade(socket, 400, {
          error: `VM is not running. Current status: '${vm.status}'`,
        });
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, vmId);
      });
    })().catch((err) => {
      // If anything throws during preflight, reject.
      rejectUpgrade(socket, 500, {
        error: err instanceof Error ? err.message : "Internal server error",
      });
    });
  });
}
