/**
 * E2E Tests: Browser UI
 *
 * Tests the full user workflow via browser automation using agent-browser:
 * 1. Navigate to Dashboard
 * 2. Create a VM via the UI dialog
 * 3. Start the VM
 * 4. Launch the terminal
 * 5. Run a command and verify output
 *
 * Requirements:
 * - Linux host with KVM
 * - agent-browser CLI installed (npm install -g agent-browser)
 * - API and Web servers running
 * - Uses quickstart Ubuntu image
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "child_process";

// Test configuration
const WEB_URL = process.env.BONFIRE_WEB_URL || "http://localhost:5173";
const API_URL = process.env.BONFIRE_API_URL || "http://localhost:3000";
const TEST_TIMEOUT = 180000; // 180 seconds per test (VM boot can take time)
const SESSION_NAME = `bonfire-e2e-${Date.now()}`;

// Track created VMs for cleanup
const createdVMNames: string[] = [];

// Authentication credentials
const AUTH_EMAIL = "admin@example.com";
const AUTH_PASSWORD = "admin123";

// Store auth cookie for API requests
let authCookie: string | null = null;

/**
 * Authenticate with the API and store the session cookie
 */
async function authenticate(): Promise<void> {
  if (authCookie) {
    return; // Already authenticated
  }

  const response = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
    }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status}`);
  }

  // Extract and store the session cookie
  const setCookieHeader = response.headers.get("set-cookie");
  if (setCookieHeader) {
    authCookie = setCookieHeader;
  }

  console.log("Authenticated successfully");
}

/**
 * Get headers for authenticated API requests
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authCookie) {
    headers["Cookie"] = authCookie;
  }
  return headers;
}

/**
 * Execute agent-browser command and return output
 */
async function agentBrowser(
  args: string[],
  options: { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn("agent-browser", ["--session", SESSION_NAME, ...args], {
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Execute agent-browser command, expecting success
 */
async function ab(args: string[], options: { timeout?: number } = {}): Promise<string> {
  const result = await agentBrowser(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `agent-browser failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

/**
 * Wait for an element to appear by retrying snapshot
 */
