/**
 * Terminal Routes (HTTP / OpenAPI)
 *
 * WebSocket terminal handling is implemented in Node runtime code and is not
 * mounted via Hono route handlers.
 *
 * This module provides:
 * - OpenAPI route metadata for the terminal endpoint
 * - HTTP preflight checks (e.g. running status, exclusivity)
 * - Connection bookkeeping utilities used by the WebSocket layer
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import { vms } from "../db/schema";

// ==========================================================================
// OpenAPI Schemas
// ==========================================================================

const TerminalParamsSchema = z.object({
  id: z.string().openapi({
    example: "vm-abc123",
    description: "VM ID",
  }),
});

// ==========================================================================
// Route Definitions
// ==========================================================================

export const terminalRoute = createRoute({
  method: "get",
  path: "/vms/{id}/terminal",
  tags: ["VMs"],
  summary: "Terminal WebSocket",
  description:
    "WebSocket endpoint for terminal access to VMs. Connects to the VM's serial console via named pipes.",
  request: {
    params: TerminalParamsSchema,
  },
  responses: {
    101: {
      description: "WebSocket upgrade successful",
    },
    400: {
      description: "VM is not running",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    404: {
      description: "VM not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    409: {
      description: "Terminal already connected",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    426: {
      description: "WebSocket upgrade required",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
});

// ==========================================================================
// Utility Functions (kept small; WS layer may reuse)
// ==========================================================================

/**
 * Parse resize messages from a WebSocket client.
 * Expected format: {"resize":{"cols":80,"rows":24}}
 */
export function parseResizeMessage(data: string): { cols: number; rows: number } | null {
  try {
    const parsed = JSON.parse(data);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as any).resize &&
      typeof (parsed as any).resize.cols === "number" &&
      typeof (parsed as any).resize.rows === "number"
    ) {
      return {
        cols: (parsed as any).resize.cols,
        rows: (parsed as any).resize.rows,
      };
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function formatOutputData(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

// ==========================================================================
// Router Factory
// ==========================================================================

export interface TerminalRouterConfig {
  db: BetterSQLite3Database<typeof schema>;
}

/**
 * Creates the terminal HTTP router.
 *
 * Note: This endpoint exists primarily for OpenAPI documentation and for
 * returning explicit preflight errors when accessed as plain HTTP.
 */
export function createTerminalRouter(config: TerminalRouterConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { db } = config;

  app.openapi(terminalRoute, async (c) => {
    const id = c.req.param("id");
    const [vm] = await db.select().from(vms).where(eq(vms.id, id));

    if (!vm) {
      return c.json({ error: "VM not found" }, 404);
    }

    if (vm.status !== "running") {
      return c.json({ error: `VM is not running. Current status: '${vm.status}'` }, 400);
    }

    return c.json({ error: "WebSocket upgrade required" }, 426);
  });

  return app;
}
