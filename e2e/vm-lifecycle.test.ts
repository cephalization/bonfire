/**
 * E2E Tests: VM Lifecycle
 *
 * Tests the full VM lifecycle:
 * 1. Create VM
 * 2. Start VM, wait for running status
 * 3. Verify VM state and network allocation
 * 4. Stop VM, verify stopped
 * 5. Delete VM, verify deleted
 * 6. Cleanup in afterAll
 *
 * Requirements:
 * - Linux host with KVM
 * - Run inside e2e.Dockerfile container
 * - Uses quickstart Ubuntu image (no agent required)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BonfireClient } from "@bonfire/sdk";
import type { VM, Image } from "@bonfire/sdk";

// Test configuration
const API_URL = process.env.BONFIRE_API_URL || "http://localhost:3000";
const TEST_TIMEOUT = 120000; // 120 seconds per test

// Test credentials from docker-compose.test.yml
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL || "admin@example.com";
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD || "admin123";

// Test client (initialized after authentication)
let client: BonfireClient;

// Track created resources for cleanup
const createdVMs: string[] = [];
let testImage: Image | null = null;

/**
 * Authenticate and get session cookie
 */
async function authenticate(): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  const data = await response.json().catch(() => ({ error: "Unknown error" }));

  if (!response.ok) {
    const errorMessage = data?.error || response.statusText;
    throw new Error(`Authentication failed: ${errorMessage}`);
  }

  // Return the cookie header from the response
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("No session cookie received from authentication");
  }
  return cookie;
}

/**
 * Wait for VM to reach a specific status
 */
