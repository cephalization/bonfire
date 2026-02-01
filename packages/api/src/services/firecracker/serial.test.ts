import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  generatePipePaths,
  formatResizeMessage,
  SerialConsoleError,
  create,
  createPipes,
  cleanupPipes,
  createPipe,
  removePipe,
  type SerialConsole,
  type SerialConsolePaths,
  type SerialConsoleOptions,
} from "./serial";

describe("generatePipePaths", () => {
  it("generates correct pipe paths with default directory", () => {
    const paths = generatePipePaths("test-vm-123");

    expect(paths.stdin).toBe("/var/lib/bonfire/vms/test-vm-123.stdin");
    expect(paths.stdout).toBe("/var/lib/bonfire/vms/test-vm-123.stdout");
  });

  it("generates correct pipe paths with custom directory", () => {
    const paths = generatePipePaths("my-vm", "/tmp/custom");

    expect(paths.stdin).toBe("/tmp/custom/my-vm.stdin");
    expect(paths.stdout).toBe("/tmp/custom/my-vm.stdout");
  });

  it("handles vmId with special characters", () => {
    const paths = generatePipePaths("vm-with-dashes-123");

    expect(paths.stdin).toContain("vm-with-dashes-123.stdin");
    expect(paths.stdout).toContain("vm-with-dashes-123.stdout");
  });
});

describe("formatResizeMessage", () => {
  it("generates correct xterm resize escape sequence", () => {
    const message = formatResizeMessage(80, 24);

    // ESC [ 8 ; rows ; cols t
    expect(message).toBe("\x1b[8;24;80t");
  });

  it("handles large dimensions", () => {
    const message = formatResizeMessage(200, 100);

    expect(message).toBe("\x1b[8;100;200t");
  });

  it("handles small dimensions", () => {
    const message = formatResizeMessage(40, 10);

    expect(message).toBe("\x1b[8;10;40t");
  });
});

describe("SerialConsoleError", () => {
  it("creates error with message and code", () => {
    const error = new SerialConsoleError("Test error", "TEST_CODE");

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("SerialConsoleError");
    expect(error.cause).toBeUndefined();
  });

  it("creates error with cause", () => {
    const cause = new Error("Original error");
    const error = new SerialConsoleError("Wrapped error", "WRAP_CODE", cause);

    expect(error.message).toBe("Wrapped error");
    expect(error.code).toBe("WRAP_CODE");
    expect(error.cause).toBe(cause);
  });

  it("is instance of Error", () => {
    const error = new SerialConsoleError("Test", "CODE");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SerialConsoleError);
  });
});

describe("SerialConsole interface types", () => {
  it("exports SerialConsolePaths type", () => {
    const paths: SerialConsolePaths = {
      stdin: "/path/to/stdin",
      stdout: "/path/to/stdout",
    };

    expect(paths.stdin).toBe("/path/to/stdin");
    expect(paths.stdout).toBe("/path/to/stdout");
  });

  it("exports SerialConsoleOptions type", () => {
    const options: SerialConsoleOptions = {
      vmId: "test-vm",
      pipeDir: "/tmp/pipes",
    };

    expect(options.vmId).toBe("test-vm");
    expect(options.pipeDir).toBe("/tmp/pipes");
  });

  it("SerialConsoleOptions allows optional pipeDir", () => {
    const options: SerialConsoleOptions = {
      vmId: "test-vm",
    };

    expect(options.vmId).toBe("test-vm");
    expect(options.pipeDir).toBeUndefined();
  });
});

describe("exports", () => {
  it("exports create function", () => {
    expect(typeof create).toBe("function");
  });

  it("exports createPipes function", () => {
    expect(typeof createPipes).toBe("function");
  });

  it("exports cleanupPipes function", () => {
    expect(typeof cleanupPipes).toBe("function");
  });

  it("exports generatePipePaths function", () => {
    expect(typeof generatePipePaths).toBe("function");
  });

  it("exports formatResizeMessage function", () => {
    expect(typeof formatResizeMessage).toBe("function");
  });

  it("exports SerialConsoleError class", () => {
    expect(typeof SerialConsoleError).toBe("function");
    expect(new SerialConsoleError("test", "CODE")).toBeInstanceOf(Error);
  });
});

describe("SerialConsole interface", () => {
  it("defines required methods", () => {
    // Type check - this verifies the interface shape
    const mockConsole: SerialConsole = {
      write: async () => {},
      onData: () => {},
      close: async () => {},
      isActive: () => true,
      getPaths: () => ({ stdin: "/stdin", stdout: "/stdout" }),
    };

    expect(typeof mockConsole.write).toBe("function");
    expect(typeof mockConsole.onData).toBe("function");
    expect(typeof mockConsole.close).toBe("function");
    expect(typeof mockConsole.isActive).toBe("function");
    expect(typeof mockConsole.getPaths).toBe("function");
  });
});

describe("createPipe and removePipe exports", () => {
  it("exports createPipe function", () => {
    expect(typeof createPipe).toBe("function");
  });

  it("exports removePipe function", () => {
    expect(typeof removePipe).toBe("function");
  });
});

