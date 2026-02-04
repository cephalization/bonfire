/**
 * Application Configuration
 *
 * Centralized configuration for the API package.
 */

export const config = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DATABASE_URL || process.env.DB_PATH || "./bonfire.db",
  apiVersion: "0.0.1",
  environment: process.env.NODE_ENV || "development",
  apiKey: process.env.BONFIRE_API_KEY || "dev-api-key-change-in-production",
  baseUrl: process.env.BONFIRE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
};
