import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_URL || "/var/lib/bonfire/bonfire.db";

export interface SqliteConnectionHandle {
  exec: (sql: string) => unknown;
  close: () => void;
}

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbPath: string = DB_PATH): {
  db: AppDatabase;
  sqlite: SqliteConnectionHandle;
} {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  return {
    db: db as AppDatabase,
    sqlite: sqlite as unknown as SqliteConnectionHandle,
  };
}
export { schema };
