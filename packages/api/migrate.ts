// Run with: pnpm --filter @bonfire/api migrate
/**
 * Database migration script
 * Run this before starting the server to ensure tables exist
 */

import { runMigrations } from "./src/db/migrate";
import { config } from "./src/lib/config";

console.log("🔧 Running database migrations...");
runMigrations(config.dbPath);
console.log("✅ Database migrations complete");
