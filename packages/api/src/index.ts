/**
 * Bonfire API Server
 *
 * Hono-based API for managing Firecracker microVMs.
 * Entry point for the API package.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { config } from "./lib/config";
import * as schema from "./db/schema";
import { createImagesRouter } from "./routes/images";
import { createVMsRouter } from "./routes/vms";
import { createTerminalRouter } from "./routes/terminal";
import { NetworkService } from "./services/network";
import type {
  spawnFirecracker,
  configureVMProcess,
  startVMProcess,
  stopVMProcess,
} from "./services/firecracker/process";
import { apiKeyAuth, skipAuth } from "./middleware/auth";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "url";
import { attachTerminalWebSocketServer } from "./ws/terminal";
import { startVmWatchdog } from "./services/vm-watchdog";

export const API_VERSION = config.apiVersion;

const DEFAULT_DB_PATH = "/var/lib/bonfire/bonfire.db";

// OpenAPI schemas
const HealthResponseSchema = z
  .object({
    status: z.string().openapi({
      example: "ok",
      description: "Health status of the API",
    }),
  })
  .openapi("HealthResponse");

const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      example: "Internal server error",
      description: "Error message",
    }),
  })
  .openapi("ErrorResponse");

// Health route definition
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Health check",
  description: "Returns the health status of the API server",
  responses: {
    200: {
      description: "API is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// App Configuration
// ============================================================================

export interface AppConfig {
  db?: BetterSQLite3Database<typeof schema>;
  networkService?: NetworkService;
  spawnFirecrackerFn?: typeof spawnFirecracker;
  configureVMProcessFn?: typeof configureVMProcess;
  startVMProcessFn?: typeof startVMProcess;
  stopVMProcessFn?: typeof stopVMProcess;
  skipAuth?: boolean;
  mockUserId?: string;
}

/**
 * Open the default on-disk database.
 *
 * Returns null when no database is reachable (e.g. a test environment with no
 * writable data directory), in which case route mounting is skipped.
 */
function createDefaultDatabase(): BetterSQLite3Database<typeof schema> | null {
  if (!process.env.DATABASE_URL && typeof window !== "undefined") {
    return null;
  }
  try {
    const sqlite = new Database(process.env.DATABASE_URL || DEFAULT_DB_PATH);
    return drizzle(sqlite, { schema });
  } catch {
    return null;
  }
}

export function createApp(appConfig: AppConfig = {}) {
  const app = new OpenAPIHono();

  // Health check endpoint (doesn't require database)
  app.openapi(healthRoute, (c) => {
    return c.json({ status: "ok" }, 200);
  });

  // OpenAPI specification endpoint (doesn't require database)
  app.doc("/api/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Bonfire API",
      version: API_VERSION,
      description: "API for managing Firecracker microVMs",
    },
  });

  // Resolve the database: an injected one (tests), or the default on-disk one.
  // Without either, the app still serves /health and the OpenAPI document.
  const db = appConfig.db ?? createDefaultDatabase();

  if (db) {
    const networkService = appConfig.networkService ?? new NetworkService();

    // Choose auth middleware based on configuration
    const authMiddleware = appConfig.skipAuth ? skipAuth() : apiKeyAuth();

    // Apply auth middleware to protected routes
    app.use("/api/images/*", async (c, next) => {
      // Dev DX: allow registering a local agent image without requiring auth.
      // This endpoint only registers paths that must already exist on disk.
      const url = new URL(c.req.url);
      if (process.env.NODE_ENV === "development" && url.pathname === "/api/images/local") {
        return next();
      }
      return authMiddleware(c, next);
    });
    app.use("/api/vms/*", authMiddleware);

    app.route("/api", createImagesRouter({ db }));
    app.route(
      "/api",
      createVMsRouter({
        db,
        networkService,
        spawnFirecrackerFn: appConfig.spawnFirecrackerFn,
        configureVMProcessFn: appConfig.configureVMProcessFn,
        startVMProcessFn: appConfig.startVMProcessFn,
        stopVMProcessFn: appConfig.stopVMProcessFn,
      })
    );
    app.route("/api", createTerminalRouter({ db }));
  }

  return app;
}

export const app = createApp();

// Start server if this file is run directly
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`🚀 Bonfire API v${API_VERSION} starting on port ${config.port}...`);

  // Create DB connection
  const dbPath = process.env.DATABASE_URL || DEFAULT_DB_PATH;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  const server = serve({
    port: config.port,
    fetch: app.fetch,
  });

  attachTerminalWebSocketServer(server as any, {
    db,
  });

  // Dev-friendly safety net: in dev, hot-reload can restart the API process.
  // Without reconciliation, VMs can be left "running" in the DB even though
  // their Firecracker child process died.
  startVmWatchdog({
    db,
    networkService: new NetworkService(),
    intervalMs: 20_000,
  });

  console.log(`✅ Server running at http://localhost:${config.port}`);
}
