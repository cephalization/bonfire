/**
 * Agent Shell Service Unit Tests
 *
 * Tests for message formatting and parsing functions.
 * These tests are pure unit tests with no I/O.
 */

import { describe, it, expect } from "bun:test";
import {
  parseResizeMessage,
  isResizeMessage,
  formatOutputData,
  formatInputData,
  ShellError,
  ShellConnectionError,
} from "./shell";

describe("parseResizeMessage", () => {
  it("parses resize message with nested resize object", () => {
    const data = '{"resize": {"cols": 80, "rows": 24}}';
    const result = parseResizeMessage(data);
    expect(result).toEqual({ cols: 80, rows: 24 });
  });

  it("parses resize message with flat cols/rows", () => {
    const data = '{"cols": 120, "rows": 40}';
    const result = parseResizeMessage(data);
    expect(result).toEqual({ cols: 120, rows: 40 });
  });

  it("parses resize message from Uint8Array", () => {
    const data = new TextEncoder().encode('{"resize": {"cols": 100, "rows": 30}}');
    const result = parseResizeMessage(data);
    expect(result).toEqual({ cols: 100, rows: 30 });
  });

  it("returns null for non-resize messages", () => {
    const data = '{"type": "input", "data": "hello"}';
    const result = parseResizeMessage(data);
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const data = "not valid json";
    const result = parseResizeMessage(data);
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseResizeMessage("");
    expect(result).toBeNull();
  });

  it("uses default values when cols/rows are missing in resize object", () => {
    const data = '{"resize": {}}';
    const result = parseResizeMessage(data);
    expect(result).toEqual({ cols: 80, rows: 24 });
  });

  it("prefers resize object cols over flat cols", () => {
    const data = '{"resize": {"cols": 80}, "cols": 120}';
    const result = parseResizeMessage(data);
    expect(result).toEqual({ cols: 80, rows: 24 });
  });
});

describe("isResizeMessage", () => {
  it("returns true for resize message with nested object", () => {
    const data = '{"resize": {"cols": 80, "rows": 24}}';
    expect(isResizeMessage(data)).toBe(true);
  });

  it("returns true for resize message with flat cols/rows", () => {
    const data = '{"cols": 120, "rows": 40}';
    expect(isResizeMessage(data)).toBe(true);
  });

  it("returns false for non-resize messages", () => {
    const data = '{"type": "input", "data": "hello"}';
    expect(isResizeMessage(data)).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    const data = "not valid json";
    expect(isResizeMessage(data)).toBe(false);
  });
});

describe("formatOutputData", () => {
  it("returns string as-is", () => {
    const data = "hello world";
    expect(formatOutputData(data)).toBe("hello world");
  });

  it("decodes Uint8Array to string", () => {
    const data = new TextEncoder().encode("hello world");
    expect(formatOutputData(data)).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(formatOutputData("")).toBe("");
  });

  it("handles empty Uint8Array", () => {
    const data = new Uint8Array(0);
    expect(formatOutputData(data)).toBe("");
  });

  it("handles special characters", () => {
    const data = new TextEncoder().encode("hello\nworld\t!");
    expect(formatOutputData(data)).toBe("hello\nworld\t!");
  });

  it("handles unicode characters", () => {
    const data = new TextEncoder().encode("hello 🌍 world");
    expect(formatOutputData(data)).toBe("hello 🌍 world");
  });
});

describe("formatInputData", () => {
  it("encodes string to Uint8Array", () => {
    const data = "hello world";
    const result = formatInputData(data);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe("hello world");
  });

  it("returns Uint8Array as-is", () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = formatInputData(data);
    expect(result).toBe(data);
  });

  it("handles empty string", () => {
    const result = formatInputData("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it("handles special characters", () => {
    const data = "hello\nworld\t!";
    const result = formatInputData(data);
    expect(new TextDecoder().decode(result)).toBe("hello\nworld\t!");
  });
});

describe("ShellError", () => {
  it("creates error with message", () => {
    const error = new ShellError("test error");
    expect(error.message).toBe("test error");
    expect(error.name).toBe("ShellError");
  });

  it("creates error with cause", () => {
    const cause = new Error("original error");
    const error = new ShellError("test error", cause);
    expect(error.message).toBe("test error");
    expect(error.cause).toBe(cause);
  });
});

describe("ShellConnectionError", () => {
  it("creates error with message", () => {
    const error = new ShellConnectionError("connection failed");
    expect(error.message).toBe("connection failed");
    expect(error.name).toBe("ShellConnectionError");
  });

  it("creates error with cause", () => {
    const cause = new Error("network error");
    const error = new ShellConnectionError("connection failed", cause);
    expect(error.message).toBe("connection failed");
    expect(error.cause).toBe(cause);
  });
});
