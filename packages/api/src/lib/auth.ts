/**
 * Authentication (Better Auth)
 *
 * One Better Auth instance per app, built by `createAuth` so tests can point it
 * at their own database. It provides:
 *
 * - email + password accounts and cookie sessions (`/api/auth/sign-up/email`,
 *   `/api/auth/sign-in/email`, `/api/auth/get-session`, ...)
 * - organizations, memberships and invitations via the organization plugin
 *   (`/api/auth/organization/*`)
 * - per-user API keys via the api-key plugin (`/api/auth/api-key/*`), sent as
 *   the `X-API-Key` header by the CLI and SDK
 *
 * How a request is turned into a principal lives in middleware/auth.ts; how a
 * principal is checked against an organization lives in lib/authz.ts.
 */

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { config } from "./config";

export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (data: { hash: string; password: string }) => Promise<boolean>;
}

export interface CreateAuthOptions {
  db: BetterSQLite3Database<typeof schema>;
  /** Public URL of the API. Cookies are `Secure` when this is https. */
  baseUrl?: string;
  secret?: string;
  trustedOrigins?: string[];
  /** Where the web app lives, for the invitation links written to the log. */
  webUrl?: string;
  /** Let anyone sign up, instead of only the first user and invitees. */
  openSignup?: boolean;
  /** Override the password hasher. Only tests should do this: scrypt is slow. */
  password?: PasswordHasher;
  /** Where invitation links are written, since there is no email service. */
  log?: (message: string) => void;
}

/**
 * Whether `email` may create an account.
 *
 * Bonfire is self-hosted, so an open sign-up form on an exposed instance would
 * let strangers create accounts. Without an email service, the rule is: the
 * first user may sign up, and so may anyone holding a pending invitation.
 */
export async function isSignupAllowed(
  db: BetterSQLite3Database<typeof schema>,
  email: string,
  options: { openSignup?: boolean } = {}
): Promise<boolean> {
  if (options.openSignup) return true;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.user);
  if (Number(count) === 0) return true;

  const now = new Date();
  const pending = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(sql`lower(${schema.invitation.email})`, email.toLowerCase()),
        eq(schema.invitation.status, "pending"),
        or(isNull(schema.invitation.expiresAt), gt(schema.invitation.expiresAt, now))
      )
    )
    .limit(1);

  return pending.length > 0;
}

export function createAuth(options: CreateAuthOptions) {
  const {
    db,
    baseUrl = config.baseUrl,
    secret = config.authSecret,
    trustedOrigins = config.trustedOrigins,
    webUrl = config.webUrl,
    openSignup = config.openSignup,
    log = (message: string) => console.log(message),
  } = options;

  return betterAuth({
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret,
    trustedOrigins,
    // Better Auth skips its CSRF origin check when NODE_ENV=test. Keep it on
    // so the test suite exercises the same rule production does: a cookie
    // authenticated POST to /api/auth must carry a trusted Origin.
    advanced: { disableOriginCheck: false },
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      ...(options.password ? { password: options.password } : {}),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await isSignupAllowed(db, user.email, { openSignup }))) {
              throw new APIError("FORBIDDEN", {
                message:
                  "Sign-ups are by invitation only. Ask an organization admin to invite you.",
              });
            }
          },
        },
      },
    },
    plugins: [
      organization({
        // There is no email service yet. The inviter gets the link back from
        // the invite call and shares it themselves; it is also logged here so
        // an operator can recover it.
        sendInvitationEmail: async (data) => {
          log(
            `[invitation] ${data.inviter.user.email} invited ${data.email} to "${data.organization.name}" ` +
              `as ${data.role}: ${invitationUrl(webUrl, data.id)}`
          );
        },
      }),
      apiKey({
        apiKeyHeaders: "x-api-key",
        defaultPrefix: "bonfire_",
        enableMetadata: true,
        // Keys are used by the CLI in tight loops; Better Auth's default of 10
        // requests a day is for public APIs.
        rateLimit: { enabled: false },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The page in the web app where an invitee lands. */
export function invitationUrl(webUrl: string, invitationId: string): string {
  return `${webUrl.replace(/\/$/, "")}/invitations/${encodeURIComponent(invitationId)}`;
}