describe("data formatting utilities", () => {
  describe("formatResizeMessage edge cases", () => {
    it("handles minimum valid dimensions", () => {
      const message = formatResizeMessage(1, 1);
      expect(message).toBe("\x1b[8;1;1t");
    });

    it("handles zero dimensions", () => {
      // While not realistic, the function should still format correctly
      const message = formatResizeMessage(0, 0);
      expect(message).toBe("\x1b[8;0;0t");
    });

    it("generates xterm control sequence with correct order (rows before cols)", () => {
      // The xterm sequence is: ESC [ 8 ; rows ; cols t
      // So for cols=120, rows=40 we expect: \x1b[8;40;120t
      const message = formatResizeMessage(120, 40);

      // Verify the escape character
      expect(message.charCodeAt(0)).toBe(0x1b); // ESC
      expect(message.charAt(1)).toBe("[");
      expect(message).toContain(";40;"); // rows
      expect(message).toContain(";120t"); // cols followed by 't'
    });

    it("message starts with ESC character", () => {
      const message = formatResizeMessage(80, 24);
      expect(message.charCodeAt(0)).toBe(0x1b);
    });

    it("message ends with 't' character", () => {
      const message = formatResizeMessage(80, 24);
      expect(message.charAt(message.length - 1)).toBe("t");
    });
  });

  describe("generatePipePaths edge cases", () => {
    it("handles empty vmId", () => {
      const paths = generatePipePaths("");
      expect(paths.stdin).toBe("/var/lib/bonfire/vms/.stdin");
      expect(paths.stdout).toBe("/var/lib/bonfire/vms/.stdout");
    });

    it("handles vmId with UUID format", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const paths = generatePipePaths(uuid);

      expect(paths.stdin).toContain(uuid);
      expect(paths.stdout).toContain(uuid);
    });

    it("handles trailing slash in pipeDir", () => {
      const paths = generatePipePaths("vm-123", "/tmp/pipes/");

      // Should work even with trailing slash (though results in double slash)
      expect(paths.stdin).toBe("/tmp/pipes//vm-123.stdin");
    });

    it("handles path with spaces in pipeDir", () => {
      const paths = generatePipePaths("vm-123", "/tmp/my pipes");

      expect(paths.stdin).toBe("/tmp/my pipes/vm-123.stdin");
      expect(paths.stdout).toBe("/tmp/my pipes/vm-123.stdout");
    });
  });
});

describe("SerialConsoleError codes", () => {
  it("PIPE_CREATE_FAILED code for pipe creation failures", () => {
    const error = new SerialConsoleError("Failed to create pipe", "PIPE_CREATE_FAILED");
    expect(error.code).toBe("PIPE_CREATE_FAILED");
  });

  it("PIPE_CREATE_ERROR code for pipe creation errors with cause", () => {
    const cause = new Error("Permission denied");
    const error = new SerialConsoleError(
      "Failed to create pipe: Permission denied",
      "PIPE_CREATE_ERROR",
      cause
    );
    expect(error.code).toBe("PIPE_CREATE_ERROR");
    expect(error.cause).toBe(cause);
  });

  it("PIPE_REMOVE_FAILED code for pipe removal failures", () => {
    const error = new SerialConsoleError("Failed to remove pipe", "PIPE_REMOVE_FAILED");
    expect(error.code).toBe("PIPE_REMOVE_FAILED");
  });

  it("CONSOLE_INACTIVE code for inactive console operations", () => {
    const error = new SerialConsoleError("Serial console is not active", "CONSOLE_INACTIVE");
    expect(error.code).toBe("CONSOLE_INACTIVE");
  });

  it("CONSOLE_CLOSED code for closed console", () => {
    const error = new SerialConsoleError("Serial console closed", "CONSOLE_CLOSED");
    expect(error.code).toBe("CONSOLE_CLOSED");
  });

  it("WRITE_FAILED code for write failures", () => {
    const error = new SerialConsoleError("Failed to write to serial console", "WRITE_FAILED");
    expect(error.code).toBe("WRITE_FAILED");
  });

  it("error has proper stack trace", () => {
    const error = new SerialConsoleError("Test error", "TEST_CODE");
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("SerialConsoleError");
  });
});

describe("SerialConsole getPaths integration", () => {
  it("getPaths returns consistent values with generatePipePaths", () => {
    const vmId = "test-vm";
    const pipeDir = "/custom/dir";

    // Simulate what a SerialConsole would return
    const expectedPaths = generatePipePaths(vmId, pipeDir);

    // A mock console would return these same paths
    const mockConsole: SerialConsole = {
      write: async () => {},
      onData: () => {},
      close: async () => {},
      isActive: () => true,
      getPaths: () => expectedPaths,
    };

    const paths = mockConsole.getPaths();
    expect(paths.stdin).toBe(expectedPaths.stdin);
    expect(paths.stdout).toBe(expectedPaths.stdout);
  });
});

describe("text encoding in write operations", () => {
  it("TextEncoder converts string to Uint8Array correctly", () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("hello");

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(5);
    expect(bytes[0]).toBe(104); // 'h'
    expect(bytes[1]).toBe(101); // 'e'
    expect(bytes[2]).toBe(108); // 'l'
    expect(bytes[3]).toBe(108); // 'l'
    expect(bytes[4]).toBe(111); // 'o'
  });

  it("TextEncoder handles unicode characters", () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("こんにちは");

    expect(bytes).toBeInstanceOf(Uint8Array);
    // Japanese characters are multi-byte in UTF-8
    expect(bytes.length).toBeGreaterThan(5);
  });

  it("TextEncoder handles escape sequences", () => {
    const encoder = new TextEncoder();
    const resizeMsg = formatResizeMessage(80, 24);
    const bytes = encoder.encode(resizeMsg);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x1b); // ESC character
  });
});
