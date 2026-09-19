/**
 * Authentication and authorization tests
 *
 * These go through the real Better Auth endpoints mounted at /api/auth and
 * then hit the VM routes as different users, so they cover the whole chain:
 * sign-up rules, sessions, organizations, invitations, API keys and the
 * membership checks in lib/authz.ts.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, type TestApp } from "../test-utils";
import { images, vms } from "../db/schema";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function seedImage(testApp: TestApp, id = "img-1") {
  await testApp.db.insert(images).values({
    id,
    reference: `test:${id}`,
    kernelPath: "/kernel",
    rootfsPath: "/rootfs",
    sizeBytes: 1,
    pulledAt: new Date(),
  });
  return id;
}

async function seedVm(testApp: TestApp, organizationId: string, name: string) {
  const id = `vm-${name}`;
  await testApp.db.insert(vms).values({
    id,
    name,
    status: "creating",
    organizationId,
    imageId: await seedImage(testApp, `img-${name}`),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

describe("authentication", () => {
  let testApp: TestApp;

  afterEach(() => testApp?.cleanup());

  it("rejects unauthenticated requests to protected routes", async () => {
    testApp = await createTestApp();

    for (const path of ["/api/vms", "/api/vms/some-id", "/api/images"]) {
      const res = await testApp.app.request(path);
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  it("serves /health and the OpenAPI document without credentials", async () => {
    testApp = await createTestApp();

    expect((await testApp.app.request("/health")).status).toBe(200);
    expect((await testApp.app.request("/api/openapi.json")).status).toBe(200);
  });

  it("signs in with email and password and returns a session cookie", async () => {
    testApp = await createTestApp();
    const { email, password } = testApp.user;

    const signedIn = await testApp.signIn(email, password);
    expect(signedIn).not.toBeNull();

    const res = await testApp.app.request("/api/auth/get-session", {
      headers: signedIn!.headers,
    });
    const body = await res.json();
    expect(body.user.email).toBe(email);
  });

  it("rejects a wrong password", async () => {
    testApp = await createTestApp();

    expect(await testApp.signIn(testApp.user.email, "not the password")).toBeNull();
  });
});

describe("sign-up policy", () => {
  let testApp: TestApp;

  afterEach(() => testApp?.cleanup());

  it("lets the first user sign up (createTestApp already did) and blocks strangers", async () => {
    testApp = await createTestApp();

    const res = await testApp.app.request(
      "/api/auth/sign-up/email",
      json({ name: "Stranger", email: "stranger@example.com", password: "long enough password" })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/invitation/i);
  });

  it("lets anyone sign up when open sign-up is enabled", async () => {
    testApp = await createTestApp({ openSignup: true });

    await expect(testApp.signUp({ email: "anyone@example.com" })).resolves.toMatchObject({
      email: "anyone@example.com",
    });
  });

  it("lets an invited email sign up", async () => {
    testApp = await createTestApp();

    const invite = await testApp.app.request(
      "/api/auth/organization/invite-member",
      json({ email: "Invited@Example.com", role: "member" }, testApp.user.headers)
    );
    expect(invite.status).toBe(200);

    await expect(testApp.signUp({ email: "invited@example.com" })).resolves.toMatchObject({
      email: "invited@example.com",
    });
  });
});

describe("organization scoping of VMs", () => {
  let testApp: TestApp;

  afterEach(() => testApp?.cleanup());

  it("lists only the VMs of the caller's active organization", async () => {
    testApp = await createTestApp({ openSignup: true });
    const alice = testApp.user;
    const bob = await testApp.signUp({ name: "Bob" });
    const bobOrg = await testApp.createOrganization(bob, "Bob Org");

    await seedVm(testApp, testApp.organization.id, "alice-vm");
    await seedVm(testApp, bobOrg.id, "bob-vm");

    const aliceList = await testApp.request("/api/vms", { headers: alice.headers });
    expect((await aliceList.json()).map((vm: { name: string }) => vm.name)).toEqual(["alice-vm"]);

    const bobList = await testApp.request("/api/vms", { headers: bob.headers });
    expect((await bobList.json()).map((vm: { name: string }) => vm.name)).toEqual(["bob-vm"]);
  });

  it("answers 404 for a VM in an organization the caller is not in", async () => {
    testApp = await createTestApp({ openSignup: true });
    const bob = await testApp.signUp({ name: "Bob" });
    await testApp.createOrganization(bob, "Bob Org");
    const vmId = await seedVm(testApp, testApp.organization.id, "alice-vm");

    for (const [path, method] of [
      [`/api/vms/${vmId}`, "GET"],
      [`/api/vms/${vmId}`, "DELETE"],
      [`/api/vms/${vmId}/start`, "POST"],
      [`/api/vms/${vmId}/stop`, "POST"],
      [`/api/vms/${vmId}/ssh-key`, "GET"],
      [`/api/vms/${vmId}/terminal/ticket`, "POST"],
    ]) {
      const res = await testApp.request(path, { method, headers: bob.headers });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    }

    // The owner still sees it.
    const res = await testApp.request(`/api/vms/${vmId}`);
    expect(res.status).toBe(200);
  });

  it("refuses to list or create in an organization the caller is not a member of", async () => {
    testApp = await createTestApp({ openSignup: true });
    const bob = await testApp.signUp({ name: "Bob" });
    await testApp.createOrganization(bob, "Bob Org");
    const imageId = await seedImage(testApp);

    const list = await testApp.request(`/api/vms?organizationId=${testApp.organization.id}`, {
      headers: bob.headers,
    });
    expect(list.status).toBe(403);

    const create = await testApp.request(
      "/api/vms",
      json({ name: "sneaky", imageId, organizationId: testApp.organization.id }, bob.headers)
    );
    expect(create.status).toBe(403);
  });

  it("requires an organization when the session has none active", async () => {
    testApp = await createTestApp({ openSignup: true });
    const carol = await testApp.signUp({ name: "Carol" });

    const res = await testApp.request("/api/vms", { headers: carol.headers });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/organization/i);
  });

  it("creates VMs in the active organization and records the creator", async () => {
    testApp = await createTestApp();
    const imageId = await seedImage(testApp);

    const res = await testApp.request("/api/vms", json({ name: "new-vm", imageId }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.organizationId).toBe(testApp.organization.id);
    expect(body.createdById).toBe(testApp.user.id);
  });

  it("does not expose VMs that predate organizations", async () => {
    testApp = await createTestApp();
    await testApp.db.insert(vms).values({
      id: "vm-legacy",
      name: "legacy",
      status: "stopped",
      organizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect((await testApp.request("/api/vms/vm-legacy")).status).toBe(404);
    expect(await (await testApp.request("/api/vms")).json()).toEqual([]);
  });
});

describe("invitations", () => {
  let testApp: TestApp;

  afterEach(() => testApp?.cleanup());

  it("lets an invited user join the organization and see its VMs", async () => {
    testApp = await createTestApp();
    const vmId = await seedVm(testApp, testApp.organization.id, "shared-vm");

    // Alice (an owner) invites Bob.
    const invite = await testApp.app.request(
      "/api/auth/organization/invite-member",
      json({ email: "bob@example.com", role: "member" }, testApp.user.headers)
    );
    expect(invite.status).toBe(200);
    const invitation = await invite.json();
    expect(invitation.status).toBe("pending");

    // Bob signs up with that email and accepts.
    const bob = await testApp.signUp({ name: "Bob", email: "bob@example.com" });
    const accept = await testApp.app.request(
      "/api/auth/organization/accept-invitation",
      json({ invitationId: invitation.id }, bob.headers)
    );
    expect(accept.status).toBe(200);

    // Bob is a member now and can see the shared VM.
    const res = await testApp.request(
      `/api/vms/${vmId}?organizationId=${testApp.organization.id}`,
      {
        headers: bob.headers,
      }
    );
    expect(res.status).toBe(200);

    const members = await testApp.app.request(
      `/api/auth/organization/list-members?organizationId=${testApp.organization.id}`,
      { headers: testApp.user.headers }
    );
    const memberEmails = (await members.json()).members.map(
      (m: { user: { email: string } }) => m.user.email
    );
    expect(memberEmails.sort()).toEqual([testApp.user.email, "bob@example.com"].sort());
  });

  it("does not let someone else accept an invitation", async () => {
    testApp = await createTestApp({ openSignup: true });

    const invite = await testApp.app.request(
      "/api/auth/organization/invite-member",
      json({ email: "bob@example.com", role: "member" }, testApp.user.headers)
    );
    const invitation = await invite.json();

    const mallory = await testApp.signUp({ name: "Mallory", email: "mallory@example.com" });
    const accept = await testApp.app.request(
      "/api/auth/organization/accept-invitation",
      json({ invitationId: invitation.id }, mallory.headers)
    );
    expect(accept.status).toBe(403);
  });

  it("does not let a plain member invite", async () => {
    testApp = await createTestApp();
    const invite = await testApp.app.request(
      "/api/auth/organization/invite-member",
      json({ email: "bob@example.com", role: "member" }, testApp.user.headers)
    );
    const invitation = await invite.json();
    const bob = await testApp.signUp({ name: "Bob", email: "bob@example.com" });
    await testApp.app.request(
      "/api/auth/organization/accept-invitation",
      json({ invitationId: invitation.id }, bob.headers)
    );

    const res = await testApp.app.request(
      "/api/auth/organization/invite-member",
      json(
        { email: "eve@example.com", role: "member", organizationId: testApp.organization.id },
        bob.headers
      )
    );
    expect(res.status).toBe(403);
  });
});

describe("API keys", () => {
  let testApp: TestApp;

  afterEach(() => testApp?.cleanup());

  it("authenticates X-API-Key requests as the key's user in the key's organization", async () => {
    testApp = await createTestApp();
    await seedVm(testApp, testApp.organization.id, "keyed-vm");
    const key = await testApp.createApiKey(testApp.user, testApp.organization.id, "cli");

    const res = await testApp.app.request("/api/vms", { headers: { "x-api-key": key } });
    expect(res.status).toBe(200);
    expect((await res.json()).map((vm: { name: string }) => vm.name)).toEqual(["keyed-vm"]);
  });

  it("rejects an unknown key", async () => {
    testApp = await createTestApp();

    const res = await testApp.app.request("/api/vms", { headers: { "x-api-key": "bonfire_nope" } });
    expect(res.status).toBe(401);
  });

  it("re-checks membership for the organization a key claims", async () => {
    testApp = await createTestApp({ openSignup: true });
    const bob = await testApp.signUp({ name: "Bob" });
    await testApp.createOrganization(bob, "Bob Org");

    // Bob mints a key that names Alice's organization.
    const key = await testApp.createApiKey(bob, testApp.organization.id, "sneaky");

    const res = await testApp.app.request("/api/vms", { headers: { "x-api-key": key } });
    expect(res.status).toBe(403);
  });

  it("stops working once deleted", async () => {
    testApp = await createTestApp();
    const key = await testApp.createApiKey(testApp.user, testApp.organization.id, "temp");

    const list = await testApp.app.request("/api/auth/api-key/list", {
      headers: testApp.user.headers,
    });
    const {
      apiKeys: [row],
    } = await list.json();
    const del = await testApp.app.request(
      "/api/auth/api-key/delete",
      json({ keyId: row.id }, testApp.user.headers)
    );
    expect(del.status).toBe(200);

    const res = await testApp.app.request("/api/vms", { headers: { "x-api-key": key } });
    expect(res.status).toBe(401);
  });
});

describe("terminal tickets", () => {
  let testApp: TestApp;

  afterEach(() => testApp?.cleanup());

  it("mints a ticket for a running VM the caller can access", async () => {
    testApp = await createTestApp();
    const vmId = await seedVm(testApp, testApp.organization.id, "term-vm");
    testApp.sqlite.prepare("UPDATE vms SET status = 'running' WHERE id = ?").run(vmId);

    const res = await testApp.request(`/api/vms/${vmId}/terminal/ticket`, { method: "POST" });
    expect(res.status).toBe(200);
    const { ticket } = await res.json();
    expect(typeof ticket).toBe("string");
  });
});
