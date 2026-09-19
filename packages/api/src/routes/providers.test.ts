import { describe, it, expect } from "vitest";
import { createTestApp } from "../test-utils";
import { providerCredentials } from "../db/schema";

describe("Provider keys", () => {
  it("lists every known provider as unconfigured at first", async () => {
    const { request, organization, cleanup } = await createTestApp();
    try {
      const res = await request(`/api/organizations/${organization.id}/providers`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.map((p: { id: string }) => p.id)).toContain("anthropic");
      expect(body.every((p: { configured: boolean }) => p.configured === false)).toBe(true);
      expect(body[0]).toMatchObject({ keyHint: null, label: null, updatedAt: null });
      expect(body[0].keysUrl).toMatch(/^https:\/\//);
    } finally {
      cleanup();
    }
  });

  it("lets owners set, replace and remove a key without ever returning it", async () => {
    const { request, organization, db, cleanup } = await createTestApp();
    try {
      const put = await request(`/api/organizations/${organization.id}/providers/anthropic`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-ant-api03-abcdefgh1234", label: "team key" }),
      });
      expect(put.status).toBe(200);
      const stored = await put.json();
      expect(stored).toMatchObject({
        id: "anthropic",
        configured: true,
        keyHint: "…1234",
        label: "team key",
      });
      expect(JSON.stringify(stored)).not.toContain("sk-ant");

      // Encrypted at rest.
      const [row] = await db.select().from(providerCredentials);
      expect(row.keyCiphertext).not.toContain("sk-ant");
      expect(row.keyCiphertext.startsWith("v1.")).toBe(true);

      const replaced = await request(`/api/organizations/${organization.id}/providers/anthropic`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-ant-api03-zzzzzzzz9999" }),
      });
      expect((await replaced.json()).keyHint).toBe("…9999");
      expect((await db.select().from(providerCredentials)).length).toBe(1);

      const list = await request(`/api/organizations/${organization.id}/providers`);
      const anthropic = (await list.json()).find((p: { id: string }) => p.id === "anthropic");
      expect(anthropic.configured).toBe(true);

      const del = await request(`/api/organizations/${organization.id}/providers/anthropic`, {
        method: "DELETE",
      });
      expect(del.status).toBe(200);
      expect((await del.json()).configured).toBe(false);

      const again = await request(`/api/organizations/${organization.id}/providers/anthropic`, {
        method: "DELETE",
      });
      expect(again.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it("rejects unknown providers and short keys", async () => {
    const { request, organization, cleanup } = await createTestApp();
    try {
      const unknown = await request(`/api/organizations/${organization.id}/providers/acme`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-long-enough-key" }),
      });
      expect(unknown.status).toBe(400);

      const short = await request(`/api/organizations/${organization.id}/providers/openai`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "abc" }),
      });
      expect(short.status).toBe(400);
      expect((await short.json()).error).toMatch(/too short/);
    } finally {
      cleanup();
    }
  });

  it("lets members see which providers are configured but not change them", async () => {
    const { request, organization, auth, user, signUp, cleanup } = await createTestApp({
      openSignup: true,
    });
    try {
      const member = await signUp({ name: "Member" });
      // Add them to the organization as a plain member.
      const invite = await auth.api.createInvitation({
        headers: new Headers(user.headers),
        body: { email: member.email, role: "member", organizationId: organization.id },
      });
      await auth.api.acceptInvitation({
        headers: new Headers(member.headers),
        body: { invitationId: invite.id },
      });

      const list = await request(`/api/organizations/${organization.id}/providers`, {
        headers: member.headers,
      });
      expect(list.status).toBe(200);

      const put = await request(`/api/organizations/${organization.id}/providers/openai`, {
        method: "PUT",
        headers: { ...member.headers, "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-openai-key-value" }),
      });
      expect(put.status).toBe(403);
      expect((await put.json()).error).toMatch(/admins and owners/);
    } finally {
      cleanup();
    }
  });

  it("answers 403 for non-members", async () => {
    const { request, organization, signUp, cleanup } = await createTestApp({ openSignup: true });
    try {
      const stranger = await signUp({ name: "Stranger" });
      const res = await request(`/api/organizations/${organization.id}/providers`, {
        headers: stranger.headers,
      });
      expect(res.status).toBe(403);
    } finally {
      cleanup();
    }
  });
});
