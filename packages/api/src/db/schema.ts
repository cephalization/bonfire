import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ============================================================================
// Authentication (Better Auth)
//
// Table variable names must match Better Auth's model names (`user`, `session`,
// `account`, `verification`, `organization`, `member`, `invitation`, `apikey`)
// because the Drizzle adapter looks tables up by model name. Column names are
// snake_case in SQLite to match the rest of the schema; the adapter only cares
// about the TypeScript property names.
//
// If you change anything here you must generate a migration:
//   pnpm --filter @bonfire/api db:generate
// ============================================================================

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
};

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Set by the organization plugin; the org a browser session is "in". */
    activeOrganizationId: text("active_organization_id"),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

// ============================================================================
// Organizations (Better Auth organization plugin)
// ============================================================================

export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** One of `owner`, `admin`, `member`. */
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("member_organization_user_unique").on(t.organizationId, t.userId),
    index("member_user_id_idx").on(t.userId),
  ]
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status", { enum: ["pending", "accepted", "rejected", "canceled"] })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("invitation_organization_id_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ]
);

// ============================================================================
// API keys (Better Auth api-key plugin)
//
// A key belongs to a user (`referenceId`). Which organization it acts in is
// stored in `metadata` as `{ organizationId }` when the key is created; the
// user's membership in that org is re-checked on every request.
// ============================================================================

export const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull(),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    /** Hashed; the plaintext is only ever returned once, at creation. */
    key: text("key").notNull(),
    referenceId: text("reference_id").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: integer("last_refill_at", { mode: "timestamp" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" }).notNull().default(false),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: integer("last_request", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    permissions: text("permissions"),
    metadata: text("metadata"),
    ...timestamps,
  },
  (t) => [index("apikey_reference_id_idx").on(t.referenceId)]
);

// ============================================================================
// Application
// ============================================================================

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  kernelPath: text("kernel_path").notNull(),
  rootfsPath: text("rootfs_path").notNull(),
  sizeBytes: integer("size_bytes"),
  pulledAt: integer("pulled_at", { mode: "timestamp" }).notNull(),
});

export const vms = sqliteTable(
  "vms",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    status: text("status", {
      enum: ["creating", "running", "stopped", "error"],
    })
      .notNull()
      .default("creating"),
    vcpus: integer("vcpus").notNull().default(1),
    memoryMib: integer("memory_mib").notNull().default(512),
    imageId: text("image_id").references(() => images.id),

    /**
     * The organization that owns the VM. Every VM created through the API has
     * one; rows from before organizations existed have null and are not
     * reachable through the API.
     */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),

    // Runtime state (set when VM starts)
    pid: integer("pid"),
    socketPath: text("socket_path"),
    tapDevice: text("tap_device"),
    macAddress: text("mac_address"),
    ipAddress: text("ip_address"),

    /**
     * Basic-auth password of the opencode server Bonfire started in this VM,
     * encrypted with lib/secrets.ts. Null until an agent is first attached.
     */
    agentPasswordCiphertext: text("agent_password_ciphertext"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("vms_organization_id_idx").on(t.organizationId)]
);

// ============================================================================
// Conversations
//
// A conversation belongs to an organization. Members post messages; at most
// one agent (an opencode server running in one of the organization's VMs) can
// be attached and takes part as a participant. See services/agent/.
// ============================================================================

/**
 * An LLM provider API key an organization admin configured. The key itself is
 * stored encrypted (lib/secrets.ts); `keyHint` is the last few characters so
 * the UI can show which key is set. Keys are written into a VM's opencode
 * configuration when an agent is attached to a conversation.
 */
export const providerCredentials = sqliteTable(
  "provider_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** opencode provider id: "anthropic", "openai", "google", ... */
    providerId: text("provider_id").notNull(),
    label: text("label"),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyHint: text("key_hint").notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("provider_credentials_org_provider_idx").on(t.organizationId, t.providerId)]
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),

    /** The VM the attached agent runs in; null when no agent is attached. */
    agentVmId: text("agent_vm_id").references(() => vms.id, { onDelete: "set null" }),
    /** "providerID/modelID" the agent was asked to use; null lets opencode pick. */
    agentModel: text("agent_model"),
    /** opencode session id inside the VM. */
    agentSessionId: text("agent_session_id"),
    agentStatus: text("agent_status", {
      enum: ["offline", "provisioning", "idle", "busy", "error"],
    })
      .notNull()
      .default("offline"),
    agentError: text("agent_error"),

    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("conversations_organization_id_idx").on(t.organizationId)]
);

export const conversationParticipants = sqliteTable(
  "conversation_participants",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("conversation_participants_conversation_user_idx").on(t.conversationId, t.userId),
  ]
);

export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorKind: text("author_kind", { enum: ["user", "agent", "system"] }).notNull(),
    /** opencode message id for agent messages, so replayed events do not duplicate rows. */
    externalId: text("external_id"),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Display name at the time of posting, so history survives account changes. */
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    /**
     * JSON array of message parts for agent messages: tool calls, errors and
     * the like, in the order they happened. See services/agent/manager.ts.
     */
    parts: text("parts", { mode: "json" }).$type<MessagePart[]>().notNull().default([]),
    status: text("status", { enum: ["complete", "streaming", "error"] })
      .notNull()
      .default("complete"),
    // Millisecond precision: messages arrive faster than once a second and
    // clients order and page by this.
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("conversation_messages_conversation_created_idx").on(t.conversationId, t.createdAt)]
);

/** A run of text the agent wrote. `body` holds all text parts joined. */
export type TextMessagePart = { type: "text"; id: string; text: string };

/** A tool call the agent made while producing a message. */
export type ToolMessagePart = {
  type: "tool";
  callId: string;
  name: string;
  status: "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
};

export type ErrorMessagePart = { type: "error"; message: string };

/**
 * Agent messages are stored as ordered parts (text, tool calls, errors) so the
 * UI can show what happened in sequence. User messages have no parts.
 */
export type MessagePart = TextMessagePart | ToolMessagePart | ErrorMessagePart;

// Export types for convenience
export type VM = typeof vms.$inferSelect;
export type NewVM = typeof vms.$inferInsert;
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type User = typeof user.$inferSelect;
export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
