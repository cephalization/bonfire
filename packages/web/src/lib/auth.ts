/**
 * Authentication client (Better Auth)
 *
 * Talks to the API's `/api/auth/*` routes. Sessions are cookies, so every
 * request to the API must be sent with credentials; see lib/api.ts.
 *
 * Organizations, memberships, invitations and API keys are all Better Auth
 * plugins, so they are reached through this client too:
 * `authClient.organization.*` and `authClient.apiKey.*`.
 */

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

/**
 * Get the base URL for the API
 */
export function getBaseURL(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  // Same origin: the Vite dev server and nginx both proxy /api to the API.
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  basePath: "/api/auth",
  plugins: [organizationClient(), apiKeyClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;

export type Session = NonNullable<ReturnType<typeof useSession>["data"]>;
export type SessionUser = Session["user"];

/** Roles the organization plugin ships with. */
export type OrganizationRole = "owner" | "admin" | "member";

export function canManageOrganization(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

/** Where an invitee lands. Shared with the invite UI so the copied link matches. */
export function invitationLink(invitationId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invitations/${encodeURIComponent(invitationId)}`;
}

/**
 * Turn a Better Auth client error into something a form can show.
 */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
