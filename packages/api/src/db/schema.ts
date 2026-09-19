import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
