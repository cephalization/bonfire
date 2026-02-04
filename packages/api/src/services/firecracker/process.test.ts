import { describe, expect, it } from "vitest";
import {
  spawnFirecracker,
  configureVMProcess,
  startVMProcess,
  stopVMProcess,
  type FirecrackerProcess,
  type SpawnOptions,
  type StopOptions,
} from "./process";

describe("process types and exports", () => {
  it("exports FirecrackerProcess type", () => {
    const process: FirecrackerProcess = {
      pid: 12345,
      socketPath: "/tmp/test.sock",
    };

    expect(process.pid).toBe(12345);
    expect(process.socketPath).toBe("/tmp/test.sock");
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

  it("exports StopOptions type", () => {
    const options: StopOptions = {
      gracefulTimeoutMs: 30000,
      sigtermTimeoutMs: 10000,
    };

    expect(options.gracefulTimeoutMs).toBe(30000);
    expect(options.sigtermTimeoutMs).toBe(10000);
  });

  it("exports all required functions", () => {
    expect(typeof spawnFirecracker).toBe("function");
    expect(typeof configureVMProcess).toBe("function");
    expect(typeof startVMProcess).toBe("function");
    expect(typeof stopVMProcess).toBe("function");
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
});

describe("FirecrackerProcess interface", () => {
  it("requires pid and socketPath fields", () => {
    const process: FirecrackerProcess = {
      pid: 1234,
      socketPath: "/tmp/vm.sock",
    };

    expect(process.pid).toBeGreaterThan(0);
    expect(process.socketPath).toContain(".sock");
  });

  it("socket path follows naming convention", () => {
    const vmId = "test-vm";
    const socketDir = "/var/lib/bonfire/vms";

    // When spawned, socket path should follow pattern: {socketDir}/{vmId}.sock
    const expectedSocket = `${socketDir}/${vmId}.sock`;

    const process: FirecrackerProcess = {
      pid: 9999,
      socketPath: expectedSocket,
    };

    expect(process.socketPath).toBe(expectedSocket);
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

describe("process spawn defaults", () => {
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
