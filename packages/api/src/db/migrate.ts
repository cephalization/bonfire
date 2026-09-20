/**
 * Database Migration
 *
 * Applies the SQL migrations in `packages/api/drizzle/`, which drizzle-kit
 * generates from `schema.ts` (`pnpm --filter @bonfire/api db:generate`). The
 * same function runs before the server starts and in tests, so there is one
 * definition of the schema.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "../lib/config";

/**
 * Locate the migrations folder from wherever this module runs: `src/db/` in
 * development and tests, `dist/` once bundled.
 */
export function resolveMigrationsFolder(): string {
  if (process.env.BONFIRE_MIGRATIONS_DIR) return process.env.BONFIRE_MIGRATIONS_DIR;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../drizzle"), join(here, "../drizzle"), join(here, "drizzle")];
  const found = candidates.find((dir) => existsSync(join(dir, "meta", "_journal.json")));
  if (!found) {
    throw new Error(
      `Could not find the drizzle migrations folder (looked in ${candidates.join(", ")}). ` +
        "Set BONFIRE_MIGRATIONS_DIR to point at it."
    );
  }
  return found;
}

/**
 * Before September 2026 the schema was created by hand-written SQL that still
 * carried Better Auth tables from an earlier design (a `user` table with a
 * `role` column, no organizations). Those tables have the wrong shape for the
 * current auth and were never reachable through the API, so on a database
 * that predates the migration journal they are dropped before migrating.
 */
function dropLegacyAuthTables(sqlite: Database.Database, log: (message: string) => void): void {
  const hasJournal = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (hasJournal) return;

  const hasLegacyUser = sqlite
    .prepare("SELECT 1 FROM pragma_table_info('user') WHERE name = 'role'")
    .get();
  if (!hasLegacyUser) return;

  log("Dropping auth tables from the pre-organization schema; accounts must be recreated.");
  for (const table of ["session", "account", "verification", "user"]) {
    sqlite.exec(`DROP TABLE IF EXISTS "${table}"`);
  }
}

export interface MigrateOptions {
  log?: (message: string) => void;
}

/** Apply pending migrations to an open connection. */
export function applyMigrations(sqlite: Database.Database, options: MigrateOptions = {}): void {
  const log = options.log ?? (() => {});
  sqlite.pragma("foreign_keys = ON");
  dropLegacyAuthTables(sqlite, log);
  migrate(drizzle(sqlite), { migrationsFolder: resolveMigrationsFolder() });
}

/**
 * Open (creating if needed) the SQLite database at `dbPath` and bring it up
 * to date. The parent directory is created too, so a fresh checkout can start
 * with the default `./bonfire.db` and Docker with `/var/lib/bonfire/bonfire.db`
 * without any manual setup.
 */
export function openDatabase(dbPath: string = config.dbPath): Database.Database {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    applyMigrations(sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return sqlite;
}

/** Open `dbPath`, apply pending migrations and close it. */
export function runMigrations(dbPath: string = config.dbPath): void {
  console.log("🔧 Running database migrations...");
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    applyMigrations(sqlite, { log: (message) => console.log(`   ${message}`) });
    console.log("✅ Database migrations complete");
  } finally {
    sqlite.close();
  }
}
