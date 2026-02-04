/**
 * Simple API Key Authentication Middleware
 *
 * Validates X-API-Key header against configured API key.
 * Much simpler than Better Auth session-based authentication.
 */

import type { MiddlewareHandler } from "hono";
import { config } from "../lib/config";

/**
 * Simple user context for API key auth
 */
export interface ApiKeyUser {
  id: string;
  name: string;
  role: "admin" | "user";
}

/**
 * API Key middleware that validates the X-API-Key header
 */
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = c.req.header("X-API-Key");

    if (!apiKey) {
      return c.json({ error: "Unauthorized - X-API-Key header required" }, 401);
    }

    if (apiKey !== config.apiKey) {
      return c.json({ error: "Unauthorized - invalid API key" }, 401);
    }

    // Set a simple user context for the request
    c.set("user", {
      id: "api-user",
      name: "API User",
      role: "admin",
    } as ApiKeyUser);

    await next();
  };
}

/**
 * Skip auth middleware for development/testing
 * Sets a mock user without validating API key
 */
export function skipAuth(): MiddlewareHandler {
  return async (c, next) => {
    c.set("user", {
      id: "test-user",
      name: "Test User",
      role: "admin",
    } as ApiKeyUser);
    await next();
  };
}
