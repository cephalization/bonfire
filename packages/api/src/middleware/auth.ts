/**
 * Authentication Middleware
 *
 * Turns a request into a `Principal` or answers 401. Two credentials are
 * accepted:
 *
 * - the Better Auth session cookie, which the web app gets from
 *   `/api/auth/sign-in/email`
 * - an `X-API-Key` header holding a key minted at `/api/auth/api-key/create`,
 *   which is what the CLI and SDK send
 *
 * The middleware only answers "who is this?". "May they touch this
 * organization?" is lib/authz.ts.
 */

import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import type { Auth } from "../lib/auth";

export interface Principal {
  user: { id: string; name: string; email: string };
  via: "session" | "api-key";
  /** Organization used when a request does not name one. */
  defaultOrganizationId: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    principal: Principal;
  }
}

export interface AuthMiddlewareConfig {
  auth: Auth;
  db: BetterSQLite3Database<typeof schema>;
}

function organizationIdFromMetadata(metadata: unknown): string | null {
  let parsed = metadata;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (parsed && typeof parsed === "object" && "organizationId" in parsed) {
    const value = (parsed as { organizationId?: unknown }).organizationId;
    return typeof value === "string" && value ? value : null;
  }
  return null;
}

/**
 * Resolve the principal for a set of request headers, or null.
 *
 * Shared by the HTTP middleware and the terminal WebSocket upgrade, which is
 * not a Hono request.
 */
export async function resolvePrincipal(
  { auth, db }: AuthMiddlewareConfig,
  headers: Headers
): Promise<Principal | null> {
  const key = headers.get("x-api-key");
  if (key) {
    const result = await auth.api.verifyApiKey({ body: { key } });
    if (!result.valid || !result.key) return null;

    const [user] = await db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, result.key.referenceId));
    if (!user) return null;

    return {
      user,
      via: "api-key",
      defaultOrganizationId: organizationIdFromMetadata(result.key.metadata),
    };
  }

  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    via: "session",
    defaultOrganizationId: session.session.activeOrganizationId ?? null,
  };
}

export function createAuthMiddleware(config: AuthMiddlewareConfig): MiddlewareHandler {
  return async (c, next) => {
    const principal = await resolvePrincipal(config, c.req.raw.headers);
    if (!principal) {
      return c.json({ error: "Unauthorized - sign in or send a valid X-API-Key header" }, 401);
    }
    c.set("principal", principal);
    await next();
  };
}