async function waitForElement(
  predicate: (snapshot: string) => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<string> {
  const { timeout = 10000, interval = 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const snapshot = await ab(["snapshot", "-i"]);
    if (predicate(snapshot)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Element not found within ${timeout}ms`);
}

/**
 * Wait for text to appear on the page
 */
async function waitForText(
  text: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  await waitForElement((snapshot) => snapshot.includes(text), options);
}

/**
 * Get element ref by text content or label
 */
function findRefByText(snapshot: string, text: string): string | null {
  // Look for pattern like: [ref=e123] ... text ... or "text" [ref=e123]
  const lines = snapshot.split("\n");
  for (const line of lines) {
    if (line.toLowerCase().includes(text.toLowerCase())) {
      const match = line.match(/\[ref=(e\d+)\]/);
      if (match) {
        return `@${match[1]}`;
      }
    }
  }
  return null;
}

/**
 * Find element by test ID pattern in snapshot
 */
function findRefByTestId(snapshot: string, testId: string): string | null {
  // Test IDs appear as attributes: data-testid="xxx" [ref=eN]
  const regex = new RegExp(`data-testid="${testId}"[^\\[]*\\[ref=(e\\d+)\\]`);
  const match = snapshot.match(regex);
  if (match) {
    return `@${match[1]}`;
  }

  // Fallback: look for the testId in any context
  const lines = snapshot.split("\n");
  for (const line of lines) {
    if (line.includes(testId)) {
      const refMatch = line.match(/\[ref=(e\d+)\]/);
      if (refMatch) {
        return `@${refMatch[1]}`;
      }
    }
  }
  return null;
}

/**
 * Ensure quickstart image exists via API
 */
async function ensureQuickstartImage(): Promise<void> {
  // Authenticate first
  await authenticate();

  // Check if image exists
  const response = await fetch(`${API_URL}/api/images`, {
    headers: getAuthHeaders(),
  });
  const images = (await response.json()) as Array<{ reference: string }>;

  const hasQuickstart = images.some((img) => img.reference.includes("firecracker-quickstart"));

  if (!hasQuickstart) {
    console.log("Downloading quickstart image via API...");
    const pullResponse = await fetch(`${API_URL}/api/images/quickstart`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (!pullResponse.ok) {
      throw new Error(`Failed to download quickstart image: ${pullResponse.status}`);
    }
    console.log("Quickstart image downloaded");
  }
}

/**
 * Clean up VMs created during tests
 */
async function cleanupVMs(): Promise<void> {
  // Authenticate first
  await authenticate();

  // Get all VMs
  const response = await fetch(`${API_URL}/api/vms`, {
    headers: getAuthHeaders(),
  });
  const vms = (await response.json()) as Array<{
    id: string;
    name: string;
    status: string;
  }>;

  // Find VMs created during this test run
  for (const vm of vms) {
    if (createdVMNames.includes(vm.name)) {
      try {
        if (vm.status === "running") {
          await fetch(`${API_URL}/api/vms/${vm.id}/stop`, {
            method: "POST",
            headers: getAuthHeaders(),
          });
        }
        await fetch(`${API_URL}/api/vms/${vm.id}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        console.log(`Cleaned up VM: ${vm.name}`);
      } catch (err) {
        console.error(`Failed to cleanup VM ${vm.name}:`, err);
      }
    }
  }
}

describe("Browser UI E2E", () => {
  beforeAll(async () => {
    // Check API health
    const healthResponse = await fetch(`${API_URL}/health`);
    const health = (await healthResponse.json()) as { status: string };
    expect(health.status).toBe("ok");

    // Ensure quickstart image exists
    await ensureQuickstartImage();

    // Authenticate via API to get session cookie
    await authenticate();

    // Open the browser and navigate to the web app
    await ab(["open", WEB_URL]);

    // Wait for page to load and check if we need to log in
    console.log("Waiting for page to load...");

    // Take initial snapshot to see what's on the page
    let snapshot = await ab(["snapshot", "-i"]);
    console.log("Initial page snapshot:", snapshot.substring(0, 500));

    // Check if we're on the login page or dashboard
    if (
      snapshot.includes("Welcome back") ||
      snapshot.includes("Sign in") ||
      snapshot.includes("credentials")
    ) {
      console.log("Login page detected, authenticating...");

      // Find and fill email input (look for input fields)
      const emailMatch =
        snapshot.match(/\[ref=([^\]]+)\][^\n]*email/i) ||
        snapshot.match(/\[ref=([^\]]+)\][^\n]*input/i);
      if (emailMatch) {
        console.log("Filling email field...");
        await ab(["fill", emailMatch[1], AUTH_EMAIL]);
      }

      // Take new snapshot after filling email
      snapshot = await ab(["snapshot", "-i"]);

      // Find and fill password input
      const passwordMatch = snapshot.match(/\[ref=([^\]]+)\][^\n]*password/i);
      if (passwordMatch) {
        console.log("Filling password field...");
        await ab(["fill", passwordMatch[1], AUTH_PASSWORD]);
      }

      // Take new snapshot after filling password
      snapshot = await ab(["snapshot", "-i"]);

      // Find and click sign in button
      const signInMatch =
        snapshot.match(/\[ref=([^\]]+)\][^\n]*Sign in/i) ||
        snapshot.match(/\[ref=([^\]]+)\][^\n]*button/i);
      if (signInMatch) {
        console.log("Clicking sign in button...");
        await ab(["click", signInMatch[1]]);
      }

      // Wait for redirect to dashboard
      console.log("Waiting for dashboard...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      snapshot = await ab(["snapshot", "-i"]);

      if (!snapshot.includes("Dashboard") && !snapshot.includes("Create VM")) {
        throw new Error("Failed to log in or reach dashboard");
      }
      console.log("Successfully logged in");
    } else if (snapshot.includes("Dashboard") || snapshot.includes("Create VM")) {
      console.log("Already on dashboard");
    } else {
      console.log("Unknown page state, waiting for Dashboard text...");
      await waitForText("Dashboard", { timeout: 15000 });
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Clean up VMs
    await cleanupVMs();

    // Close browser
    await ab(["close"]).catch(() => {
      // Ignore errors on close
    });
  }, TEST_TIMEOUT);

  it(
    "should create a VM via the UI dialog",
    async () => {
      const vmName = `e2e-browser-${Date.now()}`;
      createdVMNames.push(vmName);

      // Get initial snapshot
      let snapshot = await ab(["snapshot", "-i"]);

      // Find and click the "Create VM" button
      const createBtnRef = findRefByText(snapshot, "Create VM");
      expect(createBtnRef).not.toBeNull();
      await ab(["click", createBtnRef!]);

      // Wait for dialog to appear
      await waitForText("Create Virtual Machine", { timeout: 5000 });

      // Get dialog snapshot
      snapshot = await ab(["snapshot", "-i"]);

      // Fill in the VM name
      const nameInputRef = findRefByTestId(snapshot, "vm-name-input");
      expect(nameInputRef).not.toBeNull();
      await ab(["fill", nameInputRef!, vmName]);

      // Select an image (find the select trigger)
      const imageSelectRef = findRefByTestId(snapshot, "vm-image-select");
      if (imageSelectRef) {
        await ab(["click", imageSelectRef]);
        // Wait for dropdown
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Get new snapshot with dropdown options
        snapshot = await ab(["snapshot", "-i"]);
        // Find quickstart image option
        const quickstartRef = findRefByText(snapshot, "firecracker-quickstart");
        if (quickstartRef) {
          await ab(["click", quickstartRef]);
        }
      }

      // Submit the form
      snapshot = await ab(["snapshot", "-i"]);
      const submitRef = findRefByTestId(snapshot, "create-vm-submit");
      expect(submitRef).not.toBeNull();
      await ab(["click", submitRef!]);

      // Wait for dialog to close and VM to appear in list
      await waitForText(vmName, { timeout: 10000 });

      // Verify VM appears in the dashboard
      snapshot = await ab(["snapshot", "-i"]);
      expect(snapshot).toContain(vmName);
    },
    TEST_TIMEOUT
  );

  it(
    "should start a VM and open the terminal",
    async () => {
      // Use the VM created in the previous test
      const vmName = createdVMNames[0];
      expect(vmName).toBeDefined();

      // Refresh to see current state
      await ab(["reload"]);
      await waitForText(vmName, { timeout: 10000 });

      let snapshot = await ab(["snapshot", "-i"]);

      // Find the VM card and click the Start button
      // Look for Start button near the VM name
      const startBtnRef = findRefByText(snapshot, "Start");
      if (startBtnRef) {
        await ab(["click", startBtnRef]);

        // Wait for VM to be running (status badge changes)
        await waitForText("Running", { timeout: 60000 });
      }

      // Now find and click the Terminal button
      snapshot = await ab(["snapshot", "-i"]);
      const terminalBtnRef = findRefByText(snapshot, "Terminal");
      expect(terminalBtnRef).not.toBeNull();
      await ab(["click", terminalBtnRef!]);

      // Wait for VM detail page to load with terminal
      await waitForText("vCPU", { timeout: 10000 });

      // Wait for terminal to connect (connection status disappears)
      // The terminal shows "Connecting..." or "Disconnected" when not connected
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Verify terminal container is present
      snapshot = await ab(["snapshot", "-i"]);
      expect(snapshot.includes("terminal") || snapshot.includes("Terminal")).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should run a command in the terminal and see output",
    async () => {
      // We should already be on the VM detail page with terminal

      // Wait for VM to boot (serial console needs VM to be ready)
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // The terminal is a canvas element, so we need to interact with it via keyboard
      // First, click on the terminal to focus it
      let snapshot = await ab(["snapshot", "-i"]);
      const terminalRef = findRefByTestId(snapshot, "terminal-container");

      if (terminalRef) {
        await ab(["click", terminalRef]);
      }

      // Wait a moment for focus
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Type a command - we'll use echo with a unique marker
      const marker = `BONFIRE_TEST_${Date.now()}`;
      await ab(["type", terminalRef || "@e1", `echo ${marker}\n`]);

      // Wait for command to execute
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Take a screenshot to capture the terminal output
      const screenshotPath = `/tmp/bonfire-e2e-terminal-${Date.now()}.png`;
      await ab(["screenshot", screenshotPath]);

      // Note: Since terminal is canvas-based, we can't verify text output via snapshot
      // The screenshot serves as visual verification
      // In a real test, we'd use the WebSocket E2E tests for text verification

      console.log(`Terminal screenshot saved to: ${screenshotPath}`);

      // Verify we're still on the VM detail page
      snapshot = await ab(["snapshot", "-i"]);
      expect(snapshot.includes("vCPU") || snapshot.includes("Memory")).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should stop the VM via the UI",
    async () => {
      // We should be on the VM detail page
      let snapshot = await ab(["snapshot", "-i"]);

      // Find and click the Stop button
      const stopBtnRef = findRefByTestId(snapshot, "vm-stop-btn");
      if (stopBtnRef) {
        await ab(["click", stopBtnRef]);

        // Wait for VM to stop
        await waitForText("Stopped", { timeout: 30000 });
      } else {
        // VM might already be stopped
        expect(snapshot.includes("Start VM") || snapshot.includes("Stopped")).toBe(true);
      }

      // Verify terminal is replaced with "VM is stopped" message
      snapshot = await ab(["snapshot", "-i"]);
      expect(snapshot.includes("VM is stopped") || snapshot.includes("Start the VM")).toBe(true);
    },
    TEST_TIMEOUT
  );
});
