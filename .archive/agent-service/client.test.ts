/**
 * Agent Client Unit Tests
 *
 * Tests for the Agent HTTP client using mocked fetch.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  AgentClient,
  createAgentClient,
  AgentError,
  AgentTimeoutError,
  AgentConnectionError,
} from "./client";

// Store original fetch
const originalFetch = global.fetch;

describe("AgentClient", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() => {});
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("creates client with default port 8080", () => {
      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      expect(client).toBeDefined();
    });

    it("creates client with custom port", () => {
      const client = new AgentClient({ ipAddress: "10.0.100.2", port: 9000 });
      expect(client).toBeDefined();
    });

    it("creates client with custom timeout", () => {
      const client = new AgentClient({ ipAddress: "10.0.100.2", timeoutMs: 5000 });
      expect(client).toBeDefined();
    });
  });

  describe("checkHealth", () => {
    it("returns true when agent responds with 200", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.checkHealth();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe("http://10.0.100.2:8080/health");
    });

    it("returns false when agent responds with non-200", async () => {
      mockFetch.mockResolvedValue({
        status: 503,
        ok: false,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.checkHealth();

      expect(result).toBe(false);
    });

    it("returns false on connection error", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.checkHealth();

      expect(result).toBe(false);
    });
  });

  describe("exec", () => {
    it("executes command and returns result", async () => {
      const execResponse = JSON.stringify({
        stdout: "hello world\n",
        stderr: "",
        exit_code: 0,
      });

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => execResponse,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.exec("echo", ["hello", "world"]);

      expect(result.stdout).toBe("hello world\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);

      // Verify URL contains command and args
      const call = mockFetch.mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain("/exec");
      expect(url).toContain("cmd=echo");
      expect(url).toContain("args=hello");
      expect(url).toContain("args=world");
    });

    it("handles command with no args", async () => {
      const execResponse = JSON.stringify({
        stdout: "result",
        stderr: "",
        exit_code: 0,
      });

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => execResponse,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.exec("pwd");

      expect(result.stdout).toBe("result");
      const call = mockFetch.mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain("cmd=pwd");
    });

    it("throws AgentError on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.exec("ls");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentError);
        expect((error as AgentError).message).toContain("Exec failed");
      }
    });

    it("handles stderr output", async () => {
      const execResponse = [
        JSON.stringify({ stdout: "", stderr: "error msg\n", exit_code: 0 }),
        JSON.stringify({ stdout: "", stderr: "", exit_code: 1 }),
      ].join("\n");

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => execResponse,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.exec("test");

      expect(result.stderr).toBe("error msg\n");
      expect(result.exitCode).toBe(1);
    });

    it("throws on error in response", async () => {
      const execResponse = JSON.stringify({
        error: "Command not found",
        exit_code: 1,
      });

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => execResponse,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.exec("nonexistent");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentError);
        expect((error as AgentError).message).toContain("Command not found");
      }
    });
  });

  describe("upload", () => {
    it("uploads file successfully", async () => {
      // Create a temporary file for testing
      const tmpDir = "/tmp/agent-test-" + Date.now();
      await Bun.write(`${tmpDir}/testfile.txt`, "test content");

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      await client.upload(`${tmpDir}/testfile.txt`, "/tmp/remote.txt");

      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain("/cp");
      expect(url).toContain("path=%2Ftmp%2Fremote.txt");
      expect(url).toContain("mode=binary");

      // Cleanup
      await Bun.file(`${tmpDir}/testfile.txt`).delete();
    });

    it("throws when local file does not exist", async () => {
      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.upload("/nonexistent/file.txt", "/tmp/remote.txt");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentError);
        expect((error as AgentError).message).toContain("not found");
      }
    });

    it("throws on HTTP error", async () => {
      // Create a temporary file
      const tmpFile = `/tmp/agent-upload-test-${Date.now()}.txt`;
      await Bun.write(tmpFile, "content");

      mockFetch.mockResolvedValue({
        status: 403,
        ok: false,
        statusText: "Forbidden",
        text: async () => "Permission denied",
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.upload(tmpFile, "/root/protected.txt");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentError);
        expect((error as AgentError).message).toContain("Upload failed");
      } finally {
        await Bun.file(tmpFile)
          .delete()
          .catch(() => {});
      }
    });
  });

  describe("download", () => {
    it("downloads file successfully", async () => {
      const fileContent = new Uint8Array([1, 2, 3, 4, 5]);

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        arrayBuffer: async () => fileContent.buffer,
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });
      const result = await client.download("/tmp/file.bin");

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(5);

      const call = mockFetch.mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain("/cp");
      expect(url).toContain("path=%2Ftmp%2Ffile.bin");
    });

    it("throws on 404", async () => {
      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
        statusText: "Not Found",
        text: async () => "File not found",
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.download("/nonexistent.txt");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentError);
        expect((error as AgentError).message).toContain("not found");
      }
    });

    it("throws on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      } as Response);

      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.download("/some/file.txt");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentError);
        expect((error as AgentError).message).toContain("Download failed");
      }
    });
  });

  describe("error handling", () => {
    it("throws AgentConnectionError on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const client = new AgentClient({ ipAddress: "10.0.100.2" });

      try {
        await client.exec("ls");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AgentConnectionError);
        expect((error as AgentConnectionError).message).toContain("Failed to connect");
      }
    });
  });

  describe("createAgentClient factory", () => {
    it("creates client with correct IP", () => {
      const client = createAgentClient("10.0.100.5");
      expect(client).toBeInstanceOf(AgentClient);
    });

    it("passes through options", () => {
      const client = createAgentClient("10.0.100.5", { port: 9000, timeoutMs: 10000 });
      expect(client).toBeInstanceOf(AgentClient);
    });
  });
});
