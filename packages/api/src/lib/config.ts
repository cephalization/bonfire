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
  betterAuthSecret: process.env.BETTER_AUTH_SECRET || "change-me-in-production-32-chars-min",
  baseUrl: process.env.BETTER_AUTH_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  // Initial admin user configuration
  initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL,
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD,
  initialAdminName: process.env.INITIAL_ADMIN_NAME || "Admin",
};
