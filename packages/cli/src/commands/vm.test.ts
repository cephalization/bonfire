/**
 * Unit tests for VM command argument parsing
 */

import { describe, it, expect } from "vitest";
import { parseVMCreateArgs, parseExecArgs } from "./vm.js";

describe("parseVMCreateArgs", () => {
  it("parses name only", () => {
    const result = parseVMCreateArgs(["my-vm"]);
    expect(result.name).toBe("my-vm");
    expect(result.vcpus).toBeUndefined();
    expect(result.memory).toBeUndefined();
    expect(result.image).toBeUndefined();
  });

  it("parses --vcpus flag", () => {
    const result = parseVMCreateArgs(["my-vm", "--vcpus=4"]);
    expect(result.name).toBe("my-vm");
    expect(result.vcpus).toBe(4);
  });

  it("parses --memory flag", () => {
    const result = parseVMCreateArgs(["my-vm", "--memory=2048"]);
    expect(result.name).toBe("my-vm");
    expect(result.memory).toBe(2048);
  });

  it("parses --image flag", () => {
    const result = parseVMCreateArgs(["my-vm", "--image=ubuntu:latest"]);
    expect(result.name).toBe("my-vm");
    expect(result.image).toBe("ubuntu:latest");
  });

  it("parses all flags together", () => {
    const result = parseVMCreateArgs(["my-vm", "--vcpus=2", "--memory=1024", "--image=debian:12"]);
    expect(result.name).toBe("my-vm");
    expect(result.vcpus).toBe(2);
    expect(result.memory).toBe(1024);
    expect(result.image).toBe("debian:12");
  });

  it("throws when name is missing", () => {
    expect(() => parseVMCreateArgs([])).toThrow("VM name is required");
  });

  it("throws on invalid --vcpus value", () => {
    expect(() => parseVMCreateArgs(["my-vm", "--vcpus=0"])).toThrow("Invalid --vcpus value");
    expect(() => parseVMCreateArgs(["my-vm", "--vcpus=abc"])).toThrow("Invalid --vcpus value");
    expect(() => parseVMCreateArgs(["my-vm", "--vcpus=-1"])).toThrow("Invalid --vcpus value");
  });

  it("throws on invalid --memory value", () => {
    expect(() => parseVMCreateArgs(["my-vm", "--memory=0"])).toThrow("Invalid --memory value");
    expect(() => parseVMCreateArgs(["my-vm", "--memory=abc"])).toThrow("Invalid --memory value");
    expect(() => parseVMCreateArgs(["my-vm", "--memory=-1"])).toThrow("Invalid --memory value");
  });

  it("throws on unknown option", () => {
    expect(() => parseVMCreateArgs(["my-vm", "--unknown=value"])).toThrow(
      "Unknown option: --unknown=value"
    );
  });

  it("handles flags in any order", () => {
    const result = parseVMCreateArgs(["my-vm", "--image=alpine", "--vcpus=1", "--memory=512"]);
    expect(result.name).toBe("my-vm");
    expect(result.vcpus).toBe(1);
    expect(result.memory).toBe(512);
    expect(result.image).toBe("alpine");
  });
});

describe("parseExecArgs", () => {
  it("parses simple command", () => {
    const result = parseExecArgs(["my-vm", "--", "ls"]);
    expect(result.vmIdentifier).toBe("my-vm");
    expect(result.command).toBe("ls");
    expect(result.args).toEqual([]);
  });

  it("parses command with arguments", () => {
    const result = parseExecArgs(["my-vm", "--", "ls", "-la", "/home"]);
    expect(result.vmIdentifier).toBe("my-vm");
    expect(result.command).toBe("ls");
    expect(result.args).toEqual(["-la", "/home"]);
  });

  it("parses command with VM ID", () => {
    const result = parseExecArgs(["vm-123-abc", "--", "echo", "hello"]);
    expect(result.vmIdentifier).toBe("vm-123-abc");
    expect(result.command).toBe("echo");
    expect(result.args).toEqual(["hello"]);
  });

  it("throws when VM identifier is missing", () => {
    expect(() => parseExecArgs([])).toThrow("VM name or ID is required");
  });

  it("throws when -- separator is missing", () => {
    expect(() => parseExecArgs(["my-vm", "ls"])).toThrow(
      "Command required. Usage: bonfire vm exec <name|id> -- <command> [args...]"
    );
  });

  it("throws when command is missing after --", () => {
    expect(() => parseExecArgs(["my-vm", "--"])).toThrow(
      "Command required. Usage: bonfire vm exec <name|id> -- <command> [args...]"
    );
  });

  it("handles complex commands with many args", () => {
    const result = parseExecArgs([
      "my-vm",
      "--",
      "curl",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "https://api.example.com/data",
    ]);
    expect(result.vmIdentifier).toBe("my-vm");
    expect(result.command).toBe("curl");
    expect(result.args).toEqual([
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "https://api.example.com/data",
    ]);
  });
});
