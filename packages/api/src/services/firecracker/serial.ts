/**
 * Serial Console Service
 *
 * Manages serial console I/O via named pipes (FIFOs) for Firecracker VMs.
 * Provides bidirectional communication between WebSocket clients and VM serial console.
 */

import { spawn } from "child_process";
import { access, unlink, open as fsOpen, type FileHandle } from "fs/promises";

// ============================================================================
// Types
// ============================================================================

export interface SerialConsolePaths {
  stdin: string;
  stdout: string;
}

export interface SerialConsoleOptions {
  vmId: string;
  pipeDir?: string;
}

export interface SerialConsole {
  /** Write data to the VM's stdin */
  write(data: string | Uint8Array): Promise<void>;
  /** Register a callback for data from the VM's stdout */
  onData(callback: (data: Uint8Array) => void): void;
  /** Close the serial console and cleanup resources */
  close(): Promise<void>;
  /** Check if the serial console is still active */
  isActive(): boolean;
  /** Get the pipe paths */
  getPaths(): SerialConsolePaths;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULTS = {
  pipeDir: "/var/lib/bonfire/vms",
} as const;

// ============================================================================
// Error Classes
// ============================================================================

export class SerialConsoleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "SerialConsoleError";
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate pipe paths for a VM
 */
export function generatePipePaths(
  vmId: string,
  pipeDir: string = DEFAULTS.pipeDir
): SerialConsolePaths {
  return {
    stdin: `${pipeDir}/${vmId}.stdin`,
    stdout: `${pipeDir}/${vmId}.stdout`,
  };
}

/**
 * Generate xterm escape sequence for terminal resize
 * Uses the XTERM window manipulation escape sequence: ESC [ 8 ; rows ; cols t
 */
export function formatResizeMessage(cols: number, rows: number): string {
  return `\x1b[8;${rows};${cols}t`;
}

/**
 * Create a named pipe (FIFO) using mkfifo
 */
export async function createPipe(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("mkfifo", [path]);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new SerialConsoleError(`Failed to create pipe at ${path}`, "PIPE_CREATE_FAILED"));
      }
    });
    proc.on("error", (err) => {
      reject(
        new SerialConsoleError(
          `Failed to create pipe at ${path}: ${err.message}`,
          "PIPE_CREATE_ERROR",
          err
        )
      );
    });
  });
}

/**
 * Remove a pipe file
 */
export async function removePipe(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    // Ignore ENOENT (file doesn't exist)
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new SerialConsoleError(
        `Failed to remove pipe at ${path}`,
        "PIPE_REMOVE_FAILED",
        err as Error
      );
    }
  }
}

// ============================================================================
// Serial Console Implementation
// ============================================================================

/**
 * Create a serial console connection for a VM
 *
 * This connects to existing named pipes (created by spawnFirecracker) and sets up bidirectional streaming:
 * - stdin pipe: writes from WebSocket client go to VM
 * - stdout pipe: output from VM is sent to registered callbacks
 *
 * IMPORTANT: Pipes must already exist (created during VM spawn). This function
 * does NOT create new pipes - it connects to existing ones.
 */
