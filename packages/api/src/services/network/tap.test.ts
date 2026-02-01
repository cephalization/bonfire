/**
 * TAP Device Management Service Tests
 *
 * Unit tests using dependency-injected exec mock.
 * No actual system calls are made.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTap, deleteTap, __setExecAsync, __resetExecAsync } from "./tap";

type ExecAsyncFn = (command: string) => Promise<{ stdout: string; stderr: string }>;

describe("createTap", () => {
  let execCalls: string[] = [];

  beforeEach(() => {
    execCalls = [];
    const mockExec: ExecAsyncFn = async (command: string) => {
      execCalls.push(command);
      return { stdout: "", stderr: "" };
    };
    __setExecAsync(mockExec as any);
  });

  afterEach(() => {
    __resetExecAsync();
  });

  it("should create TAP device with correct name format", async () => {
    const result = await createTap("vm-123");

    expect(result.tapName).toBe("tap-bf-vm-123");
    expect(result.macAddress).toMatch(/^02:00:00:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
  });

  it("should execute correct ip commands in sequence", async () => {
    await createTap("vm-456");

    expect(execCalls).toHaveLength(3);
    expect(execCalls[0]).toBe("ip tuntap add dev tap-bf-vm-456 mode tap");
    expect(execCalls[1]).toBe("ip link set dev tap-bf-vm-456 up");
    expect(execCalls[2]).toBe("ip link set dev tap-bf-vm-456 master bonfire0");
  });

  it("should use custom bridge name from environment", async () => {
    const originalBridge = process.env.BONFIRE_BRIDGE;
    process.env.BONFIRE_BRIDGE = "custom-bridge";

    await createTap("vm-789");

    expect(execCalls[2]).toBe("ip link set dev tap-bf-vm-789 master custom-bridge");

    // Restore
    if (originalBridge === undefined) {
      delete process.env.BONFIRE_BRIDGE;
    } else {
      process.env.BONFIRE_BRIDGE = originalBridge;
    }
  });

  it("should throw permission denied error when operation not permitted", async () => {
    const mockExec: ExecAsyncFn = async () => {
      const error = new Error("Operation not permitted");
      throw error;
    };
    __setExecAsync(mockExec as any);

    await expect(createTap("vm-001")).rejects.toThrow("Permission denied");
  });

  it("should throw bridge not found error when bridge does not exist", async () => {
    const mockExec: ExecAsyncFn = async () => {
      const error = new Error("No such device");
      throw error;
    };
    __setExecAsync(mockExec as any);

    await expect(createTap("vm-002")).rejects.toThrow("Bridge 'bonfire0' does not exist");
  });

  it("should attempt cleanup on failure", async () => {
    let callCount = 0;
    const mockExec: ExecAsyncFn = async (command: string) => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Some error");
      }
      return { stdout: "", stderr: "" };
    };
    __setExecAsync(mockExec as any);

    try {
      await createTap("vm-003");
    } catch {
      // Expected to throw
    }

    // Should have called delete (4th call)
    expect(callCount).toBeGreaterThanOrEqual(4);
  });

  it("should generate deterministic MAC addresses", async () => {
    const result1 = await createTap("same-vm-id");
    const result2 = await createTap("same-vm-id");

    expect(result1.macAddress).toBe(result2.macAddress);
  });
});

describe("deleteTap", () => {
  let execCalls: string[] = [];

  beforeEach(() => {
    execCalls = [];
    const mockExec: ExecAsyncFn = async (command: string) => {
      execCalls.push(command);
      return { stdout: "", stderr: "" };
    };
    __setExecAsync(mockExec as any);
  });

  afterEach(() => {
    __resetExecAsync();
  });

  it("should execute correct cleanup commands", async () => {
    await deleteTap("tap-bf-vm-001");

    expect(execCalls).toHaveLength(3);
    expect(execCalls[0]).toBe("ip link set dev tap-bf-vm-001 nomaster");
    expect(execCalls[1]).toBe("ip link set dev tap-bf-vm-001 down");
    expect(execCalls[2]).toBe("ip tuntap del dev tap-bf-vm-001 mode tap");
  });

  it("should succeed when device does not exist", async () => {
    const mockExec: ExecAsyncFn = async () => {
      const error = new Error("No such device");
      throw error;
    };
    __setExecAsync(mockExec as any);

    // Should not throw
    await expect(deleteTap("tap-bf-nonexistent")).resolves.toBeUndefined();
  });

  it("should throw permission denied error when operation not permitted", async () => {
    const mockExec: ExecAsyncFn = async () => {
      const error = new Error("Operation not permitted");
      throw error;
    };
    __setExecAsync(mockExec as any);

    await expect(deleteTap("tap-bf-vm-002")).rejects.toThrow("Permission denied");
  });

  it("should ignore errors when detaching from bridge or bringing down", async () => {
    let callCount = 0;
    const mockExec: ExecAsyncFn = async () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("Some error");
      }
      return { stdout: "", stderr: "" };
    };
    __setExecAsync(mockExec as any);

    // Should not throw
    await expect(deleteTap("tap-bf-vm-003")).resolves.toBeUndefined();
  });
});
