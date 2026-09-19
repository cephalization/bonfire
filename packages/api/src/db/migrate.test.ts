import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations, openDatabase, resolveMigrationsFolder } from "./migrate";

function tableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return sqlite
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table)
    .map((row) => (row as { name: string }).name);
}

describe("applyMigrations", () => {
  it("finds the migrations folder", () => {
    expect(resolveMigrationsFolder()).toMatch(/drizzle$/);
  });

  it("creates the full schema on an empty database", () => {
    const sqlite = new Database(":memory:");
    applyMigrations(sqlite);

    expect(tableNames(sqlite)).toEqual(
      expect.arrayContaining([
        "account",
        "apikey",
        "images",
        "invitation",
        "member",
        "organization",
        "session",
        "user",
        "verification",
        "vms",
      ])
    );
    expect(columnNames(sqlite, "vms")).toEqual(
      expect.arrayContaining(["organization_id", "created_by_id"])
    );
  });

  it("is idempotent", () => {
    const sqlite = new Database(":memory:");
    applyMigrations(sqlite);
    expect(() => applyMigrations(sqlite)).not.toThrow();
  });

  it("upgrades a database created by the old hand-written migration", () => {
    const sqlite = new Database(":memory:");
    // The pre-September-2026 shape: app tables plus stale auth tables.
    sqlite.exec(`
      CREATE TABLE "user" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE, "email_verified" INTEGER DEFAULT 0 NOT NULL,
        "image" TEXT, "role" TEXT DEFAULT 'member' NOT NULL,
        "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL);
      CREATE TABLE "session" ("id" TEXT PRIMARY KEY NOT NULL, "user_id" TEXT NOT NULL,
        "token" TEXT NOT NULL UNIQUE, "expires_at" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL);
      CREATE TABLE "account" ("id" TEXT PRIMARY KEY NOT NULL, "user_id" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL);
      CREATE TABLE "verification" ("id" TEXT PRIMARY KEY NOT NULL, "identifier" TEXT NOT NULL,
        "value" TEXT NOT NULL, "expires_at" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL);
      CREATE TABLE "images" ("id" TEXT PRIMARY KEY NOT NULL, "reference" TEXT NOT NULL UNIQUE,
        "kernel_path" TEXT NOT NULL, "rootfs_path" TEXT NOT NULL, "size_bytes" INTEGER,
        "pulled_at" INTEGER NOT NULL);
      CREATE TABLE "vms" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL UNIQUE,
        "status" TEXT DEFAULT 'creating' NOT NULL, "vcpus" INTEGER DEFAULT 1 NOT NULL,
        "memory_mib" INTEGER DEFAULT 512 NOT NULL, "image_id" TEXT, "pid" INTEGER,
        "socket_path" TEXT, "tap_device" TEXT, "mac_address" TEXT, "ip_address" TEXT,
        "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL,
        FOREIGN KEY ("image_id") REFERENCES "images"("id"));
      INSERT INTO images VALUES ('img', 'ref', '/k', '/r', 1, 1);
      INSERT INTO vms (id, name, image_id, created_at, updated_at) VALUES ('vm', 'kept', 'img', 1, 1);
    `);

    const logs: string[] = [];
    applyMigrations(sqlite, { log: (m) => logs.push(m) });

    expect(logs.join("\n")).toMatch(/pre-organization/);
    expect(columnNames(sqlite, "session")).toContain("active_organization_id");
    expect(columnNames(sqlite, "user")).not.toContain("role");
    expect(columnNames(sqlite, "vms")).toContain("organization_id");
    // Application data survives.
    expect(sqlite.prepare("SELECT name FROM vms").get()).toEqual({ name: "kept" });
  });
});

describe("openDatabase", () => {
  it("creates the directory and the file, and migrates it", () => {
    const root = mkdtempSync(join(tmpdir(), "bonfire-db-"));
    const dbPath = join(root, "nested", "data", "bonfire.db");
    try {
      const sqlite = openDatabase(dbPath);
      try {
        expect(existsSync(dbPath)).toBe(true);
        expect(tableNames(sqlite)).toEqual(
          expect.arrayContaining(["user", "vms", "conversations"])
        );
      } finally {
        sqlite.close();
      }

      // Opening again is a no-op on an up-to-date database.
      const again = openDatabase(dbPath);
      try {
        expect(tableNames(again)).toEqual(expect.arrayContaining(["user", "vms"]));
      } finally {
        again.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
