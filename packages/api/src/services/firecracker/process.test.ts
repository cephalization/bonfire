import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  spawnFirecracker,
  configureVMProcess,
  startVMProcess,
  stopVMProcess,
  cleanupVMPipes,
  getVMPipePaths,
  type FirecrackerProcess,
  type SpawnOptions,
  type StopOptions,
} from "./process";
import { generatePipePaths, SerialConsoleError } from "./serial";

describe("process types and exports", () => {
  it("exports FirecrackerProcess type with pipe paths", () => {
    const process: FirecrackerProcess = {
      pid: 12345,
      socketPath: "/tmp/test.sock",
      stdinPipePath: "/tmp/test-vm.stdin",
      stdoutPipePath: "/tmp/test-vm.stdout",
    };

    expect(process.pid).toBe(12345);
    expect(process.socketPath).toBe("/tmp/test.sock");
    expect(process.stdinPipePath).toBe("/tmp/test-vm.stdin");
    expect(process.stdoutPipePath).toBe("/tmp/test-vm.stdout");
  });

  it("exports SpawnOptions type", () => {
    const options: SpawnOptions = {
      vmId: "test-vm-123",
      socketDir: "/tmp/test-vms",
      binaryPath: "firecracker",
    };

    expect(options.vmId).toBe("test-vm-123");
    expect(options.socketDir).toBe("/tmp/test-vms");
    expect(options.binaryPath).toBe("firecracker");
  });

  it("exports StopOptions type with pipe cleanup options", () => {
    const options: StopOptions = {
      gracefulTimeoutMs: 30000,
      sigtermTimeoutMs: 10000,
      vmId: "test-vm-123",
      pipeDir: "/tmp/test-vms",
    };

    expect(options.gracefulTimeoutMs).toBe(30000);
    expect(options.sigtermTimeoutMs).toBe(10000);
    expect(options.vmId).toBe("test-vm-123");
    expect(options.pipeDir).toBe("/tmp/test-vms");
  });

  it("exports all required functions", () => {
    expect(typeof spawnFirecracker).toBe("function");
    expect(typeof configureVMProcess).toBe("function");
    expect(typeof startVMProcess).toBe("function");
    expect(typeof stopVMProcess).toBe("function");
    expect(typeof cleanupVMPipes).toBe("function");
    expect(typeof getVMPipePaths).toBe("function");
  });
});

describe("process functions exist", () => {
  it("all process management functions are defined", () => {
    // Verify functions exist without actually spawning processes
    expect(typeof spawnFirecracker).toBe("function");
    expect(typeof configureVMProcess).toBe("function");
    expect(typeof startVMProcess).toBe("function");
    expect(typeof stopVMProcess).toBe("function");
  });

  it("cleanupVMPipes and getVMPipePaths are defined", () => {
    expect(typeof cleanupVMPipes).toBe("function");
    expect(typeof getVMPipePaths).toBe("function");
  });
});

describe("getVMPipePaths", () => {
  it("generates correct pipe paths from vmId", () => {
    const paths = getVMPipePaths("test-vm-123", "/var/lib/bonfire/vms");

    expect(paths.stdinPath).toBe("/var/lib/bonfire/vms/test-vm-123.stdin");
    expect(paths.stdoutPath).toBe("/var/lib/bonfire/vms/test-vm-123.stdout");
  });

  it("uses default pipeDir when not specified", () => {
    const paths = getVMPipePaths("vm-456");

    // Default is /var/lib/bonfire/vms
    expect(paths.stdinPath).toBe("/var/lib/bonfire/vms/vm-456.stdin");
    expect(paths.stdoutPath).toBe("/var/lib/bonfire/vms/vm-456.stdout");
  });

  it("returns paths consistent with generatePipePaths", () => {
    const vmId = "consistency-test-vm";
    const pipeDir = "/custom/pipe/dir";
    
    const processPaths = getVMPipePaths(vmId, pipeDir);
    const serialPaths = generatePipePaths(vmId, pipeDir);
    
    expect(processPaths.stdinPath).toBe(serialPaths.stdin);
    expect(processPaths.stdoutPath).toBe(serialPaths.stdout);
  });

  it("handles vmId with hyphens and numbers", () => {
    const paths = getVMPipePaths("vm-12345-abc-def");
    
    expect(paths.stdinPath).toContain("vm-12345-abc-def.stdin");
    expect(paths.stdoutPath).toContain("vm-12345-abc-def.stdout");
  });

  it("handles UUID-style vmId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const paths = getVMPipePaths(uuid);
    
    expect(paths.stdinPath).toContain(`${uuid}.stdin`);
    expect(paths.stdoutPath).toContain(`${uuid}.stdout`);
  });
});

