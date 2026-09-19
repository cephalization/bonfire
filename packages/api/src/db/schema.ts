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

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("vms_organization_id_idx").on(t.organizationId)]
);

// Export types for convenience
export type VM = typeof vms.$inferSelect;
export type NewVM = typeof vms.$inferInsert;
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type User = typeof user.$inferSelect;
export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
