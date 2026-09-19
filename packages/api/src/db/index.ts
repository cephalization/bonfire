import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { config } from "../lib/config";
import { openDatabase } from "./migrate";

export interface SqliteConnectionHandle {
  exec: (sql: string) => unknown;
  close: () => void;
}

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** Open the application database, creating and migrating it as needed. */
export function createDatabase(dbPath: string = config.dbPath): {
  db: AppDatabase;
  sqlite: SqliteConnectionHandle;
} {
  const sqlite = openDatabase(dbPath);
  const db = drizzle(sqlite, { schema });
  return {
    db: db as AppDatabase,
    sqlite: sqlite as unknown as SqliteConnectionHandle,
  };
}
export { schema };
