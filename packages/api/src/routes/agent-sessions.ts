/**
 * Agent Sessions API Routes
 *
 * REST endpoints for Agent Session management:
 * - GET /api/agent/sessions - List all sessions for the authenticated user
 * - POST /api/agent/sessions - Create a new session
 * - GET /api/agent/sessions/:id - Get single session details
 * - POST /api/agent/sessions/:id/archive - Archive a session
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { agentSessions } from "../db/schema";
import type { AuthUser } from "../middleware/auth";

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

// ============================================================================
// Router Factory
// ============================================================================

export interface AgentSessionsRouterConfig {
  db: BetterSQLite3Database<typeof schema>;
}

export function createAgentSessionsRouter(config: AgentSessionsRouterConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { db } = config;

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

      const { title, repoUrl, branch } = validationResult.data;

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
        vmId: null,
        workspacePath: null,
        status: "creating" as const,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(agentSessions).values(newSession);

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

  return app;
}
