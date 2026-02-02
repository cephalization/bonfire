/**
 * Agent Sessions API Routes
 *
 * REST endpoints for Agent Session management:
 * - GET /api/agent/sessions - List all sessions for the authenticated user
 * - POST /api/agent/sessions - Create a new session
 * - GET /api/agent/sessions/:id - Get single session details
 * - POST /api/agent/sessions/:id/archive - Archive a session
 * - POST /api/agent/sessions/:id/retry - Retry bootstrap for a failed session
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { agentSessions, vms } from "../db/schema";
import type { AuthUser } from "../middleware/auth";
import type { BootstrapService } from "../services/bootstrap";
import { RealBootstrapService } from "../services/bootstrap";

// ============================================================================
// OpenAPI Schemas
// ============================================================================

const AgentSessionSchema = z
  .object({
    id: z.string().openapi({
      example: "sess-abc123",
      description: "Unique session ID (UUID)",
    }),
    userId: z.string().openapi({
      example: "user-abc123",
      description: "Owner user ID",
    }),
    title: z.string().nullable().openapi({
      example: "My Project",
      description: "Session title (optional)",
    }),
    repoUrl: z.string().openapi({
      example: "https://github.com/org/repo",
      description: "Repository URL",
    }),
    branch: z.string().nullable().openapi({
      example: "main",
      description: "Git branch (optional)",
    }),
    vmId: z.string().nullable().openapi({
      example: "vm-abc123",
      description: "Associated VM ID (optional)",
    }),
    workspacePath: z.string().nullable().openapi({
      example: "/home/agent/workspaces/sess-abc123",
      description: "Workspace path on VM",
    }),
    status: z.enum(["creating", "ready", "error", "archived"]).openapi({
      example: "creating",
      description: "Current session status",
    }),
    errorMessage: z.string().nullable().openapi({
      example: "Failed to clone repository",
      description: "Error message when status is 'error'",
    }),
    createdAt: z.string().datetime().openapi({
      example: "2024-01-15T10:30:00Z",
      description: "Creation timestamp",
    }),
    updatedAt: z.string().datetime().openapi({
      example: "2024-01-15T10:30:00Z",
      description: "Last update timestamp",
    }),
  })
  .openapi("AgentSession");

const CreateAgentSessionRequestSchema = z
  .object({
    title: z.string().min(1).max(255).optional().openapi({
      example: "My Project",
      description: "Session title (optional)",
    }),
    repoUrl: z.string().min(1).max(2048).openapi({
      example: "https://github.com/org/repo",
      description: "Repository URL (required)",
    }),
    branch: z.string().min(1).max(255).optional().openapi({
      example: "main",
      description: "Git branch (optional, defaults to repo default)",
    }),
    vmId: z.string().optional().openapi({
      example: "vm-abc123",
      description: "VM ID to use for this session (optional, for retry)",
    }),
  })
  .openapi("CreateAgentSessionRequest");

const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      example: "Session not found",
      description: "Error message",
    }),
  })
  .openapi("ErrorResponse");

const ValidationErrorSchema = z
  .object({
    error: z.string(),
    details: z.array(
      z.object({
        path: z.array(z.string()),
        message: z.string(),
      })
    ),
  })
  .openapi("ValidationError");

// ============================================================================
// Route Definitions
// ============================================================================

const listAgentSessionsRoute = createRoute({
  method: "get",
  path: "/agent/sessions",
  tags: ["Agent Sessions"],
  summary: "List all agent sessions",
  description: "Returns all agent sessions for the authenticated user",
  responses: {
    200: {
      description: "List of agent sessions",
      content: {
        "application/json": {
          schema: z.array(AgentSessionSchema),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
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

const createAgentSessionRoute = createRoute({
  method: "post",
  path: "/agent/sessions",
  tags: ["Agent Sessions"],
  summary: "Create a new agent session",
  description: "Creates a new agent session record with status 'creating'",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateAgentSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Agent session created successfully",
      content: {
        "application/json": {
          schema: AgentSessionSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
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

const getAgentSessionRoute = createRoute({
  method: "get",
  path: "/agent/sessions/{id}",
  tags: ["Agent Sessions"],
  summary: "Get agent session details",
  description: "Returns details for a single agent session",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "sess-abc123",
        description: "Session ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "Agent session details",
      content: {
        "application/json": {
          schema: AgentSessionSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
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

const archiveAgentSessionRoute = createRoute({
  method: "post",
  path: "/agent/sessions/{id}/archive",
  tags: ["Agent Sessions"],
  summary: "Archive an agent session",
  description: "Archives an agent session (soft delete)",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "sess-abc123",
        description: "Session ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "Session archived successfully",
      content: {
        "application/json": {
          schema: AgentSessionSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
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

const retryAgentSessionRoute = createRoute({
  method: "post",
  path: "/agent/sessions/{id}/retry",
  tags: ["Agent Sessions"],
  summary: "Retry bootstrap for an agent session",
  description: "Retries the bootstrap process for a failed session",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "sess-abc123",
        description: "Session ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "Retry initiated successfully",
      content: {
        "application/json": {
          schema: AgentSessionSchema,
        },
      },
    },
    400: {
      description: "Session cannot be retried (not in error state)",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
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
// Router Factory
// ============================================================================

export interface AgentSessionsRouterConfig {
  db: BetterSQLite3Database<typeof schema>;
  bootstrapService?: BootstrapService;
}

export function createAgentSessionsRouter(config: AgentSessionsRouterConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { db } = config;
  const bootstrapService = config.bootstrapService ?? new RealBootstrapService(db);

  async function waitForVmIpAddress(
    vmId: string,
    timeoutMs: number = 60000,
    intervalMs: number = 2000
  ): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const [vm] = await db.select().from(vms).where(eq(vms.id, vmId));
      if (vm?.ipAddress) return vm.ipAddress;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }

  // Helper to serialize session for JSON response
  function serializeSession(session: typeof schema.agentSessions.$inferSelect) {
    return {
      ...session,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
    };
  }

  // Helper to get user from context
  function getUser(c: any): AuthUser {
    const user = c.get("user") as AuthUser | undefined;
    if (!user) {
      throw new Error("Unauthorized - user not found in context");
    }
    return user;
  }

  // GET /api/agent/sessions - List all sessions for the authenticated user
  app.openapi(listAgentSessionsRoute, async (c) => {
    try {
      const user = getUser(c);

      const sessions = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.userId, user.id));

      return c.json(sessions.map(serializeSession), 200);
    } catch (error) {
      console.error("Failed to list agent sessions:", error);
      return c.json({ error: "Failed to list agent sessions" }, 500);
    }
  });

  // POST /api/agent/sessions - Create a new session
  app.openapi(createAgentSessionRoute, async (c) => {
    try {
      const user = getUser(c);
      const body = await c.req.json();

      // Validate request body
      const validationResult = CreateAgentSessionRequestSchema.safeParse(body);
      if (!validationResult.success) {
        const errors = validationResult.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        }));
        return c.json(
          {
            error: "Validation failed",
            details: errors,
          },
          400
        );
      }

      const { title, repoUrl, branch, vmId } = validationResult.data;

      // Generate UUID for the session
      const sessionId = randomUUID();
      const now = new Date();

      // Create session record
      const newSession = {
        id: sessionId,
        userId: user.id,
        title: title ?? null,
        repoUrl,
        branch: branch ?? null,
        vmId: vmId ?? null,
        workspacePath: null,
        status: "creating" as const,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(agentSessions).values(newSession);

      // If a VM ID was provided, trigger bootstrap asynchronously
      if (vmId) {
        // Trigger bootstrap in the background.
        // VM IP assignment can lag behind "running" status, so we poll briefly.
        (async () => {
          const [vm] = await db.select().from(vms).where(eq(vms.id, vmId));
          if (!vm) {
            await db
              .update(agentSessions)
              .set({
                status: "error",
                errorMessage: "Associated VM not found",
                updatedAt: new Date(),
              })
              .where(eq(agentSessions.id, sessionId));
            return;
          }

          const vmIp = vm.ipAddress ?? (await waitForVmIpAddress(vmId));
          if (!vmIp) {
            await db
              .update(agentSessions)
              .set({
                status: "error",
                errorMessage: "VM has no IP address (timed out waiting for assignment)",
                updatedAt: new Date(),
              })
              .where(eq(agentSessions.id, sessionId));
            return;
          }

          await bootstrapService.bootstrap({
            sessionId,
            repoUrl,
            branch,
            vmId,
            vmIp,
          });
        })().catch((error) => {
          console.error(`Bootstrap failed for session ${sessionId}:`, error);
        });
      }

      return c.json(serializeSession(newSession), 201);
    } catch (error) {
      console.error("Failed to create agent session:", error);
      const message = error instanceof Error ? error.message : "Failed to create agent session";
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/agent/sessions/:id - Get single session details
  app.openapi(getAgentSessionRoute, async (c) => {
    try {
      const user = getUser(c);
      const id = c.req.param("id");

      const [session] = await db
        .select()
        .from(agentSessions)
        .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, user.id)));

      if (!session) {
        return c.json({ error: "Session not found" }, 404);
      }

      return c.json(serializeSession(session), 200);
    } catch (error) {
      console.error("Failed to get agent session:", error);
      return c.json({ error: "Failed to get agent session" }, 500);
    }
  });

  // POST /api/agent/sessions/:id/archive - Archive a session
  app.openapi(archiveAgentSessionRoute, async (c) => {
    try {
      const user = getUser(c);
      const id = c.req.param("id");

      // Check if session exists and belongs to user
      const [existingSession] = await db
        .select()
        .from(agentSessions)
        .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, user.id)));

      if (!existingSession) {
        return c.json({ error: "Session not found" }, 404);
      }

      // Update status to archived
      const now = new Date();
      await db
        .update(agentSessions)
        .set({
          status: "archived",
          updatedAt: now,
        })
        .where(eq(agentSessions.id, id));

      // Return updated session
      const [updatedSession] = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, id));

      return c.json(serializeSession(updatedSession), 200);
    } catch (error) {
      console.error("Failed to archive agent session:", error);
      const message = error instanceof Error ? error.message : "Failed to archive agent session";
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/agent/sessions/:id/retry - Retry bootstrap for a failed session
  app.openapi(retryAgentSessionRoute, async (c) => {
    try {
      const user = getUser(c);
      const id = c.req.param("id");

      // Check if session exists and belongs to user
      const [existingSession] = await db
        .select()
        .from(agentSessions)
        .where(and(eq(agentSessions.id, id), eq(agentSessions.userId, user.id)));

      if (!existingSession) {
        return c.json({ error: "Session not found" }, 404);
      }

      // Can only retry sessions in error state
      if (existingSession.status !== "error") {
        return c.json(
          {
            error: `Cannot retry session with status '${existingSession.status}'. Must be 'error'.`,
          },
          400
        );
      }

      // Must have a VM assigned
      if (!existingSession.vmId) {
        return c.json({ error: "Session has no VM assigned" }, 400);
      }

      // Get VM details
      const [vm] = await db.select().from(vms).where(eq(vms.id, existingSession.vmId));
      if (!vm) {
        return c.json({ error: "Associated VM not found" }, 400);
      }

      if (!vm.ipAddress) {
        return c.json({ error: "VM has no IP address" }, 400);
      }

      // Reset status to creating
      const now = new Date();
      await db
        .update(agentSessions)
        .set({
          status: "creating",
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(agentSessions.id, id));

      // Get updated session
      const [updatedSession] = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, id));

      // Trigger bootstrap in the background
      bootstrapService
        .bootstrap({
          sessionId: id,
          repoUrl: existingSession.repoUrl,
          branch: existingSession.branch,
          vmId: existingSession.vmId,
          vmIp: vm.ipAddress,
        })
        .catch((error) => {
          console.error(`Retry bootstrap failed for session ${id}:`, error);
        });

      return c.json(serializeSession(updatedSession), 200);
    } catch (error) {
      console.error("Failed to retry agent session:", error);
      const message = error instanceof Error ? error.message : "Failed to retry agent session";
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
