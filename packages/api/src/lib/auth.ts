/**
 * Better Auth Configuration
 *
 * Authentication setup with email/password using Better Auth.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { config } from "./config";
import * as schema from "../db/schema";

/**
 * Create Better Auth instance with the provided database.
 * This allows for lazy initialization in different contexts (prod, test).
 */
export function createAuth(db: BetterSQLite3Database<typeof schema>) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    secret: config.betterAuthSecret,
    baseURL: config.baseUrl,
    trustedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173", config.baseUrl],
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
}

export type Auth = ReturnType<typeof createAuth>;
