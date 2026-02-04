/**
 * Database Seeding
 *
 * Placeholder for database seeding functionality.
 * With API key authentication, no user accounts are needed.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";

/**
 * Seed function - no-op with API key authentication
 * User accounts are not needed when using API keys.
 */
export async function seedInitialAdmin(_db: BetterSQLite3Database<typeof schema>): Promise<void> {
  // With API key authentication, no user seeding is required
  // All requests are authenticated via X-API-Key header
}