export async function create(options: SerialConsoleOptions): Promise<SerialConsole> {
  const pipeDir = options.pipeDir ?? DEFAULTS.pipeDir;
  const paths = generatePipePaths(options.vmId, pipeDir);

  // Verify pipes exist before trying to connect
  const fileExists = async (path: string): Promise<boolean> => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };

  const stdinExists = await fileExists(paths.stdin);
  const stdoutExists = await fileExists(paths.stdout);

  if (!stdinExists || !stdoutExists) {
    throw new SerialConsoleError(
      `Serial console pipes not found for VM ${options.vmId}. ` +
        `stdin=${stdinExists ? "exists" : "MISSING"}, stdout=${stdoutExists ? "exists" : "MISSING"}. ` +
        `Ensure the VM is running.`,
      "PIPE_NOT_FOUND"
    );
  }

  let active = true;
  let writeHandle: FileHandle | null = null;
  const dataCallbacks: Array<(data: Uint8Array) => void> = [];

  // Open the write pipe immediately (for sending input TO the VM)
  // Use r+ mode to avoid blocking (FIFO opened for read+write doesn't block)
  const initWritePipe = async (): Promise<void> => {
    if (writeHandle !== null) return;
    writeHandle = await fsOpen(paths.stdout, "r+");
  };

  // Initialize write pipe on creation
  await initWritePipe();

  /**
   * Open stdout pipe for reading and start streaming
   * Note: Opening a FIFO for reading blocks until a writer connects
   */
  let readHandle: FileHandle | null = null;

  const openStdout = async (): Promise<void> => {
    if (readHandle !== null) return;

    // Read from the stdin pipe (VM output goes here due to stdio mapping in process.ts)
    // Note: pipe names are from VM perspective, but process.ts maps VM stdout -> .stdin pipe
    // Open as read+write to avoid blocking if the writer isn't connected yet.
    // For FIFOs, opening read-only can block until a writer opens the other end.
    // Using r+ keeps the fd usable and makes serial bootstrap more reliable.
    readHandle = await fsOpen(paths.stdin, "r+");

    const readLoop = async () => {
      const buffer = new Uint8Array(4096);

      try {
        while (active && readHandle) {
          // Read from the pipe using the file handle
          const result = await readHandle.read(buffer, 0, buffer.length);

          if (result.bytesRead === 0) {
            // EOF or no data - wait a bit and retry
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }

          // Get the actual data that was read
          const data = buffer.slice(0, result.bytesRead);

          // Notify all registered callbacks
          for (const callback of dataCallbacks) {
            try {
              callback(data);
            } catch (err) {
              console.error(`[SerialConsole:${options.vmId}] Callback error:`, err);
            }
          }
        }
      } catch (err) {
        if (active) {
          console.error(`[SerialConsole:${options.vmId}] Read error:`, err);
        }
      }
    };

    // Start reading in background (don't await)
    readLoop();
  };

  const write = async (data: string | Uint8Array): Promise<void> => {
    if (!active) {
      throw new SerialConsoleError("Serial console is not active", "CONSOLE_INACTIVE");
    }

    if (!writeHandle) {
      throw new SerialConsoleError("Write pipe not initialized", "PIPE_NOT_INITIALIZED");
    }

    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

    try {
      // Write to the stdout pipe using the open file handle
      // (VM input comes from here due to stdio mapping in process.ts)
      await writeHandle.write(bytes);
    } catch (err) {
      throw new SerialConsoleError(
        `Failed to write to serial console: ${(err as Error).message}`,
        "WRITE_FAILED",
        err as Error
      );
    }
  };

  const onData = (callback: (data: Uint8Array) => void): void => {
    dataCallbacks.push(callback);
    // Start reading from stdout if this is the first callback
    if (dataCallbacks.length === 1) {
      openStdout();
    }
  };

  const close = async (): Promise<void> => {
    if (!active) return;
    active = false;

    // Close the read handle
    if (readHandle) {
      try {
        await readHandle.close();
      } catch {
        // Ignore close errors
      }
      readHandle = null;
    }

    // Close the write handle
    if (writeHandle) {
      try {
        await writeHandle.close();
      } catch {
        // Ignore close errors
      }
      writeHandle = null;
    }

    // NOTE: We intentionally do NOT remove pipes here.
    // The pipes are owned by the Firecracker process and should only be
    // cleaned up when the VM is stopped (via cleanupPipes or cleanupVMPipes).
    // This allows reconnection to the terminal after a WebSocket disconnect.
    console.log(`[SerialConsole:${options.vmId}] Console closed (pipes preserved)`);
  };

  const isActive = (): boolean => active;

  const getPaths = (): SerialConsolePaths => paths;

  return {
    write,
    onData,
    close,
    isActive,
    getPaths,
  };
}

/**
 * Create pipes only (without starting the console)
 * Used when spawning Firecracker to ensure pipes exist before the process starts
 */
export async function createPipes(options: SerialConsoleOptions): Promise<SerialConsolePaths> {
  const pipeDir = options.pipeDir ?? DEFAULTS.pipeDir;
  const paths = generatePipePaths(options.vmId, pipeDir);

  // Remove any existing pipes first
  await removePipe(paths.stdin);
  await removePipe(paths.stdout);

  // Create fresh pipes
  await createPipe(paths.stdin);
  await createPipe(paths.stdout);

  return paths;
}

/**
 * Clean up pipes for a VM
 */
export async function cleanupPipes(options: SerialConsoleOptions): Promise<void> {
  const pipeDir = options.pipeDir ?? DEFAULTS.pipeDir;
  const paths = generatePipePaths(options.vmId, pipeDir);

  await removePipe(paths.stdin);
  await removePipe(paths.stdout);
}
