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
import { createAuth } from "./lib/auth";
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
import { createAuthMiddleware } from "./middleware/auth";
import { seedInitialAdmin } from "./db/seed";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "url";
import { attachTerminalWebSocketServer } from "./ws/terminal";
import { startVmWatchdog } from "./services/vm-watchdog";

export const API_VERSION = config.apiVersion;

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

  // Only setup routes if database is provided or can be created
  if (appConfig.db) {
    // Use provided database
    const networkService = appConfig.networkService ?? new NetworkService();

    // Create auth instance with the provided database
    const auth = createAuth(appConfig.db);
    const authMiddleware = createAuthMiddleware(auth);

    // Mount Better Auth handler at /api/auth/*
    app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

    // Apply auth middleware to protected routes (skip in test mode if configured)
    if (!appConfig.skipAuth) {
      app.use("/api/images/*", async (c, next) => {
        // Dev DX: allow registering a local agent image without requiring login.
        // This endpoint only registers paths that must already exist on disk.
        const url = new URL(c.req.url);
        if (process.env.NODE_ENV === "development" && url.pathname === "/api/images/local") {
          return next();
        }
        return authMiddleware(c, next);
      });
      app.use("/api/vms/*", authMiddleware);
    }

    const imagesRouter = createImagesRouter({
      db: appConfig.db,
    });
    const vmsRouter = createVMsRouter({
      db: appConfig.db,
      networkService,
      spawnFirecrackerFn: appConfig.spawnFirecrackerFn,
      configureVMProcessFn: appConfig.configureVMProcessFn,
      startVMProcessFn: appConfig.startVMProcessFn,
      stopVMProcessFn: appConfig.stopVMProcessFn,
    });
    const terminalRouter = createTerminalRouter({
      db: appConfig.db,
    });

    app.route("/api", imagesRouter);
    app.route("/api", vmsRouter);
    app.route("/api", terminalRouter);
  } else if (process.env.DATABASE_URL || typeof window === "undefined") {
    // Try to create default database connection in production/server context
    try {
      const dbPath = process.env.DATABASE_URL || "/var/lib/bonfire/bonfire.db";
      // Check if we can access the directory (will throw if not)
      const sqlite = new Database(dbPath);
      const db = drizzle(sqlite, { schema });
      const networkService = new NetworkService();

      // Create auth instance with the database
      const auth = createAuth(db);
      const authMiddleware = createAuthMiddleware(auth);

      // Mount Better Auth handler at /api/auth/*
      app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

      // Apply auth middleware to protected routes (skip in test mode if configured)
      if (!appConfig.skipAuth) {
        app.use("/api/images/*", async (c, next) => {
          const url = new URL(c.req.url);
          if (process.env.NODE_ENV === "development" && url.pathname === "/api/images/local") {
            return next();
          }
          return authMiddleware(c, next);
        });
        app.use("/api/vms/*", authMiddleware);
      }

      const imagesRouter = createImagesRouter({ db });
      const vmsRouter = createVMsRouter({
        db,
        networkService,
        spawnFirecrackerFn: appConfig.spawnFirecrackerFn,
        configureVMProcessFn: appConfig.configureVMProcessFn,
        startVMProcessFn: appConfig.startVMProcessFn,
        stopVMProcessFn: appConfig.stopVMProcessFn,
      });
      const terminalRouter = createTerminalRouter({ db });

      app.route("/api", imagesRouter);
      app.route("/api", vmsRouter);
      app.route("/api", terminalRouter);
    } catch {
      // Database not available, skip mounting routes
      // This allows the app to work in test environments without a database
    }
  }

  return app;
}

export const app = createApp();

// Start server if this file is run directly
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`🚀 Bonfire API v${API_VERSION} starting on port ${config.port}...`);

  // Create DB + auth (used by HTTP routes and WS auth)
  const dbPath = process.env.DATABASE_URL || "/var/lib/bonfire/bonfire.db";
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  const auth = createAuth(db);

  // Seed initial admin user if configured
  try {
    await seedInitialAdmin(db, auth);
  } catch (error) {
    console.error("⚠️  Failed to seed initial admin:", error);
  }

  const server = serve({
    port: config.port,
    fetch: app.fetch,
  });

  attachTerminalWebSocketServer(server as any, {
    db,
    auth,
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
