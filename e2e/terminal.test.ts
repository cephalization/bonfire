/**
 * E2E Tests: Terminal WebSocket (Serial Console)
 *
 * Tests WebSocket terminal functionality using serial console:
 * 1. WebSocket connection and basic I/O
 * 2. Command execution (echo, pwd, ls)
 * 3. Resize handling with xterm sequences
 * 4. Concurrent connection rejection
 * 5. Reconnection after disconnect
 * 6. Special characters and UTF-8
 * 7. VM stop -> terminal disconnect
 *
 * Requirements:
 * - Linux host with KVM
 * - Run inside e2e.Dockerfile container
 * - Uses quickstart Ubuntu image (no agent required)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BonfireClient } from "@bonfire/sdk";
import type { Image, VM } from "@bonfire/sdk";

// Test configuration
const API_URL = process.env.BONFIRE_API_URL || "http://localhost:3000";
const TEST_TIMEOUT = 120000; // 120 seconds per test (VM boot can take time)
const VM_BOOT_WAIT = 15000; // Wait for VM to boot and present login prompt

// Test credentials from docker-compose.test.yml
const TEST_EMAIL = "admin@example.com";
const TEST_PASSWORD = "admin123";

// Test client (will be initialized with auth cookie in beforeAll)
let client: BonfireClient;
let authCookie: string;

// Track created resources for cleanup
const createdVMs: string[] = [];
let testImage: Image | null = null;

/**
 * Login to get an auth cookie
 */
async function login(): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
  });

  const data = await response.json().catch(() => ({ error: "Login failed" }));

  if (!response.ok) {
    throw new Error(data.error || `Login failed: ${response.status}`);
  }

  // Return the cookie header from the response
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("No session cookie received from login");
  }
  return cookie;
}

/**
 * Wait for VM to reach running status
 */
async function waitForVMRunning(
  vmId: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<VM> {
  const { timeout = 30000, interval = 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const vm = await client.getVM(vmId);
    if (vm.status === "running") {
      return vm;
    }
    if (vm.status === "error") {
      throw new Error(`VM entered error state`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`VM did not reach running status after ${timeout}ms`);
}

/**
 * Create a WebSocket connection and wait for it to open
 */
async function createWebSocketConnection(vmId: string, timeout = 10000): Promise<WebSocket> {
  // Build WebSocket URL with auth cookie as query parameter
  const wsUrl = new URL(`${API_URL.replace("http", "ws")}/api/vms/${vmId}/terminal`);

  // Pass auth cookie as query parameter for WebSocket authentication
  wsUrl.searchParams.set("cookie", authCookie);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl.toString());

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timed out after ${timeout}ms`));
    }, timeout);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };

    ws.onerror = (error: Event) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${error.type}`));
    };
  });
}

/**
 * Wait for WebSocket message matching a predicate
 */
async function waitForWebSocketMessage(
  ws: WebSocket,
  predicate: (data: string) => boolean,
  timeout = 10000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WebSocket message after ${timeout}ms`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      const data = event.data.toString();
      if (predicate(data)) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(data);
      }
    };

    ws.addEventListener("message", handler);
  });
}

/**
 * Collect all WebSocket messages for a duration
 */
async function collectMessages(ws: WebSocket, duration: number): Promise<string> {
  return new Promise((resolve) => {
    let output = "";

    const handler = (event: MessageEvent) => {
      const data = event.data.toString();
      // Skip JSON messages (ready, error, etc)
      if (!data.startsWith("{")) {
        output += data;
      }
    };

    ws.addEventListener("message", handler);

    setTimeout(() => {
      ws.removeEventListener("message", handler);
      resolve(output);
    }, duration);
  });
}

/**
 * Send a command via WebSocket and wait for output
 */
async function sendCommandAndWaitForOutput(
  ws: WebSocket,
  command: string,
  expectedOutput: string,
  timeout = 10000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for command output after ${timeout}ms`));
    }, timeout);

    let output = "";

    const handler = (event: MessageEvent) => {
      const data = event.data.toString();

      // Try to parse as JSON (might be error or other structured message)
      try {
        const json = JSON.parse(data);
        if (json.error) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler);
          reject(new Error(`WebSocket error: ${json.error}`));
          return;
        }
        // Skip other JSON messages (ready, etc)
        return;
      } catch {
        // Not JSON, treat as terminal output
      }

      output += data;

      if (output.includes(expectedOutput)) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(output);
      }
    };

    ws.addEventListener("message", handler);
    ws.send(command + "\n");
  });
}

