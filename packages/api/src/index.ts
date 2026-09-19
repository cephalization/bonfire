/**
 * Bonfire API Server
 *
 * Hono-based API for managing Firecracker microVMs.
 * Entry point for the API package.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { config } from "./lib/config";
import * as schema from "./db/schema";
import { createDatabase } from "./db";
import { createImagesRouter } from "./routes/images";
import { createVMsRouter } from "./routes/vms";
import { createTerminalRouter } from "./routes/terminal";
import { createProvidersRouter } from "./routes/providers";
import { createConversationsRouter } from "./routes/conversations";
import {
  createConversationEventBus,
  type ConversationEventBus,
} from "./services/conversation-events";
import { createAgentManager, type AgentManager } from "./services/agent/manager";
import type { AgentClientFactory } from "./services/agent/opencode";
import type { provisionAgent } from "./services/agent/provisioner";
import type { SSHService } from "./services/ssh";
import { createSecretBox, type SecretBox } from "./lib/secrets";
import { NetworkService } from "./services/network";
import type {
  spawnFirecracker,
  configureVMProcess,
  startVMProcess,
  stopVMProcess,
} from "./services/firecracker/process";
import { createAuthMiddleware } from "./middleware/auth";
import { createAuth, type Auth } from "./lib/auth";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { fileURLToPath } from "url";
import { attachTerminalWebSocketServer } from "./ws/terminal";
import { startVmWatchdog } from "./services/vm-watchdog";
import { bootstrapDefaultImage } from "./services/images";
import { createTerminalTicketStore, type TerminalTicketStore } from "./lib/terminal-tickets";

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
  ticketStore?: TerminalTicketStore;
  /** Injected by tests; otherwise built from `config` for the app's database. */
  auth?: Auth;
  /** Encryption for stored provider keys; derived from BETTER_AUTH_SECRET by default. */
  secrets?: SecretBox;
  conversationEvents?: ConversationEventBus;
  /** How the agent manager reaches opencode in a VM; tests inject a fake. */
  agentClientFactory?: AgentClientFactory;
  /** SSH access used to provision the agent in a VM; tests inject the mock. */
  sshService?: SSHService;
  loadPrivateKeyFn?: (vmId: string) => Promise<string | null>;
  provisionAgentFn?: typeof provisionAgent;
  /** Pre-built manager (tests); otherwise one is created from the options above. */
  agentManager?: AgentManager;
  agentHealthTimeoutMs?: number;
}

/**
 * Open the configured on-disk database (see `config.dbPath`), creating and
 * migrating it if needed.
 *
 * Returns null when no database is reachable (e.g. a test environment with no
 * writable data directory), in which case route mounting is skipped.
 */
function createDefaultDatabase(): BetterSQLite3Database<typeof schema> | null {
  if (!process.env.DATABASE_URL && typeof window !== "undefined") {
    return null;
  }
  try {
    return createDatabase().db;
  } catch {
    return null;
  }
}

export function createApp(appConfig: AppConfig = {}) {
  const app = new OpenAPIHono();
  // The route that mints tickets and the WebSocket server that redeems them
  // must share one store, so it is created here and handed to both.
  const ticketStore = appConfig.ticketStore ?? createTerminalTicketStore();

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

  // Set once the database is known; null means only /health and the OpenAPI
  // document are served.
  let auth: Auth | null = null;
  let agentManager: AgentManager | null = null;
  const conversationEvents = appConfig.conversationEvents ?? createConversationEventBus();

  if (db) {
    const networkService = appConfig.networkService ?? new NetworkService();
    auth = appConfig.auth ?? createAuth({ db });

    // Browsers send the session cookie, so cross-origin callers (the Vite dev
    // server) need credentialed CORS. Same-origin deployments are unaffected.
    app.use(
      "/api/*",
      cors({
        origin: config.trustedOrigins,
        credentials: true,
        allowHeaders: ["Content-Type", "X-API-Key"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      })
    );

    // Better Auth owns everything under /api/auth: sign-up, sign-in, sessions,
    // organizations, invitations and API keys.
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth!.handler(c.req.raw));

    // Everything else needs a principal: a session cookie or an X-API-Key.
    const requireAuth = createAuthMiddleware({ auth, db });
    app.use("/api/images", requireAuth);
    app.use("/api/images/*", requireAuth);
    app.use("/api/vms", requireAuth);
    app.use("/api/vms/*", requireAuth);
    app.use("/api/conversations", requireAuth);
    app.use("/api/conversations/*", requireAuth);
    app.use("/api/organizations/*", requireAuth);

    const secrets = appConfig.secrets ?? createSecretBox();
    agentManager =
      appConfig.agentManager ??
      createAgentManager({
        db,
        events: conversationEvents,
        secrets,
        clientFactory: appConfig.agentClientFactory,
        sshService: appConfig.sshService,
        loadPrivateKeyFn: appConfig.loadPrivateKeyFn,
        provisionFn: appConfig.provisionAgentFn,
        healthTimeoutMs: appConfig.agentHealthTimeoutMs,
      });

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
    app.route("/api", createTerminalRouter({ db, ticketStore }));
    app.route("/api", createProvidersRouter({ db, secrets }));
    app.route(
      "/api",
      createConversationsRouter({ db, events: conversationEvents, agents: agentManager })
    );
  }

  return Object.assign(app, { ticketStore, auth, agentManager, conversationEvents });
}

// Start server if this file is run directly
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`🚀 Bonfire API v${API_VERSION} starting on port ${config.port}...`);

  // Creates the file (and its directory) and applies pending migrations, so
  // `pnpm dev` on a fresh checkout works without a separate migrate step.
  const { db } = createDatabase(config.dbPath);
  console.log(`💾 Database: ${config.dbPath}`);

  const app = createApp({ db });

  const server = serve({
    port: config.port,
    fetch: app.fetch,
  });

  attachTerminalWebSocketServer(server as any, {
    db,
    auth: app.auth!,
    ticketStore: app.ticketStore,
  });

  // Dev-friendly safety net: in dev, hot-reload can restart the API process.
  // Without reconciliation, VMs can be left "running" in the DB even though
  // their Firecracker child process died.
  startVmWatchdog({
    db,
    networkService: new NetworkService(),
    intervalMs: 20_000,
  });

  // The Docker image ships a default agent image; register it if present.
  void bootstrapDefaultImage(db)
    .then((image) => {
      if (image) console.log(`🖼️  Default image registered: ${image.reference}`);
    })
    .catch((error) => console.warn("Failed to register the default image:", error));

  console.log(`✅ Server running at http://localhost:${config.port}`);
  console.log(`   Sign in at ${config.webUrl}`);
}
