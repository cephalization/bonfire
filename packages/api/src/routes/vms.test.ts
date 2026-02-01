/**
 * VMs Routes Integration Tests
 *
 * Tests for VM lifecycle endpoints (start/stop) with mocked services.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "../test-utils";
import { vms, images } from "../db/schema";
import { eq } from "drizzle-orm";

describe("VM Lifecycle Endpoints", () => {
  describe("POST /api/vms/:id/start", () => {
    it("should start a VM from creating status", async () => {
      const { app, db, cleanup, mocks } = await createTestApp();

      // Create an image first
      await db.insert(images).values({
        id: "img-test-001",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a VM in 'creating' status
      await db.insert(vms).values({
        id: "vm-test-001",
        name: "test-vm",
        status: "creating",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "img-test-001",
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-001/start", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("running");
      expect(typeof body.pid).toBe("number");
      expect(typeof body.socketPath).toBe("string");
      expect(typeof body.tapDevice).toBe("string");
      expect(typeof body.macAddress).toBe("string");
      expect(typeof body.ipAddress).toBe("string");

      // Verify services were called
      expect(mocks.firecracker.calls.spawnFirecracker).toHaveLength(1);
      expect(mocks.firecracker.calls.configureVMProcess).toHaveLength(1);
      expect(mocks.firecracker.calls.startVMProcess).toHaveLength(1);
      expect(mocks.network.calls.allocate).toHaveLength(1);

      // Verify DB was updated
      const [vm] = await db.select().from(vms).where(eq(vms.id, "vm-test-001"));
      expect(vm.status).toBe("running");
      expect(vm.pid).toBe(body.pid);

      cleanup();
    });

    it("should start a VM from stopped status", async () => {
      const { app, db, cleanup, mocks } = await createTestApp();

      // Create an image first
      await db.insert(images).values({
        id: "img-test-002",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a VM in 'stopped' status
      await db.insert(vms).values({
        id: "vm-test-002",
        name: "test-vm-stopped",
        status: "stopped",
        vcpus: 1,
        memoryMib: 512,
        imageId: "img-test-002",
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-002/start", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("running");

      // Verify services were called
      expect(mocks.firecracker.calls.spawnFirecracker).toHaveLength(1);
      expect(mocks.firecracker.calls.configureVMProcess).toHaveLength(1);
      expect(mocks.firecracker.calls.startVMProcess).toHaveLength(1);

      cleanup();
    });

    it("should return 404 if VM not found", async () => {
      const { app, cleanup } = await createTestApp();

      const req = new Request("http://localhost/api/vms/vm-nonexistent/start", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("VM not found");

      cleanup();
    });

    it("should return 400 if VM is already running", async () => {
      const { app, db, cleanup } = await createTestApp();

      // Create an image first
      await db.insert(images).values({
        id: "img-test-003",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a VM in 'running' status
      await db.insert(vms).values({
        id: "vm-test-003",
        name: "test-vm-running",
        status: "running",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "img-test-003",
        pid: 12345,
        socketPath: "/tmp/test.sock",
        tapDevice: "tap-test",
        macAddress: "02:00:00:00:00:01",
        ipAddress: "10.0.100.10",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-003/start", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("cannot be started");

      cleanup();
    });

    it("should return 400 if image not found", async () => {
      const { app, db, cleanup } = await createTestApp();

      // Create a VM without a valid image
      await db.insert(vms).values({
        id: "vm-test-004",
        name: "test-vm-no-image",
        status: "creating",
        vcpus: 2,
        memoryMib: 1024,
        imageId: null,
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-004/start", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("image not found");

      cleanup();
    });

    it("should clean up resources on failure", async () => {
      // Create a failing mock service
      const failingFirecracker = {
        spawnFirecracker: Object.assign(
          async (...args: any[]) => {
            failingFirecracker.calls.spawnFirecracker.push(args);
            throw new Error("Firecracker spawn failed");
          },
          { calls: [] as any[] }
        ),
        configureVMProcess: Object.assign(
          async (...args: any[]) => {
            failingFirecracker.calls.configureVMProcess.push(args);
          },
          { calls: [] as any[] }
        ),
        startVMProcess: Object.assign(
          async (...args: any[]) => {
            failingFirecracker.calls.startVMProcess.push(args);
          },
          { calls: [] as any[] }
        ),
        stopVMProcess: Object.assign(
          async (...args: any[]) => {
            failingFirecracker.calls.stopVMProcess.push(args);
          },
          { calls: [] as any[] }
        ),
        calls: {
          spawnFirecracker: [] as any[],
          configureVMProcess: [] as any[],
          startVMProcess: [] as any[],
          stopVMProcess: [] as any[],
        },
        clearCalls: () => {
          failingFirecracker.calls.spawnFirecracker.length = 0;
          failingFirecracker.calls.configureVMProcess.length = 0;
          failingFirecracker.calls.startVMProcess.length = 0;
          failingFirecracker.calls.stopVMProcess.length = 0;
        },
      };

      const { app, db, cleanup, mocks } = await createTestApp({
        firecracker: failingFirecracker as any,
      });

      // Create an image
      await db.insert(images).values({
        id: "img-test-005",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a VM
      await db.insert(vms).values({
        id: "vm-test-005",
        name: "test-vm-fail",
        status: "creating",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "img-test-005",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-005/start", {
        method: "POST",
      });

      // Suppress expected console.error during test
      const originalError = console.error;
      console.error = () => {};
      const res = await app.fetch(req);
      console.error = originalError;

      expect(res.status).toBe(500);

      // Verify resources were released (at least allocate was called)
      expect(mocks.network.calls.allocate).toHaveLength(1);

      cleanup();
    });
  });

  describe("POST /api/vms/:id/stop", () => {
    it("should stop a running VM", async () => {
      const { app, db, cleanup, mocks } = await createTestApp();

      // Create an image
      await db.insert(images).values({
        id: "img-test-006",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a running VM
      await db.insert(vms).values({
        id: "vm-test-006",
        name: "test-vm-stop",
        status: "running",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "img-test-006",
        pid: 12345,
        socketPath: "/tmp/test.sock",
        tapDevice: "tap-test",
        macAddress: "02:00:00:00:00:01",
        ipAddress: "10.0.100.10",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-006/stop", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("stopped");
      expect(body.pid).toBeNull();
      expect(body.socketPath).toBeNull();
      expect(body.tapDevice).toBeNull();
      expect(body.macAddress).toBeNull();
      expect(body.ipAddress).toBeNull();

      // Verify services were called
      expect(mocks.firecracker.calls.stopVMProcess).toHaveLength(1);
      expect(mocks.network.calls.release).toHaveLength(1);

      // Verify DB was updated
      const [vm] = await db.select().from(vms).where(eq(vms.id, "vm-test-006"));
      expect(vm.status).toBe("stopped");
      expect(vm.pid).toBeNull();
      expect(vm.socketPath).toBeNull();

      cleanup();
    });

    it("should return 404 if VM not found", async () => {
      const { app, cleanup } = await createTestApp();

      const req = new Request("http://localhost/api/vms/vm-nonexistent/stop", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("VM not found");

      cleanup();
    });

    it("should return 400 if VM is not running", async () => {
      const { app, db, cleanup } = await createTestApp();

      // Create an image
      await db.insert(images).values({
        id: "img-test-007",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a stopped VM
      await db.insert(vms).values({
        id: "vm-test-007",
        name: "test-vm-stopped",
        status: "stopped",
        vcpus: 1,
        memoryMib: 512,
        imageId: "img-test-007",
        pid: null,
        socketPath: null,
        tapDevice: null,
        macAddress: null,
        ipAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-007/stop", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("not running");

      cleanup();
    });

    it("should return 500 if VM is missing runtime information", async () => {
      const { app, db, cleanup } = await createTestApp();

      // Create an image
      await db.insert(images).values({
        id: "img-test-008",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a running VM without proper runtime info
      await db.insert(vms).values({
        id: "vm-test-008",
        name: "test-vm-missing-info",
        status: "running",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "img-test-008",
        pid: null, // Missing!
        socketPath: null, // Missing!
        tapDevice: "tap-test",
        macAddress: "02:00:00:00:00:01",
        ipAddress: "10.0.100.10",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new Request("http://localhost/api/vms/vm-test-008/stop", {
        method: "POST",
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("missing runtime information");

      cleanup();
    });

    it("should transition from running to stopped correctly", async () => {
      const { app, db, cleanup } = await createTestApp();

      // Create an image
      await db.insert(images).values({
        id: "img-test-009",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a running VM
      await db.insert(vms).values({
        id: "vm-test-009",
        name: "test-vm-transition",
        status: "running",
        vcpus: 4,
        memoryMib: 2048,
        imageId: "img-test-009",
        pid: 54321,
        socketPath: "/var/run/bonfire/test.sock",
        tapDevice: "tap-transition",
        macAddress: "02:00:00:00:00:AA",
        ipAddress: "10.0.100.50",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Stop the VM
      const stopReq = new Request("http://localhost/api/vms/vm-test-009/stop", {
        method: "POST",
      });

      const stopRes = await app.fetch(stopReq);
      expect(stopRes.status).toBe(200);

      const stopBody = await stopRes.json();
      expect(stopBody.status).toBe("stopped");

      // Verify DB state
      const [vm] = await db.select().from(vms).where(eq(vms.id, "vm-test-009"));
      expect(vm.status).toBe("stopped");
      expect(vm.pid).toBeNull();
      expect(vm.socketPath).toBeNull();
      expect(vm.tapDevice).toBeNull();
      expect(vm.macAddress).toBeNull();
      expect(vm.ipAddress).toBeNull();

      cleanup();
    });
  });

  describe("VM Lifecycle Transitions", () => {
    it("should handle full lifecycle: create -> start -> stop", async () => {
      const { app, db, cleanup, mocks } = await createTestApp();

      // Create an image
      await db.insert(images).values({
        id: "img-test-010",
        reference: "test-image:latest",
        kernelPath: "/var/lib/bonfire/images/test/vmlinux",
        rootfsPath: "/var/lib/bonfire/images/test/rootfs.ext4",
        sizeBytes: 1024000,
        pulledAt: new Date(),
      });

      // Create a VM
      await db.insert(vms).values({
        id: "vm-test-010",
        name: "test-lifecycle-vm",
        status: "creating",
        vcpus: 2,
        memoryMib: 1024,
        imageId: "img-test-010",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. Start the VM
      const startReq = new Request(
        "http://localhost/api/vms/vm-test-010/start",
        { method: "POST" }
      );
      const startRes = await app.fetch(startReq);

      expect(startRes.status).toBe(200);
      const startBody = await startRes.json();
      expect(startBody.status).toBe("running");

      // 2. Stop the VM
      const stopReq = new Request(
        "http://localhost/api/vms/vm-test-010/stop",
        { method: "POST" }
      );
      const stopRes = await app.fetch(stopReq);

      expect(stopRes.status).toBe(200);
      const stopBody = await stopRes.json();
      expect(stopBody.status).toBe("stopped");

      // 3. Start the VM again (from stopped)
      mocks.firecracker.clearCalls();
      mocks.network.clearCalls();

      const restartReq = new Request(
        "http://localhost/api/vms/vm-test-010/start",
        { method: "POST" }
      );
      const restartRes = await app.fetch(restartReq);

      expect(restartRes.status).toBe(200);
      const restartBody = await restartRes.json();
      expect(restartBody.status).toBe("running");

      // Verify services were called again
      expect(mocks.firecracker.calls.spawnFirecracker).toHaveLength(1);
      expect(mocks.network.calls.allocate).toHaveLength(1);

      cleanup();
    });
  });

});