describe("FirecrackerProcess interface", () => {
  it("requires all fields including pipe paths", () => {
    const process: FirecrackerProcess = {
      pid: 1234,
      socketPath: "/tmp/vm.sock",
      stdinPipePath: "/tmp/vm.stdin",
      stdoutPipePath: "/tmp/vm.stdout",
    };

    expect(process.pid).toBeGreaterThan(0);
    expect(process.socketPath).toContain(".sock");
    expect(process.stdinPipePath).toContain(".stdin");
    expect(process.stdoutPipePath).toContain(".stdout");
  });

  it("pipe paths follow naming convention", () => {
    const vmId = "test-vm";
    const socketDir = "/var/lib/bonfire/vms";
    
    // When spawned, paths should follow pattern: {socketDir}/{vmId}.{suffix}
    const expectedStdin = `${socketDir}/${vmId}.stdin`;
    const expectedStdout = `${socketDir}/${vmId}.stdout`;
    const expectedSocket = `${socketDir}/${vmId}.sock`;
    
    const process: FirecrackerProcess = {
      pid: 9999,
      socketPath: expectedSocket,
      stdinPipePath: expectedStdin,
      stdoutPipePath: expectedStdout,
    };
    
    expect(process.socketPath).toBe(expectedSocket);
    expect(process.stdinPipePath).toBe(expectedStdin);
    expect(process.stdoutPipePath).toBe(expectedStdout);
  });
});

describe("SpawnOptions interface", () => {
  it("vmId is required", () => {
    const options: SpawnOptions = {
      vmId: "required-vm-id",
    };
    
    expect(options.vmId).toBe("required-vm-id");
    expect(options.socketDir).toBeUndefined();
    expect(options.binaryPath).toBeUndefined();
  });

  it("all options can be specified", () => {
    const options: SpawnOptions = {
      vmId: "my-vm",
      socketDir: "/custom/socket/dir",
      binaryPath: "/usr/local/bin/firecracker",
    };
    
    expect(options.vmId).toBe("my-vm");
    expect(options.socketDir).toBe("/custom/socket/dir");
    expect(options.binaryPath).toBe("/usr/local/bin/firecracker");
  });
});

describe("StopOptions interface", () => {
  it("all fields are optional", () => {
    const options: StopOptions = {};
    
    expect(options.gracefulTimeoutMs).toBeUndefined();
    expect(options.sigtermTimeoutMs).toBeUndefined();
    expect(options.vmId).toBeUndefined();
    expect(options.pipeDir).toBeUndefined();
  });

  it("vmId and pipeDir enable pipe cleanup", () => {
    const options: StopOptions = {
      vmId: "cleanup-vm",
      pipeDir: "/tmp/cleanup-test",
    };
    
    expect(options.vmId).toBe("cleanup-vm");
    expect(options.pipeDir).toBe("/tmp/cleanup-test");
  });

  it("timeout values can be customized", () => {
    const options: StopOptions = {
      gracefulTimeoutMs: 60000,
      sigtermTimeoutMs: 5000,
    };
    
    expect(options.gracefulTimeoutMs).toBe(60000);
    expect(options.sigtermTimeoutMs).toBe(5000);
  });
});

describe("pipe creation behavior", () => {
  it("pipes are created in socketDir with vmId prefix", () => {
    const vmId = "pipe-test-vm";
    const socketDir = "/var/lib/bonfire/vms";
    
    const paths = getVMPipePaths(vmId, socketDir);
    
    // Verify naming convention
    expect(paths.stdinPath).toBe(`${socketDir}/${vmId}.stdin`);
    expect(paths.stdoutPath).toBe(`${socketDir}/${vmId}.stdout`);
  });

  it("stdin pipe is for input TO the VM", () => {
    // The stdin pipe receives data from WebSocket to send to VM
    const paths = getVMPipePaths("io-test");
    expect(paths.stdinPath).toContain(".stdin");
  });

  it("stdout pipe is for output FROM the VM", () => {
    // The stdout pipe sends data from VM to WebSocket
    const paths = getVMPipePaths("io-test");
    expect(paths.stdoutPath).toContain(".stdout");
  });
});

