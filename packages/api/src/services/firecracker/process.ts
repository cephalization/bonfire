/**
 * Firecracker Process Management
 *
 * Handles spawning, configuring, and lifecycle management of Firecracker processes.
 */

import { spawn, type ChildProcess } from "child_process";
import { mkdir, unlink, open as fsOpen } from "fs/promises";
import { dirname } from "path";
import {
  configureVM,
  startInstance,
  sendCtrlAltDel,
  waitForApiReady,
  isApiReady,
} from "./socket-client";
import type { VMConfiguration } from "./socket-client";
import { createPipes, cleanupPipes, generatePipePaths, type SerialConsolePaths } from "./serial";

export interface FirecrackerProcess {
  pid: number;
  socketPath: string;
  stdinPipePath: string;
  stdoutPipePath: string;
}

export interface SpawnOptions {
  vmId: string;
  socketDir?: string;
  binaryPath?: string;
}

export interface StopOptions {
  gracefulTimeoutMs?: number;
  sigtermTimeoutMs?: number;
  vmId?: string;
  pipeDir?: string;
}

const DEFAULTS = {
  socketDir: "/var/lib/bonfire/vms",
  binaryPath: "firecracker",
  gracefulTimeoutMs: 30000,
  sigtermTimeoutMs: 10000,
} as const;

/**
 * Spawns a Firecracker process with API socket and serial console pipes
 */
export async function spawnFirecracker(options: SpawnOptions): Promise<FirecrackerProcess> {
  const socketDir = options.socketDir ?? DEFAULTS.socketDir;
  const binaryPath = options.binaryPath ?? DEFAULTS.binaryPath;
  const socketPath = `${socketDir}/${options.vmId}.sock`;

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

  // Create serial console FIFO pipes before spawning process
  console.log(`[Firecracker] Creating serial console pipes for VM ${options.vmId}`);
  const pipePaths = await createPipes({ vmId: options.vmId, pipeDir: socketDir });
  console.log(`[Firecracker] Pipes created: stdin=${pipePaths.stdin}, stdout=${pipePaths.stdout}`);

  // Open file descriptors for pipes to pass to child process
  // We need to open them before spawning so we can pass the fds
  let stdinFd: Awaited<ReturnType<typeof fsOpen>> | null = null;
  let stdoutFd: Awaited<ReturnType<typeof fsOpen>> | null = null;
  let child: ChildProcess | null = null;

  try {
    // Open pipes for the child process
    // stdin pipe: we open for reading (child writes to its stdout, which goes to our stdin pipe)
    // stdout pipe: we open for writing (child reads from its stdin, which comes from our stdout pipe)
    // Note: Firecracker's stdin connects to our stdout pipe (for sending input TO the VM)
    //       Firecracker's stdout connects to our stdin pipe (for receiving output FROM the VM)
    stdinFd = await fsOpen(pipePaths.stdin, "r+");
    stdoutFd = await fsOpen(pipePaths.stdout, "r+");

    // Spawn firecracker process with pipes for stdio
    // stdin (fd 0) <- from stdout pipe (input TO VM)
    // stdout (fd 1) -> to stdin pipe (output FROM VM)
    // stderr (fd 2) -> pipe for debugging
    child = spawn(binaryPath, ["--api-sock", socketPath], {
      detached: false,
      stdio: [stdoutFd.fd, stdinFd.fd, "pipe"],
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error("Failed to spawn Firecracker process: no PID returned");
    }

    console.log(`[Firecracker] Process spawned with PID ${pid}`);

    // Capture stderr for debugging
    let stderrData = "";

    child.stderr?.on("data", (data: Buffer) => {
      const str = data.toString();
      stderrData += str;
      console.error(`[Firecracker:${pid}] stderr: ${str.trim()}`);
    });

    // Handle process exit
    child.on("exit", (code: number | null, signal: string | null) => {
      if (code !== 0 && code !== null) {
        console.error(`[Firecracker:${pid}] Process exited with code ${code}`);
        console.error(`[Firecracker:${pid}] stderr: ${stderrData}`);
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
      stdinPipePath: pipePaths.stdin,
      stdoutPipePath: pipePaths.stdout,
    };
  } catch (error) {
    // Clean up pipes if spawning fails
    console.error(`[Firecracker] Spawn failed, cleaning up pipes`);
    await cleanupPipes({ vmId: options.vmId, pipeDir: socketDir });

    // Close file handles if opened
    if (stdinFd) {
      try {
        await stdinFd.close();
      } catch {
        // Ignore close errors
      }
    }
    if (stdoutFd) {
      try {
        await stdoutFd.close();
      } catch {
        // Ignore close errors
      }
    }

    throw error;
  }
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
 * Optionally cleans up serial console pipes if vmId is provided
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
          // Clean up pipes if vmId provided
          if (options.vmId) {
            await cleanupVMPipes(options.vmId, options.pipeDir);
          }
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
          // Clean up pipes if vmId provided
          if (options.vmId) {
            await cleanupVMPipes(options.vmId, options.pipeDir);
          }
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

  // Clean up pipes if vmId provided (process stopped successfully)
  if (options.vmId) {
    await cleanupVMPipes(options.vmId, options.pipeDir);
  }
}

/**
 * Clean up serial console pipes for a VM
 * Exported for use during VM deletion
 */
export async function cleanupVMPipes(
  vmId: string,
  pipeDir: string = DEFAULTS.socketDir
): Promise<void> {
  console.log(`[Firecracker] Cleaning up pipes for VM ${vmId}`);
  try {
    await cleanupPipes({ vmId, pipeDir });
    console.log(`[Firecracker] Pipes cleaned up successfully for VM ${vmId}`);
  } catch (error) {
    console.error(`[Firecracker] Failed to clean up pipes for VM ${vmId}:`, error);
    // Don't throw - pipe cleanup failures shouldn't prevent VM stop/delete
  }
}

/**
 * Get the pipe paths for a VM (derived from vmId)
 */
export function getVMPipePaths(
  vmId: string,
  pipeDir: string = DEFAULTS.socketDir
): { stdinPath: string; stdoutPath: string } {
  const paths = generatePipePaths(vmId, pipeDir);
  return {
    stdinPath: paths.stdin,
    stdoutPath: paths.stdout,
  };
}

/**
 * Check if a process is still running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists
    return true;
  } catch {
    return false;
  }
}
