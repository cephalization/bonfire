/**
 * Conversations
 *
 * - GET    /api/conversations                      - list the organization's conversations
 * - POST   /api/conversations                      - start one
 * - GET    /api/conversations/:id                  - conversation with participants
 * - DELETE /api/conversations/:id                  - delete it (creator, admin or owner)
 * - GET    /api/conversations/:id/messages         - messages, oldest first
 * - POST   /api/conversations/:id/messages         - post a message (forwarded to the agent)
 * - GET    /api/conversations/:id/events           - server-sent events: new and updated messages
 * - POST   /api/conversations/:id/agent            - attach an agent running in a VM
 * - DELETE /api/conversations/:id/agent            - detach it
 * - POST   /api/conversations/:id/agent/interrupt  - stop the agent's current turn
 * - GET    /api/conversations/:id/agent/models     - models the attached agent can use
 *
 * Every route checks organization membership (lib/authz.ts). Conversations in
 * organizations the caller is not in answer 404, like VMs.
 *
 * Realtime uses server-sent events rather than the terminal's WebSocket: the
 * browser's EventSource sends the session cookie, so no ticket dance is
 * needed, and updates only flow one way (posting is an ordinary POST).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { findMembership, requireOrganizationAccess } from "../lib/authz";
import { validationHook } from "../lib/openapi";
import type { Principal } from "../middleware/auth";
import type { ConversationEventBus } from "../services/conversation-events";
import { AgentError, type AgentManager } from "../services/agent/manager";

type Db = BetterSQLite3Database<typeof schema>;

// ============================================================================
// Schemas
// ============================================================================

const ErrorResponseSchema = z.object({ error: z.string() });

const ConversationSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    title: z.string(),
    createdById: z.string().nullable(),
    agentVmId: z.string().nullable(),
    agentModel: z.string().nullable(),
    agentStatus: z.enum(["offline", "provisioning", "idle", "busy", "error"]),
    agentError: z.string().nullable(),
    lastMessageAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Conversation");

const ParticipantSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    joinedAt: z.string(),
  })
  .openapi("ConversationParticipant");

const ConversationDetailSchema = ConversationSchema.extend({
  participants: z.array(ParticipantSchema),
  agentVmName: z.string().nullable(),
}).openapi("ConversationDetail");

const MessagePartSchema = z.union([
  z.object({ type: z.literal("text"), id: z.string(), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    callId: z.string(),
    name: z.string(),
    status: z.enum(["running", "completed", "error"]),
    input: z.unknown().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

const MessageSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    authorKind: z.enum(["user", "agent", "system"]),
    authorId: z.string().nullable(),
    authorName: z.string(),
    body: z.string(),
    parts: z.array(MessagePartSchema),
    status: z.enum(["complete", "streaming", "error"]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ConversationMessage");

const IdParamsSchema = z.object({ id: z.string().openapi({ description: "Conversation ID" }) });

const OrganizationQuerySchema = z.object({
  organizationId: z.string().optional().openapi({
    description:
      "Organization to act in; defaults to the session's active organization or the API key's",
  }),
});

export const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  organizationId: z.string().optional(),
});

export const PostMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(20_000),
});

export const AttachAgentSchema = z.object({
  vmId: z.string().min(1),
  model: z
    .string()
    .trim()
    .regex(/^[^/\s]+\/[^\s]+$/, 'Model must be written as "provider/model"')
    .optional(),
});

const ModelSchema = z.object({ providerID: z.string(), id: z.string(), name: z.string() });

// ============================================================================
// Routes
// ============================================================================

const json = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const listRoute = createRoute({
  method: "get",
  path: "/conversations",
  tags: ["Conversations"],
  summary: "List conversations",
  request: { query: OrganizationQuerySchema },
  responses: {
    200: json(z.array(ConversationSchema), "Conversations, most recently active first"),
    400: json(ErrorResponseSchema, "No organization selected"),
    403: json(ErrorResponseSchema, "Not a member"),
  },
});

const createRoute_ = createRoute({
  method: "post",
  path: "/conversations",
  tags: ["Conversations"],
  summary: "Start a conversation",
  request: { body: { content: { "application/json": { schema: CreateConversationSchema } } } },
  responses: {
    201: json(ConversationDetailSchema, "Created"),
    400: json(ErrorResponseSchema, "Invalid request"),
    403: json(ErrorResponseSchema, "Not a member"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/conversations/{id}",
  tags: ["Conversations"],
  summary: "Get a conversation",
  request: { params: IdParamsSchema },
  responses: {
    200: json(ConversationDetailSchema, "Conversation"),
    404: json(ErrorResponseSchema, "Not found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/conversations/{id}",
  tags: ["Conversations"],
  summary: "Delete a conversation",
  request: { params: IdParamsSchema },
  responses: {
    200: json(z.object({ success: z.boolean() }), "Deleted"),
    403: json(ErrorResponseSchema, "Only the creator, admins and owners can delete"),
    404: json(ErrorResponseSchema, "Not found"),
  },
});

const listMessagesRoute = createRoute({
  method: "get",
  path: "/conversations/{id}/messages",
  tags: ["Conversations"],
  summary: "List messages, oldest first",
  request: {
    params: IdParamsSchema,
    query: z.object({
      after: z.string().optional().openapi({
        description: "Only messages created after this ISO timestamp",
      }),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  },
  responses: {
    200: json(z.array(MessageSchema), "Messages"),
    404: json(ErrorResponseSchema, "Not found"),
  },
});

const postMessageRoute = createRoute({
  method: "post",
  path: "/conversations/{id}/messages",
  tags: ["Conversations"],
  summary: "Post a message",
  description:
    "Stores the message, publishes it to everyone watching the conversation and, " +
    "when an agent is attached, forwards it to the agent.",
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: PostMessageSchema } } },
  },
  responses: {
    201: json(MessageSchema, "Posted"),
    400: json(ErrorResponseSchema, "Invalid request"),
    404: json(ErrorResponseSchema, "Not found"),
    502: json(
      MessageSchema.extend({ agentError: z.string() }),
      "Posted, but the agent could not be reached"
    ),
  },
});

const eventsRoute = createRoute({
  method: "get",
  path: "/conversations/{id}/events",
  tags: ["Conversations"],
  summary: "Subscribe to conversation events (server-sent events)",
  description:
    "Streams `message.created`, `message.updated` and `conversation.updated` events " +
    "as JSON. Agent replies arrive as `message.updated` events while they stream.",
  request: { params: IdParamsSchema },
  responses: {
    200: { description: "Event stream", content: { "text/event-stream": { schema: z.string() } } },
    404: json(ErrorResponseSchema, "Not found"),
  },
});

const attachAgentRoute = createRoute({
  method: "post",
  path: "/conversations/{id}/agent",
  tags: ["Conversations"],
  summary: "Attach an agent",
  description:
    "Starts an opencode server in the given running VM (configured with the " +
    "organization's provider keys) and adds it to the conversation. Provisioning " +
    "continues after the response; watch `agentStatus` via the event stream.",
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: AttachAgentSchema } } },
  },
  responses: {
    202: json(ConversationDetailSchema, "Provisioning started"),
    400: json(ErrorResponseSchema, "Invalid request"),
    404: json(ErrorResponseSchema, "Not found"),
    409: json(ErrorResponseSchema, "An agent is already being attached"),
  },
});

const detachAgentRoute = createRoute({
  method: "delete",
  path: "/conversations/{id}/agent",
  tags: ["Conversations"],
  summary: "Detach the agent",
  request: { params: IdParamsSchema },
  responses: {
    200: json(ConversationDetailSchema, "Detached"),
    404: json(ErrorResponseSchema, "Not found"),
  },
});

const interruptAgentRoute = createRoute({
  method: "post",
  path: "/conversations/{id}/agent/interrupt",
  tags: ["Conversations"],
  summary: "Interrupt the agent's current turn",
  request: { params: IdParamsSchema },
  responses: {
    200: json(z.object({ success: z.boolean() }), "Interrupted"),
    400: json(ErrorResponseSchema, "Invalid request"),
    404: json(ErrorResponseSchema, "Not found"),
    409: json(ErrorResponseSchema, "No agent attached"),
    502: json(ErrorResponseSchema, "Agent unreachable"),
  },
});

const agentModelsRoute = createRoute({
  method: "get",
  path: "/conversations/{id}/agent/models",
  tags: ["Conversations"],
  summary: "Models available to the attached agent",
  request: { params: IdParamsSchema },
  responses: {
    200: json(z.array(ModelSchema), "Models"),
    400: json(ErrorResponseSchema, "Invalid request"),
    404: json(ErrorResponseSchema, "Not found"),
    409: json(ErrorResponseSchema, "No agent attached"),
    502: json(ErrorResponseSchema, "Agent unreachable"),
  },
});

// ============================================================================
// Router
// ============================================================================

export interface ConversationsRouterConfig {
  db: Db;
  events: ConversationEventBus;
  agents: AgentManager;
}

function iso(value: Date | number | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

export function serializeConversation(row: schema.Conversation) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    createdById: row.createdById,
    agentVmId: row.agentVmId,
    agentModel: row.agentModel,
    agentStatus: row.agentStatus,
    agentError: row.agentError,
    lastMessageAt: iso(row.lastMessageAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export function serializeMessage(row: schema.ConversationMessage) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorKind: row.authorKind,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    parts: row.parts,
    status: row.status,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export function createConversationsRouter(config: ConversationsRouterConfig) {
  const { db, events, agents } = config;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  /** Load a conversation the principal may see, or null (404 either way). */
  async function loadAuthorized(principal: Principal, id: string) {
    const [row] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    if (!row) return null;
    const membership = await findMembership(db, principal.user.id, row.organizationId);
    return membership ? { conversation: row, membership } : null;
  }

  async function detail(conversation: schema.Conversation) {
    const participants = await db
      .select({
        userId: schema.conversationParticipants.userId,
        name: schema.user.name,
        email: schema.user.email,
        joinedAt: schema.conversationParticipants.joinedAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(schema.user, eq(schema.user.id, schema.conversationParticipants.userId))
      .where(eq(schema.conversationParticipants.conversationId, conversation.id))
      .orderBy(asc(schema.conversationParticipants.joinedAt));

    let agentVmName: string | null = null;
    if (conversation.agentVmId) {
      const [vm] = await db
        .select({ name: schema.vms.name })
        .from(schema.vms)
        .where(eq(schema.vms.id, conversation.agentVmId));
      agentVmName = vm?.name ?? null;
    }

    return {
      ...serializeConversation(conversation),
      participants: participants.map((p) => ({ ...p, joinedAt: iso(p.joinedAt)! })),
      agentVmName,
    };
  }

  async function ensureParticipant(conversationId: string, principal: Principal) {
    const existing = await db
      .select({ id: schema.conversationParticipants.id })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.userId, principal.user.id)
        )
      );
    if (existing.length) return;
    await db.insert(schema.conversationParticipants).values({
      id: randomUUID(),
      conversationId,
      userId: principal.user.id,
      joinedAt: new Date(),
    });
    events.publish(conversationId, {
      type: "participant.joined",
      participant: { userId: principal.user.id, name: principal.user.name },
    });
  }

  function agentErrorResponse(c: Parameters<Parameters<typeof app.openapi>[1]>[0], error: unknown) {
    if (error instanceof AgentError) {
      return c.json({ error: error.message }, error.status);
    }
    console.error("Agent operation failed:", error);
    return c.json({ error: "Agent operation failed" }, 502);
  }

  app.openapi(listRoute, async (c) => {
    const access = await requireOrganizationAccess(
      db,
      c.get("principal"),
      c.req.query("organizationId")
    );
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const rows = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.organizationId, access.organizationId))
      .orderBy(desc(schema.conversations.updatedAt));
    return c.json(rows.map(serializeConversation), 200);
  });

  app.openapi(createRoute_, async (c) => {
    const parsed = CreateConversationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
    }
    const principal = c.get("principal");
    const access = await requireOrganizationAccess(db, principal, parsed.data.organizationId);
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const now = new Date();
    const [row] = await db
      .insert(schema.conversations)
      .values({
        id: randomUUID(),
        organizationId: access.organizationId,
        title: parsed.data.title ?? `Conversation ${now.toLocaleDateString("en-CA")}`,
        createdById: principal.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await ensureParticipant(row.id, principal);
    return c.json(await detail(row), 201);
  });

  app.openapi(getRoute, async (c) => {
    const found = await loadAuthorized(c.get("principal"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    return c.json(await detail(found.conversation), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const principal = c.get("principal");
    const found = await loadAuthorized(principal, c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    const { conversation, membership } = found;
    const allowed =
      conversation.createdById === principal.user.id ||
      membership.role === "owner" ||
      membership.role === "admin";
    if (!allowed) {
      return c.json(
        { error: "Only the creator, admins and owners can delete a conversation" },
        403
      );
    }
    if (conversation.agentVmId) {
      await agents.detach(conversation.id).catch(() => {});
    }
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversation.id));
    return c.json({ success: true }, 200);
  });

  app.openapi(listMessagesRoute, async (c) => {
    const found = await loadAuthorized(c.get("principal"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    const { after, limit } = c.req.valid("query");

    const conditions = [eq(schema.conversationMessages.conversationId, found.conversation.id)];
    if (after) {
      const since = new Date(after);
      if (!Number.isNaN(since.getTime())) {
        conditions.push(gt(schema.conversationMessages.createdAt, since));
      }
    }
    const rows = await db
      .select()
      .from(schema.conversationMessages)
      .where(and(...conditions))
      // rowid breaks ties between messages stored in the same millisecond.
      .orderBy(asc(schema.conversationMessages.createdAt), sql`rowid`)
      .limit(limit ?? 500);
    return c.json(rows.map(serializeMessage), 200);
  });

  app.openapi(postMessageRoute, async (c) => {
    const principal = c.get("principal");
    const found = await loadAuthorized(principal, c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    const parsed = PostMessageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
    }

    const { conversation } = found;
    await ensureParticipant(conversation.id, principal);

    const now = new Date();
    const [message] = await db
      .insert(schema.conversationMessages)
      .values({
        id: randomUUID(),
        conversationId: conversation.id,
        authorKind: "user",
        authorId: principal.user.id,
        authorName: principal.user.name,
        body: parsed.data.body,
        parts: [],
        status: "complete",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversations.id, conversation.id));
    events.publish(conversation.id, { type: "message.created", message });

    if (conversation.agentVmId && conversation.agentSessionId) {
      try {
        await agents.send(conversation, message);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return c.json({ ...serializeMessage(message), agentError: detail }, 502);
      }
    }
    return c.json(serializeMessage(message), 201);
  });

  app.openapi(eventsRoute, async (c) => {
    const found = await loadAuthorized(c.get("principal"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    const conversationId = found.conversation.id;

    return streamSSE(c, async (stream) => {
      let closed = false;
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        finish = () => {
          closed = true;
          resolve();
        };
      });

      let counter = 0;
      const write = (event: string, data: unknown) => {
        if (closed) return Promise.resolve();
        return (
          stream
            .writeSSE({ event, data: JSON.stringify(data), id: String(++counter) })
            // A failed write means the client went away.
            .catch(() => finish())
        );
      };

      // Tell the client the stream is live; also lets tests know it connected.
      await write("ready", { conversationId });

      const unsubscribe = events.subscribe(conversationId, (event) => {
        const payload =
          event.type === "message.created" || event.type === "message.updated"
            ? serializeMessage(event.message)
            : event.type === "conversation.updated"
              ? serializeConversation(event.conversation)
              : event.participant;
        void write(event.type, payload);
      });

      // Keep intermediaries from closing an idle stream.
      const keepAlive = setInterval(() => void write("ping", {}), 25_000);

      stream.onAbort(() => finish());
      c.req.raw.signal.addEventListener("abort", () => finish(), { once: true });
      await done;

      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.openapi(attachAgentRoute, async (c) => {
    const principal = c.get("principal");
    const found = await loadAuthorized(principal, c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    const parsed = AttachAgentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
    }
    if (agents.pending(found.conversation.id)) {
      return c.json({ error: "An agent is already being attached to this conversation" }, 409);
    }

    // Validate synchronously what can be validated, then provision in the
    // background: SSH plus server start-up takes seconds, and the event stream
    // carries the outcome.
    const [vm] = await db
      .select()
      .from(schema.vms)
      .where(
        and(
          eq(schema.vms.id, parsed.data.vmId),
          eq(schema.vms.organizationId, found.conversation.organizationId)
        )
      );
    if (!vm) return c.json({ error: "VM not found" }, 404);
    if (vm.status !== "running") {
      return c.json({ error: "The VM must be running before an agent can use it" }, 400);
    }
    const keys = await db
      .select({ id: schema.providerCredentials.id })
      .from(schema.providerCredentials)
      .where(eq(schema.providerCredentials.organizationId, found.conversation.organizationId));
    if (keys.length === 0) {
      return c.json(
        { error: "Configure at least one provider API key in Settings before attaching an agent" },
        400
      );
    }

    await ensureParticipant(found.conversation.id, principal);
    const task = agents.attach(found.conversation.id, {
      vmId: parsed.data.vmId,
      model: parsed.data.model ?? null,
    });
    task.catch((error) => console.warn(`[agent] attach failed: ${String(error)}`));

    // Give a fast provisioner (tests, a warm VM) the chance to finish before
    // answering, without making a slow one hold the request.
    await Promise.race([task.catch(() => {}), new Promise((r) => setTimeout(r, 50))]);
    const [row] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, found.conversation.id));
    return c.json(await detail(row), 202);
  });

  app.openapi(detachAgentRoute, async (c) => {
    const found = await loadAuthorized(c.get("principal"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    const row = await agents.detach(found.conversation.id);
    return c.json(await detail(row), 200);
  });

  app.openapi(interruptAgentRoute, async (c) => {
    const found = await loadAuthorized(c.get("principal"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    try {
      await agents.interrupt(found.conversation.id);
      return c.json({ success: true }, 200);
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.openapi(agentModelsRoute, async (c) => {
    const found = await loadAuthorized(c.get("principal"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Conversation not found" }, 404);
    try {
      return c.json(await agents.listModels(found.conversation.id), 200);
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  return app;
}