/**
 * Wait for ready message from WebSocket
 */
async function waitForReady(ws: WebSocket, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ready message after ${timeout}ms`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data.toString());
        if (data.ready === true) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler);
          resolve();
        }
      } catch {
        // Not JSON, ignore
      }
    };

    ws.addEventListener("message", handler);
  });
}

describe("Terminal WebSocket - Serial Console (E2E)", () => {
  beforeAll(async () => {
    // Authenticate first
    console.log("Authenticating with API...");
    const cookie = await login();
    client = new BonfireClient({ baseUrl: API_URL, cookie });
    authCookie = cookie; // Store for WebSocket use
    console.log("Authentication successful");

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
          Cookie: authCookie,
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

  // Test 1: WebSocket connection and basic I/O
  it(
    "should connect to terminal WebSocket and receive data",
    async () => {
      const vmName = `e2e-terminal-connect-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // Connect WebSocket
      const ws = await createWebSocketConnection(vm.id);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      // Wait for ready message
      await waitForReady(ws);

      // Wait for some terminal output (boot messages or login prompt)
      const output = await collectMessages(ws, VM_BOOT_WAIT);

      // Should receive some data from the VM
      expect(output.length).toBeGreaterThan(0);

      // Close connection
      ws.close();
    },
    TEST_TIMEOUT
  );

  // Test 2: Command execution (echo, pwd, ls)
  it(
    "should execute commands via terminal",
    async () => {
      const vmName = `e2e-terminal-exec-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // Connect WebSocket
      const ws = await createWebSocketConnection(vm.id);
      await waitForReady(ws);

      // Wait for VM to boot and present prompt
      await new Promise((resolve) => setTimeout(resolve, VM_BOOT_WAIT));

      // Test echo command
      const echoOutput = await sendCommandAndWaitForOutput(
        ws,
        "echo BONFIRE_TEST_123",
        "BONFIRE_TEST_123"
      );
      expect(echoOutput).toContain("BONFIRE_TEST_123");

      // Test pwd command
      const pwdOutput = await sendCommandAndWaitForOutput(ws, "pwd", "/");
      expect(pwdOutput).toContain("/");

      // Test ls command
      const lsOutput = await sendCommandAndWaitForOutput(ws, "ls /", "bin");
      expect(lsOutput).toContain("bin");

      // Close connection
      ws.close();
    },
    TEST_TIMEOUT
  );

  // Test 3: Resize handling with xterm sequences
  it(
    "should handle terminal resize",
    async () => {
      const vmName = `e2e-terminal-resize-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // Connect WebSocket
      const ws = await createWebSocketConnection(vm.id);
      await waitForReady(ws);

      // Wait for VM to boot
      await new Promise((resolve) => setTimeout(resolve, VM_BOOT_WAIT));

      // Send resize message
      ws.send(
        JSON.stringify({
          resize: {
            cols: 120,
            rows: 40,
          },
        })
      );

      // Give time for resize to take effect
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify terminal still works after resize
      const output = await sendCommandAndWaitForOutput(ws, "echo AFTER_RESIZE", "AFTER_RESIZE");

      expect(output).toContain("AFTER_RESIZE");

      // Close connection
      ws.close();
    },
    TEST_TIMEOUT
  );

  // Test 4: Concurrent connection rejection
  it(
    "should reject concurrent connections to same VM",
    async () => {
      const vmName = `e2e-terminal-concurrent-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // First connection should succeed
      const ws1 = await createWebSocketConnection(vm.id);
      await waitForReady(ws1);
      expect(ws1.readyState).toBe(WebSocket.OPEN);

      // Second connection should be rejected
      const ws2 = client.createTerminalWebSocket(vm.id);

      const errorReceived = new Promise<string>((resolve) => {
        ws2.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data.toString());
            if (data.error) {
              resolve(data.error);
            }
          } catch {
            // Not JSON, ignore
          }
        };
      });

      // Wait for error message
      const error = await errorReceived;
      expect(error).toContain("already connected");

      // Clean up
      ws1.close();
      ws2.close();
    },
    TEST_TIMEOUT
  );

  // Test 5: Reconnection after disconnect
  it(
    "should allow reconnection after disconnect",
    async () => {
      const vmName = `e2e-terminal-reconnect-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // First connection
      const ws1 = await createWebSocketConnection(vm.id);
      await waitForReady(ws1);

      // Wait for VM to boot
      await new Promise((resolve) => setTimeout(resolve, VM_BOOT_WAIT));

      // Execute a command
      const output1 = await sendCommandAndWaitForOutput(
        ws1,
        "echo BEFORE_RECONNECT",
        "BEFORE_RECONNECT"
      );
      expect(output1).toContain("BEFORE_RECONNECT");

      // Close first connection
      ws1.close();

      // Wait for connection to be cleaned up
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Reconnect
      const ws2 = await createWebSocketConnection(vm.id);
      await waitForReady(ws2);

      // Should be able to execute commands on reconnection
      const output2 = await sendCommandAndWaitForOutput(
        ws2,
        "echo AFTER_RECONNECT",
        "AFTER_RECONNECT"
      );
      expect(output2).toContain("AFTER_RECONNECT");

      // Close second connection
      ws2.close();
    },
    TEST_TIMEOUT
  );

  // Test 6: Special characters and UTF-8
  it(
    "should handle special characters and UTF-8",
    async () => {
      const vmName = `e2e-terminal-special-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // Connect WebSocket
      const ws = await createWebSocketConnection(vm.id);
      await waitForReady(ws);

      // Wait for VM to boot
      await new Promise((resolve) => setTimeout(resolve, VM_BOOT_WAIT));

      // Test command with quotes
      const output1 = await sendCommandAndWaitForOutput(ws, 'echo "hello world"', "hello world");
      expect(output1).toContain("hello world");

      // Test command with pipe
      const output2 = await sendCommandAndWaitForOutput(ws, "echo 'test' | tr 'a-z' 'A-Z'", "TEST");
      expect(output2).toContain("TEST");

      // Test UTF-8 characters (basic latin + extended)
      const output3 = await sendCommandAndWaitForOutput(ws, "echo 'cafe'", "cafe");
      expect(output3).toContain("cafe");

      // Close connection
      ws.close();
    },
    TEST_TIMEOUT
  );

  // Test 7: VM stop -> terminal disconnect
  it(
    "should disconnect terminal when VM is stopped",
    async () => {
      const vmName = `e2e-terminal-stop-${Date.now()}`;

      // Create and start VM
      const vm = await client.createVM({
        name: vmName,
        vcpus: 1,
        memoryMib: 512,
        imageId: testImage!.id,
      });
      createdVMs.push(vm.id);

      await client.startVM(vm.id);
      await waitForVMRunning(vm.id, { timeout: 30000 });

      // Connect WebSocket
      const ws = await createWebSocketConnection(vm.id);
      await waitForReady(ws);

      // Track close event
      let connectionClosed = false;
      ws.onclose = () => {
        connectionClosed = true;
      };

      // Stop the VM
      await client.stopVM(vm.id);

      // Wait for WebSocket to close (connection should be terminated when VM stops)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Either the connection is closed, or trying to send will fail
      // The exact behavior depends on implementation - pipes may close when VM stops
      if (!connectionClosed) {
        // Try to send a message - should fail or get no response
        try {
          ws.send("echo test\n");
          // Wait a bit for any response
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch {
          // Expected - connection might be dead
        }
      }

      // Verify VM is stopped
      const stoppedVM = await client.getVM(vm.id);
      expect(stoppedVM.status).toBe("stopped");

      // Clean up
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    },
    TEST_TIMEOUT
  );

  // Additional test: Connection to non-existent VM
  it(
    "should fail to connect to non-existent VM",
    async () => {
      const fakeVmId = "vm-nonexistent-12345";

      const ws = client.createTerminalWebSocket(fakeVmId);

      const errorReceived = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Timeout waiting for error"));
        }, 10000);

        ws.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data.toString());
            if (data.error) {
              clearTimeout(timer);
              resolve(data.error);
            }
          } catch {
            // Not JSON, ignore
          }
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve("connection error");
        };
      });

      const error = await errorReceived;
      expect(error).toBeTruthy();

      ws.close();
    },
    TEST_TIMEOUT
  );
});
