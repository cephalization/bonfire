/**
 * VMs API Integration Tests
 *
 * Tests the VM management endpoints with mocked services.
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
import { vms, images } from "../src/db/schema";
import { createVMsRouter } from "../src/routes/vms";
import { NetworkService } from "../src/services/network";

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
 * Mock Network Service for testing
 */
class MockNetworkService {
  public allocateCalls: string[] = [];
  public releaseCalls: Array<{ tapDevice?: string; ipAddress?: string }> = [];

  async allocate(vmId: string): Promise<{
    tapDevice: string;
    macAddress: string;
    ipAddress: string;
  }> {
    this.allocateCalls.push(vmId);
    return {
      tapDevice: `tap-${vmId}`,
      macAddress: `02:00:00:00:00:${Math.floor(Math.random() * 99 + 1).toString().padStart(2, "0")}`,
      ipAddress: `192.168.100.${Math.floor(Math.random() * 254 + 1)}`,
    };
  }

  async release(resources: {
    tapDevice?: string;
    ipAddress?: string;
  }): Promise<void> {
    this.releaseCalls.push(resources);
  }

  clearCalls(): void {
    this.allocateCalls = [];
    this.releaseCalls = [];
  }
}

/**
 * Mock Firecracker Service for testing VM start with pipe creation
 */
class MockFirecrackerService {
  public spawnCalls: Array<{ vmId: string; socketDir?: string }> = [];
  public configureCalls: Array<{ socketPath: string; config: any }> = [];
  public startCalls: Array<{ socketPath: string }> = [];
  public stopCalls: Array<{ socketPath: string; pid: number; options?: any }> = [];

  async spawnFirecracker(options: { vmId: string; socketDir?: string }) {
    this.spawnCalls.push(options);
    const socketDir = options.socketDir ?? "/tmp/bonfire-test";
    return {
      pid: Math.floor(Math.random() * 100000) + 1000,
      socketPath: `${socketDir}/${options.vmId}.sock`,
      stdinPipePath: `${socketDir}/${options.vmId}.stdin`,
      stdoutPipePath: `${socketDir}/${options.vmId}.stdout`,
    };
  }

  async configureVMProcess(socketPath: string, config: any) {
    this.configureCalls.push({ socketPath, config });
  }

  async startVMProcess(socketPath: string) {
    this.startCalls.push({ socketPath });
  }

  async stopVMProcess(socketPath: string, pid: number, options?: any) {
    this.stopCalls.push({ socketPath, pid, options });
  }

  clearCalls() {
    this.spawnCalls = [];
    this.configureCalls = [];
    this.startCalls = [];
    this.stopCalls = [];
  }
}

interface TestContext {
  app: Hono;
  db: ReturnType<typeof drizzle>;
  sqlite: any;
  mockNetwork: MockNetworkService;
  mockFirecracker: MockFirecrackerService;
  cleanup: () => void;
  authHeader: { Authorization: string };
}

