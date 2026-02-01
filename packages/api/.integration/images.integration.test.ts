/**
 * Images API Integration Tests
 *
 * Tests the image management endpoints with mocked RegistryService.
 * Uses isolated SQLite database for each test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { images, vms } from "../src/db/schema";
import { createImagesRouter } from "../src/routes/images";
import { RegistryService } from "../src/services/registry";

// Migration SQL to create tables
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS \`images\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`reference\` text NOT NULL,
  \`kernel_path\` text NOT NULL,
  \`rootfs_path\` text NOT NULL,
  \`size_bytes\` integer,
  \`pulled_at\` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS \`images_reference_unique\` ON \`images\` (\`reference\`);

CREATE TABLE IF NOT EXISTS \`vms\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`status\` text DEFAULT 'creating' NOT NULL,
  \`vcpus\` integer DEFAULT 1 NOT NULL,
  \`memory_mib\` integer DEFAULT 512 NOT NULL,
  \`image_id\` text,
  \`pid\` integer,
  \`socket_path\` text,
  \`tap_device\` text,
  \`mac_address\` text,
  \`ip_address\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS \`vms_name_unique\` ON \`vms\` (\`name\`);
`;

/**
 * Mock Registry Service for testing
 */
class MockRegistryService {
  private db: ReturnType<typeof drizzle>;
  public pullImageCalls: string[] = [];
  public deleteImageCalls: string[] = [];

  constructor(db: ReturnType<typeof drizzle>) {
    this.db = db;
  }

  async pullImage(reference: string): Promise<typeof schema.images.$inferSelect> {
    this.pullImageCalls.push(reference);

    const id = `img-${reference.replace(/[^a-zA-Z0-9]/g, "-")}`;
    const now = new Date();

    const newImage = {
      id,
      reference,
      kernelPath: `/var/lib/bonfire/images/${id}/kernel`,
      rootfsPath: `/var/lib/bonfire/images/${id}/rootfs`,
      sizeBytes: 104857600,
      pulledAt: now,
    };

    await this.db.insert(images).values(newImage).onConflictDoUpdate({
      target: images.reference,
      set: {
        kernelPath: newImage.kernelPath,
        rootfsPath: newImage.rootfsPath,
        sizeBytes: newImage.sizeBytes,
        pulledAt: now,
      },
    });

    const [image] = await this.db.select().from(images).where(eq(images.id, id));
    return image;
  }

  async deleteImage(imageId: string): Promise<void> {
    this.deleteImageCalls.push(imageId);
    await this.db.delete(images).where(eq(images.id, imageId));
  }

  clearCalls(): void {
    this.pullImageCalls = [];
    this.deleteImageCalls = [];
  }
}

interface TestContext {
  app: Hono;
  db: ReturnType<typeof drizzle>;
  sqlite: any;
  mockRegistry: MockRegistryService;
  cleanup: () => void;
}

