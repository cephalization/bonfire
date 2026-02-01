/**
 * Bootstrap Service Tests
 *
 * Unit tests for the bootstrap service and mock implementation.
 */

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import * as schema from "../db/schema";
import { createMockSSHService } from "./ssh";
import { RealBootstrapService, createMockBootstrapService } from "./bootstrap";

// Migration SQL from drizzle/0000_brave_maestro.sql + Better Auth tables
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS \`user\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`email\` text NOT NULL,
  \`email_verified\` integer DEFAULT false NOT NULL,
  \`image\` text,
  \`role\` text DEFAULT 'member' NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS \`user_email_unique\` ON \`user\` (\`email\`);

CREATE TABLE IF NOT EXISTS \`images\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`reference\` text NOT NULL,
  \`kernel_path\` text NOT NULL,
  \`rootfs_path\` text NOT NULL,
  \`size_bytes\` integer,
  \`pulled_at\` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS \`images_reference_unique\` ON \`images\` (\`reference\`);

CREATE TABLE IF NOT EXISTS \`vms\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`status\` text DEFAULT 'creating' NOT NULL,
  \`vcpus\` integer DEFAULT 1 NOT NULL,
  \`memory_mib\` integer DEFAULT 512 NOT NULL,
  \`image_id\` text,
  \`pid\` integer,
  \`socket_path\` text,
  \`tap_device\` text,
  \`mac_address\` text,
  \`ip_address\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS \`vms_name_unique\` ON \`vms\` (\`name\`);

CREATE TABLE IF NOT EXISTS \`agent_sessions\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`title\` text,
  \`repo_url\` text NOT NULL,
  \`branch\` text,
  \`vm_id\` text,
  \`workspace_path\` text,
  \`status\` text DEFAULT 'creating' NOT NULL,
  \`error_message\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (\`vm_id\`) REFERENCES \`vms\`(\`id\`) ON UPDATE no action ON DELETE no action
);
`;

