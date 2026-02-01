/**
 * Better Auth Configuration for CLI
 * 
 * This file exports the auth instance directly for the Better Auth CLI to read.
 * The main app uses createAuth() from auth.ts for lazy initialization.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { config } from "./config";
import * as schema from "../db/schema";

// Create a database connection for the CLI
const dbPath = process.env.DATABASE_URL || "/var/lib/bonfire/bonfire.db";
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: config.betterAuthSecret,
  baseURL: config.baseUrl,
  trustedOrigins: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    config.baseUrl,
  ],
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "member",
        required: true,
      },
    },
  },
});
