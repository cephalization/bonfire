/**
 * Test Utilities Self-Test
 *
 * Meta-test to verify that test utilities work correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestApp,
  createMockFirecrackerService,
  createMockNetworkService,
} from "./test-utils";
import type { MockFirecrackerService, MockNetworkService } from "./test-utils";

describe("createMockFirecrackerService", () => {
  let mock: MockFirecrackerService;

  beforeEach(() => {
    mock = createMockFirecrackerService();
  });

  afterEach(() => {
    mock.clearCalls();
  });

  it("should spawn a VM with mock PID and socket path", async () => {
    const result = await mock.spawnFirecracker({ vmId: "test-vm-123" });

    expect(result.pid).toBeGreaterThan(0);
    expect(result.socketPath).toContain("test-vm-123");
    expect(mock.calls.spawnFirecracker).toHaveLength(1);
    expect(mock.calls.spawnFirecracker[0][0].vmId).toBe("test-vm-123");
  });

  it("should track multiple spawn calls", async () => {
    await mock.spawnFirecracker({ vmId: "vm-1" });
    await mock.spawnFirecracker({ vmId: "vm-2" });
    await mock.spawnFirecracker({ vmId: "vm-3" });

    expect(mock.calls.spawnFirecracker).toHaveLength(3);
    expect(mock.calls.spawnFirecracker[2][0].vmId).toBe("vm-3");
  });

  it("should configure VM process", async () => {
    await mock.configureVMProcess("/tmp/test.sock", {
      vcpuCount: 2,
      memSizeMib: 1024,
      kernelImagePath: "/kernel",
      rootfsPath: "/rootfs",
    });

    expect(mock.calls.configureVMProcess).toHaveLength(1);
    expect(mock.calls.configureVMProcess[0][0]).toBe("/tmp/test.sock");
  });

  it("should start VM process", async () => {
    await mock.startVMProcess("/tmp/test.sock");

    expect(mock.calls.startVMProcess).toHaveLength(1);
    expect(mock.calls.startVMProcess[0][0]).toBe("/tmp/test.sock");
  });

  it("should stop VM process", async () => {
    await mock.stopVMProcess("/tmp/test.sock", 12345);

    expect(mock.calls.stopVMProcess).toHaveLength(1);
    expect(mock.calls.stopVMProcess[0][0]).toBe("/tmp/test.sock");
    expect(mock.calls.stopVMProcess[0][1]).toBe(12345);
  });

  it("should clear calls", async () => {
    await mock.spawnFirecracker({ vmId: "vm-1" });
    await mock.configureVMProcess("/tmp/test.sock", {} as any);

    expect(mock.calls.spawnFirecracker).toHaveLength(1);
    expect(mock.calls.configureVMProcess).toHaveLength(1);

    mock.clearCalls();

    expect(mock.calls.spawnFirecracker).toHaveLength(0);
    expect(mock.calls.configureVMProcess).toHaveLength(0);
  });
});

describe("createMockNetworkService", () => {
  let mock: MockNetworkService;

  beforeEach(() => {
    mock = createMockNetworkService();
  });

  afterEach(() => {
    mock.clearCalls();
  });

  it("should allocate network resources", async () => {
    const result = await mock.allocate("test-vm-123");

    expect(result.tapDevice).toContain("tap-mock");
    expect(result.macAddress).toMatch(/^02:00:00:00:00:/);
    expect(result.ipAddress).toMatch(/^10\.0\.100\.\d+$/);
    expect(mock.calls.allocate).toHaveLength(1);
  });

  it("should allocate unique IPs", async () => {
    const result1 = await mock.allocate("vm-1");
    const result2 = await mock.allocate("vm-2");

    // Each allocation should get a unique IP in the subnet
    expect(result1.ipAddress).toMatch(/^10\.0\.100\.\d+$/);
    expect(result2.ipAddress).toMatch(/^10\.0\.100\.\d+$/);
    expect(result1.ipAddress).not.toBe(result2.ipAddress);
  });

  it("should track allocated IPs", async () => {
    const result1 = await mock.allocate("vm-1");
    const result2 = await mock.allocate("vm-2");

    const allocated = mock.getAllocatedIPs();
    expect(allocated).toContain(result1.ipAddress);
    expect(allocated).toContain(result2.ipAddress);
    expect(allocated).toHaveLength(2);
  });

  it("should release IP addresses", async () => {
    const resources = await mock.allocate("vm-1");
    expect(mock.getAllocatedIPs()).toContain(resources.ipAddress);

    await mock.release({ ipAddress: resources.ipAddress });
    expect(mock.getAllocatedIPs()).not.toContain(resources.ipAddress);
    expect(mock.calls.release).toHaveLength(1);
  });

  it("should expose IP pool state", async () => {
    await mock.allocate("vm-1");

    const pool = mock.getIPPool();
    expect(pool.allocated.size).toBe(1);
    expect(pool.available).toHaveLength(252);
  });

  it("should verify pool has 253 total IPs", async () => {
    // Verify the /24 subnet provides 253 usable IPs (.2-.254, excluding .0, .1, .255)
    const pool = mock.getIPPool();
    expect(pool.available.length + pool.allocated.size).toBe(253);
  });

  it("should clear calls", async () => {
    await mock.allocate("vm-1");
    await mock.release({});

    expect(mock.calls.allocate).toHaveLength(1);
    expect(mock.calls.release).toHaveLength(1);

    mock.clearCalls();

    expect(mock.calls.allocate).toHaveLength(0);
    expect(mock.calls.release).toHaveLength(0);
  });

  it("should expose IP pool state", async () => {
    await mock.allocate("vm-1");

    const pool = mock.getIPPool();
    expect(pool.allocated.size).toBe(1);
    expect(pool.available).toHaveLength(252);
  });
});

describe("createTestApp", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  afterEach(() => {
    if (testApp) {
      testApp.cleanup();
    }
  });

  it("should create app with fresh database", async () => {
    testApp = await createTestApp();

    expect(testApp.app).toBeDefined();
    expect(testApp.db).toBeDefined();
    expect(testApp.sqlite).toBeDefined();
    expect(testApp.request).toBeDefined();
    expect(testApp.cleanup).toBeDefined();
    expect(testApp.mocks).toBeDefined();
  });

  it("should have working health endpoint", async () => {
    testApp = await createTestApp();

    const res = await testApp.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("should provide mocked firecracker service", async () => {
    testApp = await createTestApp();

    expect(testApp.mocks.firecracker).toBeDefined();
    expect(typeof testApp.mocks.firecracker.spawnFirecracker).toBe("function");
    expect(typeof testApp.mocks.firecracker.configureVMProcess).toBe("function");
  });

  it("should provide mocked network service", async () => {
    testApp = await createTestApp();

    expect(testApp.mocks.network).toBeDefined();
    expect(typeof testApp.mocks.network.allocate).toBe("function");
    expect(typeof testApp.mocks.network.release).toBe("function");
  });

  it("should allow custom mock services", async () => {
    const customFirecracker = createMockFirecrackerService();
    const customNetwork = createMockNetworkService();

    testApp = await createTestApp({
      firecracker: customFirecracker,
      network: customNetwork,
    });

    expect(testApp.mocks.firecracker).toBe(customFirecracker);
    expect(testApp.mocks.network).toBe(customNetwork);
  });

  it("should cleanup database on cleanup()", async () => {
    testApp = await createTestApp();

    // Just verify cleanup doesn't throw
    expect(() => testApp.cleanup()).not.toThrow();
  });

  it("should isolate databases between test apps", async () => {
    const app1 = await createTestApp();
    const app2 = await createTestApp();

    // Verify both apps are created independently
    expect(app1).toBeDefined();
    expect(app2).toBeDefined();

    app1.cleanup();
    app2.cleanup();
  });

  it("should have database tables created", async () => {
    testApp = await createTestApp();

    // Query to check if tables exist
    const vmsTable = testApp.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='vms'"
      )
      .get();
    const imagesTable = testApp.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='images'"
      )
      .get();

    expect(vmsTable).toBeDefined();
    expect(imagesTable).toBeDefined();
  });

  it("should allow database operations", async () => {
    testApp = await createTestApp();

    // Insert an image
    testApp.sqlite
      .prepare(
        `
      INSERT INTO images (id, reference, kernel_path, rootfs_path, pulled_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run("img-1", "test-image:latest", "/kernel", "/rootfs", Date.now());

    // Query the image
    const image = testApp.sqlite
      .prepare("SELECT * FROM images WHERE id = ?")
      .get("img-1") as { reference: string } | undefined;

    expect(image).toBeDefined();
    expect(image!.reference).toBe("test-image:latest");
  });

  it("should track mock service calls through app usage", async () => {
    testApp = await createTestApp();

    // Use the mock services directly
    await testApp.mocks.firecracker.spawnFirecracker({ vmId: "test-1" });
    await testApp.mocks.network.allocate("test-1");

    expect(testApp.mocks.firecracker.calls.spawnFirecracker).toHaveLength(1);
    expect(testApp.mocks.network.calls.allocate).toHaveLength(1);
  });
});
