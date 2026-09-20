/**
 * Application Configuration
 *
 * Centralized configuration for the API package.
 */

const DEV_AUTH_SECRET = "dev-auth-secret-change-in-production";

const environment = process.env.NODE_ENV || "development";
const port = Number(process.env.PORT) || 3000;

/**
 * Resolve the secret Better Auth uses to sign session cookies and tokens.
 *
 * Booting a production server on the well-known development secret would let
 * anyone forge a session, so that combination is a hard failure rather than a
 * silent default.
 */
function resolveAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    if (environment === "production") {
      throw new Error(
        "BETTER_AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 32"
      );
    }
    return DEV_AUTH_SECRET;
  }

  if (environment === "production" && secret === DEV_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is set to the development default in production. " +
        "Generate a real one with: openssl rand -base64 32"
    );
  }

  return secret;
}

const baseUrl = process.env.BONFIRE_URL || `http://localhost:${port}`;

/**
 * Where the web app is served, for links written to logs (invitations).
 * In production the web app and API share an origin behind nginx.
 */
const webUrl =
  process.env.BONFIRE_WEB_URL || (environment === "production" ? baseUrl : "http://localhost:5173");

/**
 * Origins allowed to make credentialed (cookie) requests to the API.
 *
 * The API's own origin is always trusted. In development the Vite dev server
 * is added so the web app works without configuration.
 */
function resolveTrustedOrigins(): string[] {
  const configured = (process.env.BONFIRE_TRUSTED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origins = new Set<string>([new URL(baseUrl).origin, ...configured]);
  if (environment !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return [...origins];
}

export const config = {
  port,
  dbPath: process.env.DATABASE_URL || process.env.DB_PATH || "./bonfire.db",
  apiVersion: "0.0.1",
  environment,
  baseUrl,
  webUrl,
  authSecret: resolveAuthSecret(),
  trustedOrigins: resolveTrustedOrigins(),
  /**
   * When false (the default), only the first user and people holding a
   * pending invitation can sign up. Set BONFIRE_OPEN_SIGNUP=true to let anyone
   * who can reach the server create an account.
   */
  openSignup: process.env.BONFIRE_OPEN_SIGNUP === "true",
  /**
   * Directory of built web assets the API should serve, relative to its
   * working directory. Set in single-container deployments, where there is no
   * nginx in front; unset in development, where Vite serves the app.
   */
  webRoot: process.env.BONFIRE_WEB_ROOT || undefined,
};