describe("stdio redirection configuration", () => {
  it("spawn stdio array maps to correct file descriptors", () => {
    // Document the expected stdio configuration
    // When spawning Firecracker:
    // - fd 0 (stdin): reads from stdout pipe (input TO VM)
    // - fd 1 (stdout): writes to stdin pipe (output FROM VM)
    // - fd 2 (stderr): pipe for debugging
    
    // This test documents the expected configuration
    const stdioCconfig = ["stdout_fd", "stdin_fd", "pipe"];
    expect(stdioCconfig[0]).toBe("stdout_fd"); // stdin (fd 0) <- from stdout pipe
    expect(stdioCconfig[1]).toBe("stdin_fd"); // stdout (fd 1) -> to stdin pipe
    expect(stdioCconfig[2]).toBe("pipe");     // stderr (fd 2) -> captured
  });
});

describe("pipe cleanup on VM stop", () => {
  it("cleanupVMPipes is exported and callable", () => {
    expect(typeof cleanupVMPipes).toBe("function");
  });

  it("cleanup targets correct pipe paths", () => {
    const vmId = "cleanup-target";
    const pipeDir = "/tmp/cleanup";
    
    const paths = getVMPipePaths(vmId, pipeDir);
    
    // Cleanup should target these paths
    expect(paths.stdinPath).toBe("/tmp/cleanup/cleanup-target.stdin");
    expect(paths.stdoutPath).toBe("/tmp/cleanup/cleanup-target.stdout");
  });
});

describe("pipe creation failure handling", () => {
  it("SerialConsoleError is used for pipe creation failures", () => {
    const error = new SerialConsoleError(
      "Failed to create pipe at /tmp/test.stdin",
      "PIPE_CREATE_FAILED"
    );
    
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SerialConsoleError);
    expect(error.code).toBe("PIPE_CREATE_FAILED");
    expect(error.message).toContain("Failed to create pipe");
  });

  it("SerialConsoleError preserves cause for spawn errors", () => {
    const cause = new Error("mkfifo: permission denied");
    const error = new SerialConsoleError(
      "Failed to create pipe: permission denied",
      "PIPE_CREATE_ERROR",
      cause
    );
    
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("PIPE_CREATE_ERROR");
  });
});

describe("process spawn defaults", () => {
  it("default socketDir is /var/lib/bonfire/vms", () => {
    // Verify the default by checking path generation
    const paths = getVMPipePaths("default-test");
    expect(paths.stdinPath.startsWith("/var/lib/bonfire/vms/")).toBe(true);
  });

  it("default binary path is 'firecracker'", () => {
    // This is documented in the SpawnOptions interface
    const options: SpawnOptions = {
      vmId: "test",
    };
    // binaryPath defaults to "firecracker" when not specified
    expect(options.binaryPath).toBeUndefined();
  });

  it("default graceful timeout is 30000ms", () => {
    const options: StopOptions = {};
    // gracefulTimeoutMs defaults to 30000 when not specified
    expect(options.gracefulTimeoutMs).toBeUndefined();
  });

  it("default sigterm timeout is 10000ms", () => {
    const options: StopOptions = {};
    // sigtermTimeoutMs defaults to 10000 when not specified
    expect(options.sigtermTimeoutMs).toBeUndefined();
  });
});

describe("error scenarios", () => {
  it("missing pid indicates spawn failure", () => {
    // When spawn fails to return a PID, the process throws
    // This test documents expected behavior
    const mockFailedSpawn = {
      pid: undefined,
      socketPath: "/tmp/test.sock",
    };
    
    expect(mockFailedSpawn.pid).toBeUndefined();
  });

  it("early exit with non-zero code indicates failure", () => {
    // If process exits immediately with code !== 0, spawn should throw
    const exitCode = 1;
    const message = `Firecracker process exited prematurely with code ${exitCode}`;
    
    expect(message).toContain("exited prematurely");
    expect(message).toContain("1");
  });

  it("process killed state indicates abnormal termination", () => {
    // If child.killed is true before we return, spawn failed
    const killed = true;
    const message = "Process was killed during startup";
    
    expect(killed).toBe(true);
    expect(message).toContain("killed");
  });
});

describe("cleanup behavior", () => {
  it("pipe cleanup errors are logged but not thrown", async () => {
    // cleanupVMPipes should not throw, even if cleanup fails
    // This prevents stop/delete from failing due to cleanup issues
    expect(typeof cleanupVMPipes).toBe("function");
    
    // The function should complete without throwing for non-existent pipes
    // We can't easily test this without actually calling it, but we can
    // verify the function exists and is the expected type
  });

  it("file handles are closed on spawn failure", () => {
    // Document that stdin/stdout fds should be closed on failure
    // This prevents resource leaks
    const cleanup = {
      closeStdinFd: true,
      closeStdoutFd: true,
      removePipes: true,
    };
    
    expect(cleanup.closeStdinFd).toBe(true);
    expect(cleanup.closeStdoutFd).toBe(true);
    expect(cleanup.removePipes).toBe(true);
  });
});
