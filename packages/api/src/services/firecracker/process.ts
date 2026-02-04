/**
 * Firecracker Process Management
 *
 * Handles spawning, configuring, and lifecycle management of Firecracker processes.
 */

import { spawn, type ChildProcess } from "child_process";
import { mkdir, unlink, open as fsOpen, readFile } from "fs/promises";
import { dirname } from "path";
import {
  configureVM,
  startInstance,
  sendCtrlAltDel,
  waitForApiReady,
  isApiReady,
} from "./socket-client";
import type { VMConfiguration } from "./socket-client";

export interface FirecrackerProcess {
  pid: number;
  socketPath: string;
}

export interface SpawnOptions {
  vmId: string;
  socketDir?: string;
  binaryPath?: string;
}

export interface StopOptions {
  gracefulTimeoutMs?: number;
  sigtermTimeoutMs?: number;
}

const DEFAULTS = {
  socketDir: "/var/lib/bonfire/vms",
  binaryPath: "firecracker",
  gracefulTimeoutMs: 30000,
  sigtermTimeoutMs: 10000,
} as const;

function shouldDetachFirecracker(): boolean {
  const raw = process.env.BONFIRE_FIRECRACKER_DETACH;
  if (raw !== undefined) return raw !== "0" && raw.toLowerCase() !== "false";
  // In dev, hot-reload restarts the API process. Detaching keeps VMs alive.
  return process.env.NODE_ENV === "development";
}

async function isFirecrackerProcess(pid: number, socketPath?: string | null): Promise<boolean> {
  try {
    const cmdline = await readFile(`/proc/${pid}/cmdline`);
    const text = cmdline.toString("utf8").replace(/\0/g, " ");
    if (!/\bfirecracker\b/.test(text)) return false;
    if (socketPath && !text.includes(socketPath)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawns a Firecracker process with API socket
 */
export async function spawnFirecracker(options: SpawnOptions): Promise<FirecrackerProcess> {
  const socketDir = options.socketDir ?? DEFAULTS.socketDir;
  const binaryPath = options.binaryPath ?? DEFAULTS.binaryPath;
  const socketPath = `${socketDir}/${options.vmId}.sock`;
  const detach = shouldDetachFirecracker();

  console.log(`[Firecracker] Spawning process for VM ${options.vmId}`);
  console.log(`[Firecracker] Binary: ${binaryPath}`);
  console.log(`[Firecracker] Socket: ${socketPath}`);

  // Ensure socket directory exists
  await mkdir(socketDir, { recursive: true });

  // Clean up any existing socket file (from previous failed attempts)
  try {
    await unlink(socketPath);
    console.log(`[Firecracker] Removed existing socket file`);
  } catch {
    // Socket file doesn't exist, which is fine
  }

  // Avoid piping stderr to the parent process. Dev hot-reload restarts the API
  // process; if stderr is a pipe, the child may crash on SIGPIPE when the
  // reader disappears. Log to a per-VM file instead.
  const stderrLogPath = `${socketDir}/${options.vmId}.firecracker.stderr.log`;
  const stderrFd = await fsOpen(stderrLogPath, "a");

  // Spawn firecracker process
  const child = spawn(binaryPath, ["--api-sock", socketPath], {
    detached: detach,
    stdio: ["ignore", "ignore", stderrFd.fd],
  });

  if (detach) {
    child.unref();
  }

  const pid = child.pid;
  if (!pid) {
    throw new Error("Failed to spawn Firecracker process: no PID returned");
  }

  console.log(`[Firecracker] Process spawned with PID ${pid}`);

  // Close stderr fd in parent after spawning
  try {
    await stderrFd.close();
  } catch {
    // Ignore close errors
  }

  // Handle process exit
  child.on("exit", (code: number | null, signal: string | null) => {
    if (code !== 0 && code !== null) {
      console.error(`[Firecracker:${pid}] Process exited with code ${code}`);
    } else if (signal) {
      console.log(`[Firecracker:${pid}] Process exited with signal ${signal}`);
    }
  });

  // Handle process errors during startup
  let startupError: Error | null = null;

  child.on("error", (error: Error) => {
    console.error(`[Firecracker:${pid}] Process error:`, error);
    startupError = error;
  });

  // Wait a moment for the process to start and socket to be created
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (startupError) {
    throw new Error(`Failed to spawn Firecracker process: ${(startupError as Error).message}`);
  }

  if (child.killed || child.exitCode !== null) {
    throw new Error(`Firecracker process exited prematurely with code ${child.exitCode}`);
  }

  console.log(`[Firecracker:${pid}] Process started successfully`);

  return {
    pid,
    socketPath,
  };
}

/**
 * Configure a VM through the Firecracker API
 */
export async function configureVMProcess(
  socketPath: string,
  config: VMConfiguration
): Promise<void> {
  // Wait for API to be ready
  await waitForApiReady(socketPath);

  // Apply all configurations
  await configureVM(socketPath, config);
}

/**
 * Start a VM instance
 */
export async function startVMProcess(socketPath: string): Promise<void> {
  // Ensure API is ready
  if (!(await isApiReady(socketPath))) {
    throw new Error("Firecracker API is not ready");
  }

  await startInstance(socketPath);
}

/**
 * Stop a VM gracefully, falling back to SIGTERM if needed
 */
export async function stopVMProcess(
  socketPath: string,
  pid: number,
  options: StopOptions = {}
): Promise<void> {
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULTS.gracefulTimeoutMs;
  const sigtermTimeoutMs = options.sigtermTimeoutMs ?? DEFAULTS.sigtermTimeoutMs;

  // Try graceful shutdown via API first
  try {
    if (await isApiReady(socketPath)) {
      await sendCtrlAltDel(socketPath);

      // Wait for process to exit gracefully
      const startTime = Date.now();
      while (Date.now() - startTime < gracefulTimeoutMs) {
        if (!(await isProcessRunning(pid))) {
          return; // Process exited gracefully
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch {
    // API shutdown failed, continue to SIGTERM
  }

  // Send SIGTERM if still running
  if (await isProcessRunning(pid)) {
    try {
      process.kill(pid, "SIGTERM");

      // Wait for process to exit
      const startTime = Date.now();
      while (Date.now() - startTime < sigtermTimeoutMs) {
        if (!(await isProcessRunning(pid))) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch {
      // Process may have already exited
    }
  }

  // Check if process is still running
  if (await isProcessRunning(pid)) {
    throw new Error(
      `Failed to stop Firecracker process ${pid} after graceful shutdown and SIGTERM`
    );
  }
}

/**
 * Check if a process is still running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists
    return await isFirecrackerProcess(pid);
  } catch {
    return false;
  }
}
