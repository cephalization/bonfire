/**
 * SSH Service Tests
 *
 * Unit tests for the SSH service and mock implementation.
 */

import { describe, it, expect } from "vitest";
import { createMockSSHService } from "./ssh";

describe("SSH Service", () => {
  describe("MockSSHService", () => {
    it("should track connect calls", async () => {
      const mockSSH = createMockSSHService();
      const config = {
        host: "192.168.1.1",
        username: "agent",
        privateKey: "fake-key",
      };

      await mockSSH.connect(config);

      expect(mockSSH.calls.connect).toHaveLength(1);
      expect(mockSSH.calls.connect[0].config).toEqual(config);
    });

    it("should track exec calls", async () => {
      const mockSSH = createMockSSHService();
      const config = { host: "192.168.1.1", username: "agent" };
      const conn = await mockSSH.connect(config);

      await mockSSH.exec(conn, "ls -la");

      expect(mockSSH.calls.exec).toHaveLength(1);
      expect(mockSSH.calls.exec[0].command).toBe("ls -la");
    });

    it("should track disconnect calls", async () => {
      const mockSSH = createMockSSHService();
      const config = { host: "192.168.1.1", username: "agent" };
      const conn = await mockSSH.connect(config);

      await mockSSH.disconnect(conn);

      expect(mockSSH.calls.disconnect).toHaveLength(1);
      expect(conn.isConnected).toBe(false);
    });

    it("should track testConnection calls", async () => {
      const mockSSH = createMockSSHService();
      const config = { host: "192.168.1.1", username: "agent" };

      await mockSSH.testConnection(config, 5000);

      expect(mockSSH.calls.testConnection).toHaveLength(1);
      expect(mockSSH.calls.testConnection[0].config).toEqual(config);
      expect(mockSSH.calls.testConnection[0].timeoutMs).toBe(5000);
    });

    it("should return success by default for exec", async () => {
      const mockSSH = createMockSSHService();
      const config = { host: "192.168.1.1", username: "agent" };
      const conn = await mockSSH.connect(config);

      const result = await mockSSH.exec(conn, "some-command");

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });

    it("should allow setting command responses", async () => {
      const mockSSH = createMockSSHService();
      mockSSH.setCommandResponse(/git clone/, {
        stdout: "Cloning into 'repo'...",
        stderr: "",
        code: 0,
      });
      mockSSH.setCommandResponse(/error/, {
        stdout: "",
        stderr: "Something went wrong",
        code: 1,
      });

      const config = { host: "192.168.1.1", username: "agent" };
      const conn = await mockSSH.connect(config);

      const cloneResult = await mockSSH.exec(conn, "git clone https://github.com/org/repo");
      expect(cloneResult.stdout).toBe("Cloning into 'repo'...");
      expect(cloneResult.code).toBe(0);

      const errorResult = await mockSSH.exec(conn, "some error command");
      expect(errorResult.stderr).toBe("Something went wrong");
      expect(errorResult.code).toBe(1);
    });

    it("should allow setting connection failure", async () => {
      const mockSSH = createMockSSHService();
      mockSSH.setConnectionResult(false);

      const config = { host: "192.168.1.1", username: "agent" };

      await expect(mockSSH.connect(config)).rejects.toThrow("Connection failed");
      expect(await mockSSH.testConnection(config)).toBe(false);
    });

    it("should clear calls", async () => {
      const mockSSH = createMockSSHService();
      const config = { host: "192.168.1.1", username: "agent" };

      await mockSSH.connect(config);
      await mockSSH.testConnection(config);

      mockSSH.clearCalls();

      expect(mockSSH.calls.connect).toHaveLength(0);
      expect(mockSSH.calls.testConnection).toHaveLength(0);
    });
  });
});
