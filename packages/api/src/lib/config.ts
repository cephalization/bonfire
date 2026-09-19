/**
 * Application Configuration
 *
 * Centralized configuration for the API package.
 */

const DEV_API_KEY = "dev-api-key-change-in-production";

const environment = process.env.NODE_ENV || "development";

/**
 * Resolve the API key.
 *
 * Authentication is currently a single shared key (see CLAUDE.md — replacing
 * this with real per-user auth is the next planned milestone). Until then the
 * one thing we must not do is boot a production server on the well-known dev
 * key, so that combination is a hard failure rather than a silent default.
 */
function resolveApiKey(): string {
  const apiKey = process.env.BONFIRE_API_KEY;

  if (!apiKey) {
    if (environment === "production") {
      throw new Error(
        "BONFIRE_API_KEY must be set in production. Generate one with: openssl rand -base64 32"
      );
    }
    return DEV_API_KEY;
  }

  if (environment === "production" && apiKey === DEV_API_KEY) {
    throw new Error(
      "BONFIRE_API_KEY is set to the development default in production. " +
        "Generate a real one with: openssl rand -base64 32"
    );
  }

  return apiKey;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DATABASE_URL || process.env.DB_PATH || "./bonfire.db",
  apiVersion: "0.0.1",
  environment,
  apiKey: resolveApiKey(),
  baseUrl: process.env.BONFIRE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
};
