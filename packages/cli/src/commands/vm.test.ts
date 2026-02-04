/**
 * Unit tests for VM command argument parsing
 */

import { describe, it, expect } from "vitest";
import { parseVMCreateArgs } from "./vm.js";

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
