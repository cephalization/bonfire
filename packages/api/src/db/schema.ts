import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Better Auth tables
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const vms = sqliteTable("vms", {
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

  // Runtime state (set when VM starts)
  pid: integer("pid"),
  socketPath: text("socket_path"),
  tapDevice: text("tap_device"),
  macAddress: text("mac_address"),
  ipAddress: text("ip_address"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  kernelPath: text("kernel_path").notNull(),
  rootfsPath: text("rootfs_path").notNull(),
  sizeBytes: integer("size_bytes"),
  pulledAt: integer("pulled_at", { mode: "timestamp" }).notNull(),
});

// Export types for convenience
export type VM = typeof vms.$inferSelect;
export type NewVM = typeof vms.$inferInsert;
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