async function waitForVMStatus(
  vmId: string,
  status: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<VM> {
  const { timeout = 30000, interval = 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const vm = await client.getVM(vmId);
    if (vm.status === status) {
      return vm;
    }
    if (vm.status === "error") {
      throw new Error(`VM entered error state`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`VM did not reach status '${status}' within ${timeout}ms`);
}

describe("VM Lifecycle (E2E)", () => {
  beforeAll(async () => {
    // Authenticate first
    console.log("Authenticating...");
    const cookie = await authenticate();
    console.log("Authentication successful");

    // Create client with authentication cookie
    client = new BonfireClient({ baseUrl: API_URL, cookie });

    // Check API health
    const health = await client.getHealth();
    expect(health.status).toBe("ok");

    // Get quickstart image (download if not cached)
    const images = await client.listImages();
    const existingImage = images.find((img: Image) =>
      img.reference.includes("firecracker-quickstart")
    );

    if (existingImage) {
      testImage = existingImage;
      console.log(`Using existing quickstart image: ${testImage.id}`);
    } else {
      console.log("Downloading quickstart image...");
      // Use the quickstart endpoint to download the image
      const response = await fetch(`${API_URL}/api/images/quickstart`, {
        method: "POST",
        headers: {
          "Cookie": cookie,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to download quickstart image: ${response.status}`);
      }
      testImage = await response.json();
      console.log(`Downloaded quickstart image: ${testImage!.id}`);
    }

    expect(testImage).not.toBeNull();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Cleanup all VMs created during tests
    console.log(`Cleaning up ${createdVMs.length} VMs...`);

    for (const vmId of createdVMs) {
      try {
        const vm = await client.getVM(vmId).catch(() => null);
        if (vm) {
          if (vm.status === "running") {
            console.log(`Stopping VM ${vmId}...`);
            await client.stopVM(vmId);
          }
          console.log(`Deleting VM ${vmId}...`);
          await client.deleteVM(vmId);
        }
      } catch (error) {
        console.error(`Failed to cleanup VM ${vmId}:`, error);
      }
    }

    console.log("Cleanup complete");
  }, TEST_TIMEOUT);

  it(
    "should create a VM",
    async () => {
      const vmName = `e2e-test-vm-${Date.now()}`;

      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });

      createdVMs.push(vm.id);

      expect(vm).toBeDefined();
      expect(vm.id).toBeDefined();
      expect(vm.name).toBe(vmName);
      expect(vm.status).toBe("creating");
      expect(vm.vcpus).toBe(1);
      expect(vm.memoryMib).toBe(512);
      expect(vm.imageId).toBe(testImage!.id);
    },
    TEST_TIMEOUT
  );

  it(
    "should start a VM and reach running status",
    async () => {
      const vmName = `e2e-test-start-${Date.now()}`;

      // Create VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      expect(vm.status).toBe("creating");

      // Start VM
      const startedVM = await client.startVM(vm.id);
      expect(startedVM.status).toBe("running");
      expect(startedVM.pid).toBeGreaterThan(0);
      expect(startedVM.ipAddress).toBeDefined();
    },
    TEST_TIMEOUT
  );

  it(
    "should list VMs and find created VM",
    async () => {
      const vmName = `e2e-test-list-${Date.now()}`;

      // Create VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      // List VMs
      const vms = await client.listVMs();

      // Find our VM
      const foundVM = vms.find((v: VM) => v.id === vm.id);
      expect(foundVM).toBeDefined();
      expect(foundVM!.name).toBe(vmName);
    },
    TEST_TIMEOUT
  );

  it(
    "should get VM details by ID",
    async () => {
      const vmName = `e2e-test-get-${Date.now()}`;

      // Create VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      // Get VM by ID
      const retrievedVM = await client.getVM(vm.id);
      expect(retrievedVM.id).toBe(vm.id);
      expect(retrievedVM.name).toBe(vmName);
      expect(retrievedVM.vcpus).toBe(1);
      expect(retrievedVM.memoryMib).toBe(512);
    },
    TEST_TIMEOUT
  );

  it(
    "should stop a VM and reach stopped status",
    async () => {
      const vmName = `e2e-test-stop-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);

      // Verify VM is running
      let currentVM = await client.getVM(vm.id);
      expect(currentVM.status).toBe("running");

      // Stop VM
      const stoppedVM = await client.stopVM(vm.id);
      expect(stoppedVM.status).toBe("stopped");

      // Verify VM is stopped
      currentVM = await client.getVM(vm.id);
      expect(currentVM.status).toBe("stopped");
      expect(currentVM.pid).toBeNull();
    },
    TEST_TIMEOUT
  );

  it(
    "should delete a VM",
    async () => {
      const vmName = `e2e-test-delete-${Date.now()}`;

      // Create VM (don't start it to make deletion simpler)
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });

      // Verify VM exists
      const createdVM = await client.getVM(vm.id);
      expect(createdVM).toBeDefined();

      // Delete VM
      const result = await client.deleteVM(vm.id);
      expect(result.success).toBe(true);

      // Verify VM is deleted
      try {
        await client.getVM(vm.id);
        throw new Error("Expected VM to be deleted");
      } catch (error) {
        expect((error as Error).message).toContain("not found");
      }

      // Remove from cleanup list since we already deleted it
      const index = createdVMs.indexOf(vm.id);
      if (index > -1) {
        createdVMs.splice(index, 1);
      }
    },
    TEST_TIMEOUT
  );

  it(
    "should restart a stopped VM",
    async () => {
      const vmName = `e2e-test-restart-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      // First start
      await client.startVM(vm.id);
      let currentVM = await client.getVM(vm.id);
      expect(currentVM.status).toBe("running");

      // Stop
      await client.stopVM(vm.id);
      currentVM = await client.getVM(vm.id);
      expect(currentVM.status).toBe("stopped");

      // Restart
      const restartedVM = await client.startVM(vm.id);
      expect(restartedVM.status).toBe("running");
      expect(restartedVM.pid).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  it(
    "should perform full VM lifecycle: create, start, stop, delete",
    async () => {
      const vmName = `e2e-test-full-lifecycle-${Date.now()}`;

      // Step 1: Create VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });

      expect(vm.status).toBe("creating");

      // Step 2: Start VM
      const startedVM = await client.startVM(vm.id);
      expect(startedVM.status).toBe("running");
      expect(startedVM.pid).toBeGreaterThan(0);
      expect(startedVM.ipAddress).toBeDefined();
      expect(startedVM.tapDevice).toBeDefined();
      expect(startedVM.macAddress).toBeDefined();

      // Step 3: Stop VM
      const stoppedVM = await client.stopVM(vm.id);
      expect(stoppedVM.status).toBe("stopped");
      expect(stoppedVM.pid).toBeNull();

      // Step 4: Delete VM
      const deleteResult = await client.deleteVM(vm.id);
      expect(deleteResult.success).toBe(true);

      // Verify VM is deleted
      try {
        await client.getVM(vm.id);
        throw new Error("Expected VM to be deleted");
      } catch (error) {
        expect((error as Error).message).toContain("not found");
      }

      // Remove from cleanup list since we already deleted it
      const index = createdVMs.indexOf(vm.id);
      if (index > -1) {
        createdVMs.splice(index, 1);
      }
    },
    TEST_TIMEOUT
  );

  it(
    "should fail to start non-existent VM",
    async () => {
      const fakeVmId = "vm-nonexistent-12345";

      try {
        await client.startVM(fakeVmId);
        throw new Error("Expected error for non-existent VM");
      } catch (error) {
        expect((error as Error).message).toContain("not found");
      }
    },
    TEST_TIMEOUT
  );

  it(
    "should fail to delete running VM",
    async () => {
      const vmName = `e2e-test-delete-running-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);

      // Try to delete running VM - should fail
      try {
        await client.deleteVM(vm.id);
        throw new Error("Expected error for deleting running VM");
      } catch (error) {
        expect((error as Error).message).toContain("running");
      }
    },
    TEST_TIMEOUT
  );
});
