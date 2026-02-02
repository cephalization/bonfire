/**
 * Production migration entrypoint.
 *
 * This file is compiled into packages/api/dist/migrate.js and is used by the
 * API container entrypoint to ensure the SQLite schema exists before starting
 * the server.
 */

import { runMigrations } from "./db/migrate";
import { config } from "./lib/config";

runMigrations(config.dbPath);
