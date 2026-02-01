/**
 * Authentication Middleware
 *
 * Validates Better Auth sessions for protected routes.
 */

import type { MiddlewareHandler } from "hono";
import type { createAuth } from "../lib/auth";

/**
 * User type from Better Auth session
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create auth middleware with the provided auth instance.
 */
export function createAuthMiddleware(auth: ReturnType<typeof createAuth>): MiddlewareHandler {
  return async (c, next) => {
    // For WebSocket connections, cookies may be passed as query parameters
    // since browsers can't set custom headers on WebSocket connections
    const url = new URL(c.req.url);
    const cookieFromQuery = url.searchParams.get("cookie");

    // Build headers for session check
    let headers = c.req.raw.headers;

    if (cookieFromQuery) {
      // Create new headers with cookie from query parameter
      headers = new Headers(headers);
      headers.set("cookie", cookieFromQuery);
    }

    const session = await auth.api.getSession({
      headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized - valid session required" }, 401);
    }

    // Store user info in context for route handlers
    c.set("user", session.user as AuthUser);
    c.set("session", session.session);

    await next();
  };
}

/**
 * Create admin-only middleware that requires the user to have admin role.
 * Must be used after createAuthMiddleware.
 */
export function createAdminMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as AuthUser | undefined;

    if (!user) {
      return c.json({ error: "Unauthorized - authentication required" }, 401);
    }

    if (user.role !== "admin") {
      return c.json({ error: "Forbidden - admin access required" }, 403);
    }

    await next();
  };
}
