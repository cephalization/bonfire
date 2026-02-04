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
import {
  RealBootstrapService,
  createMockBootstrapService,
  generateOpenCodeConfig,
  serializeOpenCodeConfig,
} from "./bootstrap";

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
        errorMessage: "Bootstrap failed",
      });

      const config = {
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      };

      const result = await mockBootstrap.bootstrap(config);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("Bootstrap failed");
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
    it("should return error when bootstrap is unavailable", async () => {
      const { db, sqlite, dbPath } = await createTestDb();

      const bootstrapService = new RealBootstrapService(db);

      // Insert a VM
      const now = new Date();
      sqlite.exec(`
        INSERT INTO vms (id, name, status, ip_address, pid, socket_path, created_at, updated_at)
        VALUES (
          'vm-123',
          'test-vm',
          'running',
          '192.168.1.1',
          ${process.pid},
          '/tmp/mock-firecracker.sock',
          ${now.getTime()},
          ${now.getTime()}
        )
      `);

      // Insert a session
      sqlite.exec(`
        INSERT INTO agent_sessions (id, user_id, repo_url, status, created_at, updated_at)
        VALUES ('sess-123', 'test-user', 'https://github.com/org/repo', 'creating', ${now.getTime()}, ${now.getTime()})
      `);

      const result = await bootstrapService.bootstrap({
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Bootstrap temporarily unavailable");

      // Verify session was updated to error
      const sessions = sqlite
        .prepare("SELECT * FROM agent_sessions WHERE id = 'sess-123'")
        .all() as { status: string; error_message: string }[];
      expect(sessions[0].status).toBe("error");
      expect(sessions[0].error_message).toContain("Bootstrap temporarily unavailable");

      cleanupTestDb(sqlite, dbPath);
    });

    it("should update session to error when VM is not running", async () => {
      const { db, sqlite, dbPath } = await createTestDb();
      const bootstrapService = new RealBootstrapService(db);

      // Insert a VM that is not running
      const now = new Date();
      sqlite.exec(`
        INSERT INTO vms (id, name, status, ip_address, pid, socket_path, created_at, updated_at)
        VALUES (
          'vm-123',
          'test-vm',
          'stopped',
          '192.168.1.1',
          ${process.pid},
          '/tmp/mock-firecracker.sock',
          ${now.getTime()},
          ${now.getTime()}
        )
      `);

      // Insert a session
      sqlite.exec(`
        INSERT INTO agent_sessions (id, user_id, repo_url, status, created_at, updated_at)
        VALUES ('sess-123', 'test-user', 'https://github.com/org/repo', 'creating', ${now.getTime()}, ${now.getTime()})
      `);

      const result = await bootstrapService.bootstrap({
        sessionId: "sess-123",
        repoUrl: "https://github.com/org/repo",
        vmId: "vm-123",
        vmIp: "192.168.1.1",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("VM is not running");

      // Verify session was updated to error
      const sessions = sqlite
        .prepare("SELECT * FROM agent_sessions WHERE id = 'sess-123'")
        .all() as { status: string; error_message: string }[];
      expect(sessions[0].status).toBe("error");

      cleanupTestDb(sqlite, dbPath);
    });
  });

  describe("OpenCode Config Generation", () => {
    it("should generate config with correct defaults", () => {
      const config = generateOpenCodeConfig("/home/agent/workspaces/sess-123");

      expect(config.share).toBe("disabled");
      expect(config.permission).toBe("allow");
      expect(config.autoupdate).toBe(false);
      expect(config.server.port).toBe(4096);
      expect(config.server.hostname).toBe("0.0.0.0");
    });

    it("should serialize config to JSON string", () => {
      const config = generateOpenCodeConfig("/home/agent/workspaces/sess-123");
      const serialized = serializeOpenCodeConfig(config);

      // Verify it's valid JSON
      const parsed = JSON.parse(serialized);
      expect(parsed.share).toBe("disabled");
      expect(parsed.permission).toBe("allow");
      expect(parsed.autoupdate).toBe(false);
      expect(parsed.server.port).toBe(4096);
      expect(parsed.server.hostname).toBe("0.0.0.0");
    });

    it("should produce consistent serialized output", () => {
      const config1 = generateOpenCodeConfig("/path/1");
      const config2 = generateOpenCodeConfig("/path/2");

      const serialized1 = serializeOpenCodeConfig(config1);
      const serialized2 = serializeOpenCodeConfig(config2);

      // Both should have same structure (workspace path not in config)
      expect(serialized1).toBe(serialized2);
    });
  });
});