async function createTestContext(): Promise<TestContext> {
  const dbPath = `/tmp/bonfire-images-test-${randomUUID()}.db`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Run migrations
  sqlite.exec(MIGRATION_SQL);

  const mockRegistry = new MockRegistryService(db);
  const router = createImagesRouter({
    db,
    registryService: mockRegistry as unknown as RegistryService,
  });

  const app = new Hono();
  app.route("/api", router);

  const cleanup = () => {
    try {
      sqlite.close();
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    app,
    db,
    sqlite,
    mockRegistry,
    cleanup,
  };
}

describe("Images API Integration Tests", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("GET /api/images", () => {
    it("should return empty array when no images exist", async () => {
      const res = await ctx.app.request("/api/images");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it("should return all cached images", async () => {
      // Insert test images directly into database
      const now = new Date();
      await ctx.db.insert(images).values([
        {
          id: "img-1",
          reference: "ghcr.io/test/image1:latest",
          kernelPath: "/var/lib/bonfire/images/img-1/kernel",
          rootfsPath: "/var/lib/bonfire/images/img-1/rootfs",
          sizeBytes: 1000000,
          pulledAt: now,
        },
        {
          id: "img-2",
          reference: "ghcr.io/test/image2:v1.0",
          kernelPath: "/var/lib/bonfire/images/img-2/kernel",
          rootfsPath: "/var/lib/bonfire/images/img-2/rootfs",
          sizeBytes: 2000000,
          pulledAt: now,
        },
      ]);

      const res = await ctx.app.request("/api/images");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe("img-1");
      expect(body[1].id).toBe("img-2");
      expect(body[0].reference).toBe("ghcr.io/test/image1:latest");
    });

    it("should serialize dates as ISO strings", async () => {
      const now = new Date();
      await ctx.db.insert(images).values({
        id: "img-1",
        reference: "ghcr.io/test/image:latest",
        kernelPath: "/var/lib/bonfire/images/img-1/kernel",
        rootfsPath: "/var/lib/bonfire/images/img-1/rootfs",
        sizeBytes: 1000000,
        pulledAt: now,
      });

      const res = await ctx.app.request("/api/images");

      expect(res.status).toBe(200);
      const body = await res.json();
      // SQLite stores timestamps as seconds, so milliseconds are lost
      expect(new Date(body[0].pulledAt).getTime()).toBe(
        Math.floor(now.getTime() / 1000) * 1000
      );
    });
  });

  describe("POST /api/images/pull", () => {
    it("should pull an image and return it", async () => {
      const reference = "ghcr.io/test/image:latest";

      const res = await ctx.app.request("/api/images/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });

      expect(res.status).toBe(201);
      expect(ctx.mockRegistry.pullImageCalls).toContain(reference);

      const body = await res.json();
      expect(body.reference).toBe(reference);
      expect(body.id).toBeDefined();
      expect(body.kernelPath).toBeDefined();
      expect(body.rootfsPath).toBeDefined();
      expect(body.pulledAt).toBeDefined();
    });

    it("should return 400 for missing reference", async () => {
      const res = await ctx.app.request("/api/images/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Reference is required");
    });

    it("should return 400 for empty reference", async () => {
      const res = await ctx.app.request("/api/images/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Reference is required");
    });

    it("should return 400 for empty reference", async () => {
      const res = await ctx.app.request("/api/images/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Reference is required");
    });
  });

  describe("DELETE /api/images/:id", () => {
    it("should delete an image that is not in use", async () => {
      // Insert a test image
      await ctx.db.insert(images).values({
        id: "img-to-delete",
        reference: "ghcr.io/test/delete-me:latest",
        kernelPath: "/var/lib/bonfire/images/img-to-delete/kernel",
        rootfsPath: "/var/lib/bonfire/images/img-to-delete/rootfs",
        sizeBytes: 1000000,
        pulledAt: new Date(),
      });

      const res = await ctx.app.request("/api/images/img-to-delete", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(ctx.mockRegistry.deleteImageCalls).toContain("img-to-delete");

      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify image was deleted from database
      const remaining = await ctx.db
        .select()
        .from(images)
        .where(eq(images.id, "img-to-delete"));
      expect(remaining).toHaveLength(0);
    });

    it("should return 404 for non-existent image", async () => {
      const res = await ctx.app.request("/api/images/non-existent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Image not found");
    });

    it("should return 400 if image is in use by VMs", async () => {
      // Insert a test image
      await ctx.db.insert(images).values({
        id: "img-in-use",
        reference: "ghcr.io/test/in-use:latest",
        kernelPath: "/var/lib/bonfire/images/img-in-use/kernel",
        rootfsPath: "/var/lib/bonfire/images/img-in-use/rootfs",
        sizeBytes: 1000000,
        pulledAt: new Date(),
      });

      // Insert a VM using this image
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-1",
        name: "test-vm",
        status: "running",
        vcpus: 1,
        memoryMib: 512,
        imageId: "img-in-use",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/images/img-in-use", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("in use by 1 VM(s)");

      // Verify image was NOT deleted
      const remaining = await ctx.db
        .select()
        .from(images)
        .where(eq(images.id, "img-in-use"));
      expect(remaining).toHaveLength(1);
    });

    it("should detect multiple VMs using the image", async () => {
      // Insert a test image
      await ctx.db.insert(images).values({
        id: "img-shared",
        reference: "ghcr.io/test/shared:latest",
        kernelPath: "/var/lib/bonfire/images/img-shared/kernel",
        rootfsPath: "/var/lib/bonfire/images/img-shared/rootfs",
        sizeBytes: 1000000,
        pulledAt: new Date(),
      });

      // Insert multiple VMs using this image
      const now = new Date();
      await ctx.db.insert(vms).values([
        {
          id: "vm-1",
          name: "vm-one",
          status: "running",
          vcpus: 1,
          memoryMib: 512,
          imageId: "img-shared",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "vm-2",
          name: "vm-two",
          status: "stopped",
          vcpus: 2,
          memoryMib: 1024,
          imageId: "img-shared",
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const res = await ctx.app.request("/api/images/img-shared", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("in use by 2 VM(s)");
    });
  });
});