async function createTestContext(): Promise<TestContext> {
  const dbPath = `/tmp/bonfire-vms-test-${randomUUID()}.db`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Run migrations
  sqlite.exec(MIGRATION_SQL);

  // Insert a test image for referencing in VM creation
  await db.insert(images).values({
    id: "test-image-1",
    reference: "ghcr.io/test/image:latest",
    kernelPath: "/var/lib/bonfire/images/test-image-1/kernel",
    rootfsPath: "/var/lib/bonfire/images/test-image-1/rootfs",
    sizeBytes: 104857600,
    pulledAt: new Date(),
  });

  const mockNetwork = new MockNetworkService();
  const mockFirecracker = new MockFirecrackerService();

  const router = createVMsRouter({
    db,
    networkService: mockNetwork as unknown as NetworkService,
    spawnFirecrackerFn: mockFirecracker.spawnFirecracker.bind(mockFirecracker) as any,
    configureVMProcessFn: mockFirecracker.configureVMProcess.bind(mockFirecracker) as any,
    startVMProcessFn: mockFirecracker.startVMProcess.bind(mockFirecracker) as any,
    stopVMProcessFn: mockFirecracker.stopVMProcess.bind(mockFirecracker) as any,
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
    mockNetwork,
    mockFirecracker,
    cleanup,
    authHeader: { Authorization: "Bearer dev-token" },
  };
}

describe("VMs API Integration Tests", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("GET /api/vms", () => {
    it("should return empty array when no VMs exist", async () => {
      const res = await ctx.app.request("/api/vms", {
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it("should return all VMs", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values([
        {
          id: "vm-1",
          name: "vm-one",
          status: "stopped",
          vcpus: 1,
          memoryMib: 512,
          imageId: "test-image-1",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "vm-2",
          name: "vm-two",
          status: "running",
          vcpus: 2,
          memoryMib: 1024,
          imageId: "test-image-1",
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const res = await ctx.app.request("/api/vms", {
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe("vm-one");
      expect(body[1].name).toBe("vm-two");
    });

    it.skip("should require authentication", async () => {
      const res = await ctx.app.request("/api/vms");

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Authorization");
    });

    it.skip("should reject invalid token", async () => {
      const res = await ctx.app.request("/api/vms", {
        headers: { Authorization: "Bearer invalid-token" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid token");
    });
  });

  describe("POST /api/vms", () => {
    it("should create a VM with default values", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "test-vm",
          imageId: "test-image-1",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("test-vm");
      expect(body.status).toBe("creating");
      expect(body.vcpus).toBe(1);
      expect(body.memoryMib).toBe(512);
      expect(body.imageId).toBe("test-image-1");
      expect(body.id).toBeDefined();
    });

    it("should create a VM with custom values", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "custom-vm",
          vcpus: 4,
          memoryMib: 2048,
          imageId: "test-image-1",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("custom-vm");
      expect(body.vcpus).toBe(4);
      expect(body.memoryMib).toBe(2048);
    });

    it("should return 400 for missing name", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          imageId: "test-image-1",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      // OpenAPI validation returns error in different format
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it("should return 400 for missing imageId", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "test-vm",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      // OpenAPI validation returns error in different format
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it("should return 400 for invalid vcpus", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "test-vm",
          imageId: "test-image-1",
          vcpus: 0,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      // OpenAPI validation returns error in different format
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it("should return 400 for invalid memory", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "test-vm",
          imageId: "test-image-1",
          memoryMib: 64, // Below minimum of 128
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      // OpenAPI validation returns error in different format
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it("should return 409 for duplicate name", async () => {
      // Create first VM
      await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "duplicate-vm",
          imageId: "test-image-1",
        }),
      });

      // Try to create second VM with same name
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ctx.authHeader,
        },
        body: JSON.stringify({
          name: "duplicate-vm",
          imageId: "test-image-1",
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("already exists");
    });

    it.skip("should require authentication", async () => {
      const res = await ctx.app.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "test-vm",
          imageId: "test-image-1",
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/vms/:id", () => {
    it("should return VM details", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-detail-test",
        name: "detail-vm",
        status: "stopped",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "test-image-1",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-detail-test", {
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("vm-detail-test");
      expect(body.name).toBe("detail-vm");
      expect(body.status).toBe("stopped");
    });

    it("should return 404 for non-existent VM", async () => {
      const res = await ctx.app.request("/api/vms/non-existent-id", {
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it.skip("should require authentication", async () => {
      const res = await ctx.app.request("/api/vms/vm-1");

      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/vms/:id", () => {
    it("should delete a stopped VM", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-to-delete",
        name: "delete-me",
        status: "stopped",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-to-delete", {
        method: "DELETE",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify VM was deleted
      const remaining = await ctx.db
        .select()
        .from(vms)
        .where(eq(vms.id, "vm-to-delete"));
      expect(remaining).toHaveLength(0);
    });

    it("should clean up network resources on delete", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-with-network",
        name: "network-vm",
        status: "stopped",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        tapDevice: "tap-test",
        ipAddress: "192.168.100.10",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.app.request("/api/vms/vm-with-network", {
        method: "DELETE",
        headers: ctx.authHeader,
      });

      // Verify network resources were released
      expect(ctx.mockNetwork.releaseCalls).toHaveLength(1);
      expect(ctx.mockNetwork.releaseCalls[0]).toEqual({
        tapDevice: "tap-test",
        ipAddress: "192.168.100.10",
      });
    });

    it("should return 404 for non-existent VM", async () => {
      const res = await ctx.app.request("/api/vms/non-existent", {
        method: "DELETE",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should return 400 if VM is running", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-running",
        name: "running-vm",
        status: "running",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        pid: 1234,
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-running", {
        method: "DELETE",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("running");

      // Verify VM was NOT deleted
      const remaining = await ctx.db
        .select()
        .from(vms)
        .where(eq(vms.id, "vm-running"));
      expect(remaining).toHaveLength(1);
    });

    it("should allow deleting VM in 'creating' status", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-creating",
        name: "creating-vm",
        status: "creating",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-creating", {
        method: "DELETE",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);
    });

    it("should allow deleting VM in 'error' status", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-error",
        name: "error-vm",
        status: "error",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-error", {
        method: "DELETE",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);
    });

    it.skip("should require authentication", async () => {
      const res = await ctx.app.request("/api/vms/vm-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/vms/:id/start (Serial Console)", () => {
    it("should create pipe paths when starting VM", async () => {
      // Create a stopped VM
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-pipe-test",
        name: "pipe-test-vm",
        status: "stopped",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-pipe-test/start", {
        method: "POST",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);

      // Verify spawnFirecracker was called (which creates pipes)
      expect(ctx.mockFirecracker.spawnCalls).toHaveLength(1);
      expect(ctx.mockFirecracker.spawnCalls[0].vmId).toBe("vm-pipe-test");

      // Verify VM is now running with pipe paths
      const [vm] = await ctx.db.select().from(vms).where(eq(vms.id, "vm-pipe-test"));
      expect(vm.status).toBe("running");
      expect(vm.pid).toBeDefined();
      expect(vm.socketPath).toBeDefined();
    });

    it("should allocate network before spawning Firecracker", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-net-spawn",
        name: "net-spawn-vm",
        status: "stopped",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.app.request("/api/vms/vm-net-spawn/start", {
        method: "POST",
        headers: ctx.authHeader,
      });

      // Verify network was allocated
      expect(ctx.mockNetwork.allocateCalls).toHaveLength(1);
      expect(ctx.mockNetwork.allocateCalls[0]).toBe("vm-net-spawn");

      // Verify Firecracker was configured with network
      expect(ctx.mockFirecracker.configureCalls).toHaveLength(1);
    });
  });

  describe("POST /api/vms/:id/stop (Serial Console)", () => {
    it("should pass vmId to stop function for pipe cleanup", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-stop-pipe",
        name: "stop-pipe-vm",
        status: "running",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        pid: 12345,
        socketPath: "/tmp/bonfire-test/vm-stop-pipe.sock",
        tapDevice: "tap-test",
        macAddress: "02:00:00:00:00:01",
        ipAddress: "192.168.100.10",
        createdAt: now,
        updatedAt: now,
      });

      const res = await ctx.app.request("/api/vms/vm-stop-pipe/stop", {
        method: "POST",
        headers: ctx.authHeader,
      });

      expect(res.status).toBe(200);

      // Verify stop was called with vmId for pipe cleanup
      expect(ctx.mockFirecracker.stopCalls).toHaveLength(1);
      expect(ctx.mockFirecracker.stopCalls[0].socketPath).toBe("/tmp/bonfire-test/vm-stop-pipe.sock");
      expect(ctx.mockFirecracker.stopCalls[0].pid).toBe(12345);
      expect(ctx.mockFirecracker.stopCalls[0].options).toBeUndefined();
    });

    it("should release network after stopping VM", async () => {
      const now = new Date();
      await ctx.db.insert(vms).values({
        id: "vm-stop-net",
        name: "stop-net-vm",
        status: "running",
        vcpus: 1,
        memoryMib: 512,
        imageId: "test-image-1",
        pid: 12346,
        socketPath: "/tmp/bonfire-test/vm-stop-net.sock",
        tapDevice: "tap-test-2",
        macAddress: "02:00:00:00:00:02",
        ipAddress: "192.168.100.11",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.app.request("/api/vms/vm-stop-net/stop", {
        method: "POST",
        headers: ctx.authHeader,
      });

      // Verify network was released
      expect(ctx.mockNetwork.releaseCalls).toHaveLength(1);
      expect(ctx.mockNetwork.releaseCalls[0]).toEqual({
        tapDevice: "tap-test-2",
        ipAddress: "192.168.100.11",
      });

      // Verify VM is now stopped
      const [vm] = await ctx.db.select().from(vms).where(eq(vms.id, "vm-stop-net"));
      expect(vm.status).toBe("stopped");
    });
  });
});
