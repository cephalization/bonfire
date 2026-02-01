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
import { createAgentSessionsRouter } from "./routes/agent-sessions";
import { createOpencodeProxyRouter } from "./routes/opencode-proxy";
import type { BootstrapService } from "./services/bootstrap";
import { RealBootstrapService } from "./services/bootstrap";
import { RegistryService } from "./services/registry";
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
  registryService?: RegistryService;
  networkService?: NetworkService;
  bootstrapService?: BootstrapService;
  spawnFirecrackerFn?: typeof spawnFirecracker;
  configureVMProcessFn?: typeof configureVMProcess;
  startVMProcessFn?: typeof startVMProcess;
  stopVMProcessFn?: typeof stopVMProcess;
  skipAuth?: boolean;
  mockUserId?: string;
  /** Fetch function for proxy requests (can be mocked in tests) */
  fetchFn?: typeof fetch;
  /** OpenCode basic auth credentials */
  opencodeCredentials?: string;
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
    const registryService = appConfig.registryService ?? new RegistryService({ db: appConfig.db });
    const networkService = appConfig.networkService ?? new NetworkService();

    // Create auth instance with the provided database
    const auth = createAuth(appConfig.db);
    const authMiddleware = createAuthMiddleware(auth);

    // Mount Better Auth handler at /api/auth/*
    app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

    // Apply auth middleware to protected routes (skip in test mode if configured)
    if (!appConfig.skipAuth) {
      app.use("/api/images/*", authMiddleware);
      app.use("/api/vms/*", authMiddleware);
      app.use("/api/agent/*", authMiddleware);
    }

    // Add mock user middleware when mockUserId is provided (for testing)
    if (appConfig.mockUserId && appConfig.db) {
      const db = appConfig.db;
      app.use("/api/agent/*", async (c, next) => {
        const mockUser = await db.query.user.findFirst({
          where: (user, { eq }) => eq(user.id, appConfig.mockUserId!),
        });
        if (mockUser) {
          (c as any).set("user", mockUser);
        }
        await next();
      });
    }

    const imagesRouter = createImagesRouter({
      db: appConfig.db,
      registryService,
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
    const bootstrapService = appConfig.bootstrapService ?? new RealBootstrapService(appConfig.db);
    const agentSessionsRouter = createAgentSessionsRouter({
      db: appConfig.db,
      bootstrapService,
    });
    const opencodeProxyRouter = createOpencodeProxyRouter({
      db: appConfig.db,
      fetchFn: appConfig.fetchFn,
      opencodeCredentials: appConfig.opencodeCredentials,
    });

    app.route("/api", imagesRouter);
    app.route("/api", vmsRouter);
    app.route("/api", terminalRouter);
    app.route("/api", agentSessionsRouter);
    app.route("/api", opencodeProxyRouter);
  } else if (process.env.DATABASE_URL || typeof window === "undefined") {
    // Try to create default database connection in production/server context
    try {
      const dbPath = process.env.DATABASE_URL || "/var/lib/bonfire/bonfire.db";
      // Check if we can access the directory (will throw if not)
      const sqlite = new Database(dbPath);
      const db = drizzle(sqlite, { schema });
      const registryService = new RegistryService({ db });
      const networkService = new NetworkService();

      // Create auth instance with the database
      const auth = createAuth(db);
      const authMiddleware = createAuthMiddleware(auth);

      // Mount Better Auth handler at /api/auth/*
      app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

      // Apply auth middleware to protected routes (skip in test mode if configured)
      if (!appConfig.skipAuth) {
        app.use("/api/images/*", authMiddleware);
        app.use("/api/vms/*", authMiddleware);
        app.use("/api/agent/*", authMiddleware);
      }

      const imagesRouter = createImagesRouter({ db, registryService });
      const vmsRouter = createVMsRouter({
        db,
        networkService,
        spawnFirecrackerFn: appConfig.spawnFirecrackerFn,
        configureVMProcessFn: appConfig.configureVMProcessFn,
        startVMProcessFn: appConfig.startVMProcessFn,
        stopVMProcessFn: appConfig.stopVMProcessFn,
      });
      const terminalRouter = createTerminalRouter({ db });
      const bootstrapService = new RealBootstrapService(db);
      const agentSessionsRouter = createAgentSessionsRouter({ db, bootstrapService });
      const opencodeProxyRouter = createOpencodeProxyRouter({
        db,
        fetchFn: appConfig.fetchFn,
        opencodeCredentials: appConfig.opencodeCredentials,
      });

      app.route("/api", imagesRouter);
      app.route("/api", vmsRouter);
      app.route("/api", terminalRouter);
      app.route("/api", agentSessionsRouter);
      app.route("/api", opencodeProxyRouter);
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

  console.log(`✅ Server running at http://localhost:${config.port}`);
}