async function createTestDb() {
  const dbPath = `/tmp/bonfire-bootstrap-test-${randomUUID()}.db`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  sqlite.exec(MIGRATION_SQL);

  // Insert a test user
  const now = new Date();
  sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
    VALUES ('test-user', 'Test User', 'test@example.com', 1, 'member', ${now.getTime()}, ${now.getTime()})
  `);

  return { db, sqlite, dbPath };
}

function cleanupTestDb(sqlite: Database.Database, dbPath: string) {
  try {
    sqlite.close();
    unlinkSync(dbPath);
  } catch {
    // Ignore cleanup errors
  }
}

describe("Bootstrap Service", () => {
  describe("MockBootstrapService", () => {
    it("should track bootstrap calls", async () => {
      const mockBootstrap = createMockBootstrapService();
      const config = {
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      };

      await mockBootstrap.bootstrap(config);

      expect(mockBootstrap.calls.bootstrap).toHaveLength(1);
      expect(mockBootstrap.calls.bootstrap[0].config).toEqual(config);
    });

    it("should track waitForSSH calls", async () => {
      const mockBootstrap = createMockBootstrapService();
      const config = { host: "192.168.1.1", username: "agent" };

      await mockBootstrap.waitForSSH(config, 5000, 100);

      expect(mockBootstrap.calls.waitForSSH).toHaveLength(1);
      expect(mockBootstrap.calls.waitForSSH[0].config).toEqual(config);
      expect(mockBootstrap.calls.waitForSSH[0].timeoutMs).toBe(5000);
      expect(mockBootstrap.calls.waitForSSH[0].intervalMs).toBe(100);
    });

    it("should track pollHealthEndpoint calls", async () => {
      const mockBootstrap = createMockBootstrapService();

      await mockBootstrap.pollHealthEndpoint("192.168.1.1", 4096, 30000, 1000);

      expect(mockBootstrap.calls.pollHealthEndpoint).toHaveLength(1);
      expect(mockBootstrap.calls.pollHealthEndpoint[0].vmIp).toBe("192.168.1.1");
      expect(mockBootstrap.calls.pollHealthEndpoint[0].port).toBe(4096);
      expect(mockBootstrap.calls.pollHealthEndpoint[0].timeoutMs).toBe(30000);
      expect(mockBootstrap.calls.pollHealthEndpoint[0].intervalMs).toBe(1000);
    });

    it("should return success by default", async () => {
      const mockBootstrap = createMockBootstrapService();
      const config = {
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      };

      const result = await mockBootstrap.bootstrap(config);

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe("/mock/workspace");
    });

    it("should allow setting bootstrap result", async () => {
      const mockBootstrap = createMockBootstrapService();
      mockBootstrap.setBootstrapResult({
        success: false,
        errorMessage: "SSH connection failed",
      });

      const config = {
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      };

      const result = await mockBootstrap.bootstrap(config);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("SSH connection failed");
    });

    it("should allow setting SSH availability", async () => {
      const mockBootstrap = createMockBootstrapService();
      mockBootstrap.setSSHAvailable(false);

      const config = { host: "192.168.1.1", username: "agent" };
      const result = await mockBootstrap.waitForSSH(config, 5000, 100);

      expect(result).toBe(false);
    });

    it("should allow setting health readiness", async () => {
      const mockBootstrap = createMockBootstrapService();
      mockBootstrap.setHealthReady(false);

      const result = await mockBootstrap.pollHealthEndpoint("192.168.1.1");

      expect(result).toBe(false);
    });

    it("should clear calls", async () => {
      const mockBootstrap = createMockBootstrapService();

      await mockBootstrap.bootstrap({
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      });

      mockBootstrap.clearCalls();

      expect(mockBootstrap.calls.bootstrap).toHaveLength(0);
    });
  });

  describe("RealBootstrapService", () => {
    it("should update session with workspace path on success", async () => {
      const { db, sqlite, dbPath } = await createTestDb();
      const mockSSH = createMockSSHService();
      const bootstrapService = new RealBootstrapService(db, mockSSH);

      // Insert a VM
      const now = new Date();
      sqlite.exec(`
        INSERT INTO vms (id, name, status, ip_address, created_at, updated_at)
        VALUES ('vm-123', 'test-vm', 'running', '192.168.1.1', ${now.getTime()}, ${now.getTime()})
      `);

      // Insert a session
      sqlite.exec(`
        INSERT INTO agent_sessions (id, user_id, repo_url, status, created_at, updated_at)
        VALUES ('sess-123', 'test-user', 'https://github.com/org/repo', 'creating', ${now.getTime()}, ${now.getTime()})
      `);

      // Configure mock SSH to return success
      mockSSH.setCommandResponse(/mkdir/, { stdout: "", stderr: "", code: 0 });
      mockSSH.setCommandResponse(/git clone/, { stdout: "Cloning...", stderr: "", code: 0 });
      mockSSH.setCommandResponse(/systemctl/, { stdout: "", stderr: "", code: 0 });

      // Override pollHealthEndpoint to return true immediately
      bootstrapService.pollHealthEndpoint = async () => true;

      const result = await bootstrapService.bootstrap({
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      });

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe("/home/agent/workspaces/sess-123");

      // Verify session was updated
      const sessions = sqlite
        .prepare("SELECT * FROM agent_sessions WHERE id = 'sess-123'")
        .all() as { workspace_path: string; vm_id: string }[];
      expect(sessions[0].workspace_path).toBe("/home/agent/workspaces/sess-123");
      expect(sessions[0].vm_id).toBe("vm-123");

      cleanupTestDb(sqlite, dbPath);
    });

    it("should update session to error on failure", async () => {
      const { db, sqlite, dbPath } = await createTestDb();
      const mockSSH = createMockSSHService();
      const bootstrapService = new RealBootstrapService(db, mockSSH);

      // Insert a VM
      const now = new Date();
      sqlite.exec(`
        INSERT INTO vms (id, name, status, ip_address, created_at, updated_at)
        VALUES ('vm-123', 'test-vm', 'running', '192.168.1.1', ${now.getTime()}, ${now.getTime()})
      `);

      // Insert a session
      sqlite.exec(`
        INSERT INTO agent_sessions (id, user_id, repo_url, status, created_at, updated_at)
        VALUES ('sess-123', 'test-user', 'https://github.com/org/repo', 'creating', ${now.getTime()}, ${now.getTime()})
      `);

      // Configure mock SSH to fail on git clone
      mockSSH.setCommandResponse(/git clone/, {
        stdout: "",
        stderr: "Failed to clone: repository not found",
        code: 128,
      });

      const result = await bootstrapService.bootstrap({
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Failed to clone repository");

      // Verify session was updated to error
      const sessions = sqlite
        .prepare("SELECT * FROM agent_sessions WHERE id = 'sess-123'")
        .all() as { status: string; error_message: string }[];
      expect(sessions[0].status).toBe("error");
      expect(sessions[0].error_message).toContain("Failed to clone repository");

      cleanupTestDb(sqlite, dbPath);
    });

    it("should execute correct SSH commands", async () => {
      const { db, sqlite, dbPath } = await createTestDb();
      const mockSSH = createMockSSHService();
      const bootstrapService = new RealBootstrapService(db, mockSSH);

      // Insert a VM
      const now = new Date();
      sqlite.exec(`
        INSERT INTO vms (id, name, status, ip_address, created_at, updated_at)
        VALUES ('vm-123', 'test-vm', 'running', '192.168.1.1', ${now.getTime()}, ${now.getTime()})
      `);

      // Insert a session with branch
      sqlite.exec(`
        INSERT INTO agent_sessions (id, user_id, repo_url, branch, status, created_at, updated_at)
        VALUES ('sess-123', 'test-user', 'https://github.com/org/repo', 'develop', 'creating', ${now.getTime()}, ${now.getTime()})
      `);

      // Override pollHealthEndpoint
      bootstrapService.pollHealthEndpoint = async () => true;

      await bootstrapService.bootstrap({
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        branch: "develop",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      });

      // Verify SSH commands were executed
      const mkdirCall = mockSSH.calls.exec.find((call) => call.command.includes("mkdir"));
      expect(mkdirCall).toBeDefined();
      expect(mkdirCall!.command).toBe("mkdir -p /home/agent/workspaces/sess-123");

      const cloneCall = mockSSH.calls.exec.find((call) => call.command.includes("git clone"));
      expect(cloneCall).toBeDefined();
      expect(cloneCall!.command).toBe(
        "git clone https://github.com/org/repo /home/agent/workspaces/sess-123"
      );

      const checkoutCall = mockSSH.calls.exec.find((call) => call.command.includes("checkout"));
      expect(checkoutCall).toBeDefined();
      expect(checkoutCall!.command).toBe("git -C /home/agent/workspaces/sess-123 checkout develop");

      const systemctlCall = mockSSH.calls.exec.find((call) => call.command.includes("systemctl"));
      expect(systemctlCall).toBeDefined();
      expect(systemctlCall!.command).toBe("systemctl --user start opencode@sess-123");

      cleanupTestDb(sqlite, dbPath);
    });
  });
});
