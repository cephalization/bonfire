import type { IncomingMessage, Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import { vms } from "../db/schema";
import { config as appConfig } from "../lib/config";

type TerminalWsConfig = {
  db: BetterSQLite3Database<typeof schema>;
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

export function attachTerminalWebSocketServer(server: Server, wsConfig: TerminalWsConfig): void {
  const wss = new WebSocketServer({ noServer: true });

  const handleConnection = (ws: WebSocket, _vmId: string) => {
    // Terminal access is currently unavailable - serial console removed
    ws.send(
      JSON.stringify({
        error: "Terminal access is currently unavailable",
      })
    );
    ws.close();
  };

  server.on("upgrade", (req, socket: any, head) => {
    (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const vmId = extractVmIdFromPath(url.pathname);
      if (!vmId) return; // Not ours

      // Authenticate WS handshake using API key
      const headers = headersFromNodeRequest(req);
      const apiKey = headers.get("X-API-Key");

      if (!apiKey || apiKey !== appConfig.apiKey) {
        // Accept the upgrade so we can send a proper error message
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ error: "Unauthorized - valid API key required" }));
          ws.close();
        });
        return;
      }

      // Validate VM state.
      const [vm] = await wsConfig.db.select().from(vms).where(eq(vms.id, vmId));
      if (!vm) {
        // Accept the upgrade so we can send a proper error message
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ error: "VM not found" }));
          ws.close();
        });
        return;
      }
      if (vm.status !== "running") {
        // Accept the upgrade so we can send a proper error message
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ error: `VM is not running. Current status: '${vm.status}'` }));
          ws.close();
        });
        return;
      }

      // Guard against stale DB state (e.g. API hot-reload killed Firecracker).
      if (!vm.pid || !vm.socketPath) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ error: "VM is not running (missing runtime info)" }));
          ws.close();
        });
        return;
      }
      try {
        process.kill(vm.pid, 0);
      } catch {
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(
            JSON.stringify({ error: "VM is not running (firecracker process is not alive)" })
          );
          ws.close();
        });
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, vmId);
      });
    })().catch((err) => {
      // If anything throws during preflight, accept upgrade and send error.
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(
          JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" })
        );
        ws.close();
      });
    });
  });
}
