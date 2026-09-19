/**
 * Provider API keys (per organization)
 *
 * - GET    /api/organizations/:organizationId/providers              - which providers have a key
 * - PUT    /api/organizations/:organizationId/providers/:providerId  - set or replace a key (admin/owner)
 * - DELETE /api/organizations/:organizationId/providers/:providerId  - remove a key (admin/owner)
 *
 * Keys are stored encrypted (lib/secrets.ts) and never returned; the response
 * carries a hint (the last characters) so admins can tell keys apart. They are
 * written into a VM's opencode configuration when an agent is attached to a
 * conversation (services/agent/provisioner.ts).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { requireOrganizationAccess } from "../lib/authz";
import { validationHook } from "../lib/openapi";
import { PROVIDERS, PROVIDER_IDS, findProvider } from "../lib/providers";
import { secretHint, type SecretBox } from "../lib/secrets";

const ErrorResponseSchema = z.object({ error: z.string() });

const ProviderSchema = z
  .object({
    id: z.string().openapi({ example: "anthropic" }),
    name: z.string().openapi({ example: "Anthropic" }),
    keysUrl: z.string().openapi({ description: "Where to create a key for this provider" }),
    configured: z.boolean(),
    keyHint: z.string().nullable().openapi({ example: "…a1b2" }),
    label: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .openapi("Provider");

const OrganizationParamsSchema = z.object({
  organizationId: z.string().openapi({ description: "Organization ID" }),
});

const ProviderParamsSchema = OrganizationParamsSchema.extend({
  providerId: z.enum(PROVIDER_IDS as [string, ...string[]]).openapi({ example: "anthropic" }),
});

export const SetProviderKeySchema = z.object({
  apiKey: z.string().trim().min(8, "API key looks too short").max(4096),
  label: z.string().trim().max(120).optional(),
});

const listProvidersRoute = createRoute({
  method: "get",
  path: "/organizations/{organizationId}/providers",
  tags: ["Providers"],
  summary: "List LLM providers and whether the organization has a key for each",
  request: { params: OrganizationParamsSchema },
  responses: {
    200: {
      description: "Providers",
      content: { "application/json": { schema: z.array(ProviderSchema) } },
    },
    403: {
      description: "Not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const setProviderKeyRoute = createRoute({
  method: "put",
  path: "/organizations/{organizationId}/providers/{providerId}",
  tags: ["Providers"],
  summary: "Set the organization's API key for a provider (admins and owners)",
  request: {
    params: ProviderParamsSchema,
    body: { content: { "application/json": { schema: SetProviderKeySchema } } },
  },
  responses: {
    200: {
      description: "Key stored",
      content: { "application/json": { schema: ProviderSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Not allowed",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const deleteProviderKeyRoute = createRoute({
  method: "delete",
  path: "/organizations/{organizationId}/providers/{providerId}",
  tags: ["Providers"],
  summary: "Remove the organization's API key for a provider (admins and owners)",
  request: { params: ProviderParamsSchema },
  responses: {
    200: {
      description: "Key removed",
      content: { "application/json": { schema: ProviderSchema } },
    },
    403: {
      description: "Not allowed",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "No key for this provider",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export interface ProvidersRouterConfig {
  db: BetterSQLite3Database<typeof schema>;
  secrets: SecretBox;
}

export function canManageProviders(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function createProvidersRouter(config: ProvidersRouterConfig) {
  const { db, secrets } = config;
  const app = new OpenAPIHono({ defaultHook: validationHook });

  function serialize(
    provider: (typeof PROVIDERS)[number],
    credential: schema.ProviderCredential | undefined
  ) {
    return {
      id: provider.id,
      name: provider.name,
      keysUrl: provider.keysUrl,
      configured: Boolean(credential),
      keyHint: credential?.keyHint ?? null,
      label: credential?.label ?? null,
      updatedAt: credential ? new Date(credential.updatedAt).toISOString() : null,
    };
  }

  async function loadCredential(organizationId: string, providerId: string) {
    const [row] = await db
      .select()
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.organizationId, organizationId),
          eq(schema.providerCredentials.providerId, providerId)
        )
      );
    return row;
  }

  app.openapi(listProvidersRoute, async (c) => {
    const { organizationId } = c.req.valid("param");
    const access = await requireOrganizationAccess(db, c.get("principal"), organizationId);
    if (!access.ok) return c.json({ error: access.error }, 403);

    const rows = await db
      .select()
      .from(schema.providerCredentials)
      .where(eq(schema.providerCredentials.organizationId, organizationId));
    const byProvider = new Map(rows.map((r) => [r.providerId, r]));
    return c.json(
      PROVIDERS.map((p) => serialize(p, byProvider.get(p.id))),
      200
    );
  });

  app.openapi(setProviderKeyRoute, async (c) => {
    const { organizationId, providerId } = c.req.valid("param");
    const parsed = SetProviderKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
    }
    const principal = c.get("principal");
    const access = await requireOrganizationAccess(db, principal, organizationId);
    if (!access.ok) return c.json({ error: access.error }, 403);
    if (!canManageProviders(access.membership.role)) {
      return c.json({ error: "Only organization admins and owners can manage provider keys" }, 403);
    }
    const provider = findProvider(providerId)!;

    const now = new Date();
    const values = {
      keyCiphertext: secrets.encrypt(parsed.data.apiKey),
      keyHint: secretHint(parsed.data.apiKey),
      label: parsed.data.label || null,
      createdById: principal.user.id,
      updatedAt: now,
    };
    const existing = await loadCredential(organizationId, providerId);
    const [row] = existing
      ? await db
          .update(schema.providerCredentials)
          .set(values)
          .where(eq(schema.providerCredentials.id, existing.id))
          .returning()
      : await db
          .insert(schema.providerCredentials)
          .values({ id: randomUUID(), organizationId, providerId, createdAt: now, ...values })
          .returning();

    return c.json(serialize(provider, row), 200);
  });

  app.openapi(deleteProviderKeyRoute, async (c) => {
    const { organizationId, providerId } = c.req.valid("param");
    const access = await requireOrganizationAccess(db, c.get("principal"), organizationId);
    if (!access.ok) return c.json({ error: access.error }, 403);
    if (!canManageProviders(access.membership.role)) {
      return c.json({ error: "Only organization admins and owners can manage provider keys" }, 403);
    }
    const existing = await loadCredential(organizationId, providerId);
    if (!existing) return c.json({ error: "No key is configured for this provider" }, 404);

    await db
      .delete(schema.providerCredentials)
      .where(eq(schema.providerCredentials.id, existing.id));
    return c.json(serialize(findProvider(providerId)!, undefined), 200);
  });

  return app;
}
