/**
 * Authorization
 *
 * Everything in Bonfire that is not an image belongs to an organization, and a
 * request may act on an organization only if its principal is a member. These
 * helpers are the one place that rule is written down.
 */

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import type { Principal } from "../middleware/auth";

type Db = BetterSQLite3Database<typeof schema>;

export type OrganizationRole = "owner" | "admin" | "member";

export async function findMembership(
  db: Db,
  userId: string,
  organizationId: string
): Promise<schema.Member | null> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Which organization a request acts in.
 *
 * An explicit `organizationId` (query or body) wins. Otherwise a browser
 * session uses its active organization and an API key uses the organization
 * it was created for. Null means the caller has to pick one.
 */
export function resolveOrganizationId(
  principal: Principal,
  requested?: string | null
): string | null {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  return principal.defaultOrganizationId;
}

export type OrganizationAccess =
  | { ok: true; organizationId: string; membership: schema.Member }
  | { ok: false; status: 400 | 403; error: string };

/** Resolve and check the organization a list/create request acts in. */
export async function requireOrganizationAccess(
  db: Db,
  principal: Principal,
  requested?: string | null
): Promise<OrganizationAccess> {
  const organizationId = resolveOrganizationId(principal, requested);
  if (!organizationId) {
    return {
      ok: false,
      status: 400,
      error:
        "No organization selected. Pass organizationId, set an active organization, or use an API key created for one.",
    };
  }

  const membership = await findMembership(db, principal.user.id, organizationId);
  if (!membership) {
    return { ok: false, status: 403, error: "You are not a member of this organization" };
  }

  return { ok: true, organizationId, membership };
}

/**
 * Load a VM the principal may act on.
 *
 * Returns null both when the VM does not exist and when it belongs to an
 * organization the principal is not in, so callers answer 404 either way and
 * VM ids cannot be probed across organizations.
 */
export async function loadAuthorizedVm(
  db: Db,
  principal: Principal,
  vmId: string
): Promise<schema.VM | null> {
  const [vm] = await db.select().from(schema.vms).where(eq(schema.vms.id, vmId));
  if (!vm || !vm.organizationId) return null;

  const membership = await findMembership(db, principal.user.id, vm.organizationId);
  return membership ? vm : null;
}
