/**
 * Conversations: org scoping, messages, the event stream, and the agent
 * bridge driven through the fake opencode client from services/agent/opencode.ts.
 */

import { describe, it, expect } from "vitest";
import { createTestApp, type TestApp, type TestPrincipal } from "../test-utils";
import { vms } from "../db/schema";

const json = { "content-type": "application/json" };

async function waitFor<T>(
  probe: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs = 2_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (true) {
    last = await probe();
    if (ok(last)) return last;
    if (Date.now() > deadline) return last;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Read SSE frames until one matches, or the stream ends. */
async function readEvents(
  res: Response,
  until: (event: { event: string; data: any }) => boolean
): Promise<Array<{ event: string; data: any }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: any }> = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = frame.split("\n");
      const event =
        lines
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim() ?? "message";
      const data = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      const parsed = { event, data: data ? JSON.parse(data) : null };
      events.push(parsed);
      if (until(parsed)) {
        await reader.cancel();
        return events;
      }
    }
  }
  return events;
}

async function createConversation(app: TestApp, title = "Planning", who?: TestPrincipal) {
  const res = await app.request("/api/conversations", {
    method: "POST",
    headers: { ...(who?.headers ?? {}), ...json },
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function addMember(app: TestApp, who: TestPrincipal, role: "member" | "admin" = "member") {
  const invite = await app.auth.api.createInvitation({
    headers: new Headers(app.user.headers),
    body: { email: who.email, role, organizationId: app.organization.id },
  });
  await app.auth.api.acceptInvitation({
    headers: new Headers(who.headers),
    body: { invitationId: invite.id },
  });
}

async function insertRunningVm(app: TestApp, id = "vm-agent-1") {
  const now = new Date();
  await app.db.insert(vms).values({
    id,
    organizationId: app.organization.id,
    name: `agent-box-${id}`,
    status: "running",
    vcpus: 1,
    memoryMib: 512,
    ipAddress: "10.0.100.7",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function setProviderKey(app: TestApp, providerId = "anthropic") {
  const res = await app.request(
    `/api/organizations/${app.organization.id}/providers/${providerId}`,
    {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ apiKey: "sk-ant-test-key-123456" }),
    }
  );
  expect(res.status).toBe(200);
}

describe("Conversations", () => {
  it("creates, lists and reads conversations inside the organization", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, user, cleanup } = app;
    try {
      const created = await createConversation(app);
      expect(created).toMatchObject({
        title: "Planning",
        organizationId: app.organization.id,
        createdById: user.id,
        agentStatus: "offline",
        agentVmName: null,
      });
      expect(created.participants).toEqual([
        expect.objectContaining({ userId: user.id, name: user.name }),
      ]);

      const list = await request("/api/conversations");
      expect(list.status).toBe(200);
      expect((await list.json()).map((c: { id: string }) => c.id)).toEqual([created.id]);

      const one = await request(`/api/conversations/${created.id}`);
      expect(one.status).toBe(200);
      expect((await one.json()).title).toBe("Planning");

      // Default title when none is given.
      const untitled = await request("/api/conversations", {
        method: "POST",
        headers: json,
        body: "{}",
      });
      expect(untitled.status).toBe(201);
      expect((await untitled.json()).title).toMatch(/^Conversation /);
    } finally {
      cleanup();
    }
  });

  it("hides conversations from other organizations' users", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, signUp, cleanup } = app;
    try {
      const created = await createConversation(app);
      const stranger = await signUp({ name: "Stranger" });

      expect(
        (await request(`/api/conversations/${created.id}`, { headers: stranger.headers })).status
      ).toBe(404);
      expect(
        (
          await request(`/api/conversations/${created.id}/messages`, {
            method: "POST",
            headers: { ...stranger.headers, ...json },
            body: JSON.stringify({ body: "hi" }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await request(`/api/conversations?organizationId=${app.organization.id}`, {
            headers: stranger.headers,
          })
        ).status
      ).toBe(403);
      expect((await request("/api/conversations", { headers: stranger.headers })).status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it("stores messages, adds the author as a participant and pages by time", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, user, signUp, cleanup } = app;
    try {
      const created = await createConversation(app);
      const bob = await signUp({ name: "Bob" });
      await addMember(app, bob);

      const posted = await request(`/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { ...bob.headers, ...json },
        body: JSON.stringify({ body: "Hello from Bob" }),
      });
      expect(posted.status).toBe(201);
      const message = await posted.json();
      expect(message).toMatchObject({
        authorKind: "user",
        authorId: bob.id,
        authorName: "Bob",
        body: "Hello from Bob",
        status: "complete",
        parts: [],
      });

      const empty = await request(`/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ body: "   " }),
      });
      expect(empty.status).toBe(400);

      const detail = await (await request(`/api/conversations/${created.id}`)).json();
      expect(detail.participants.map((p: { userId: string }) => p.userId).sort()).toEqual(
        [user.id, bob.id].sort()
      );
      expect(detail.lastMessageAt).toBe(message.createdAt);

      const all = await (await request(`/api/conversations/${created.id}/messages`)).json();
      expect(all.map((m: { id: string }) => m.id)).toEqual([message.id]);

      const after = await (
        await request(
          `/api/conversations/${created.id}/messages?after=${encodeURIComponent(message.createdAt)}`
        )
      ).json();
      expect(after).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("streams new messages over server-sent events", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, cleanup } = app;
    try {
      const created = await createConversation(app);
      const controller = new AbortController();
      const stream = await request(`/api/conversations/${created.id}/events`, {
        signal: controller.signal,
      });
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");

      const reading = readEvents(stream, (e) => e.event === "message.created");
      // Wait until the subscription exists before posting.
      await waitFor(
        async () => app.app.conversationEvents.subscriberCount(created.id),
        (n) => n === 1
      );
      await request(`/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ body: "ping" }),
      });
      const events = await reading;
      expect(events[0].event).toBe("ready");
      expect(events.at(-1)).toMatchObject({
        event: "message.created",
        data: { body: "ping", authorKind: "user" },
      });
      controller.abort();
      await waitFor(
        async () => app.app.conversationEvents.subscriberCount(created.id),
        (n) => n === 0
      );
      expect(app.app.conversationEvents.subscriberCount(created.id)).toBe(0);

      const missing = await request(`/api/conversations/nope/events`);
      expect(missing.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it("lets only the creator, admins and owners delete", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, signUp, cleanup } = app;
    try {
      const bob = await signUp({ name: "Bob" });
      await addMember(app, bob);
      const created = await createConversation(app, "Owner's", app.user);
      const bobs = await createConversation(app, "Bob's", bob);

      // Bob (member) cannot delete the owner's conversation...
      const denied = await request(`/api/conversations/${created.id}`, {
        method: "DELETE",
        headers: bob.headers,
      });
      expect(denied.status).toBe(403);
      // ...but can delete his own, and the owner can delete anything.
      expect(
        (await request(`/api/conversations/${bobs.id}`, { method: "DELETE", headers: bob.headers }))
          .status
      ).toBe(200);
      expect((await request(`/api/conversations/${created.id}`, { method: "DELETE" })).status).toBe(
        200
      );
      expect((await request(`/api/conversations/${created.id}`)).status).toBe(404);
    } finally {
      cleanup();
    }
  });
});

describe("Conversation agents", () => {
  it("refuses to attach without a running VM or a provider key", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, db, cleanup } = app;
    try {
      const created = await createConversation(app);
      const attach = (vmId: string) =>
        request(`/api/conversations/${created.id}/agent`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ vmId }),
        });

      expect((await attach("missing")).status).toBe(404);

      const vmId = await insertRunningVm(app);
      const noKey = await attach(vmId);
      expect(noKey.status).toBe(400);
      expect((await noKey.json()).error).toMatch(/provider API key/);

      await setProviderKey(app);
      await db.update(vms).set({ status: "stopped" });
      const stopped = await attach(vmId);
      expect(stopped.status).toBe(400);
      expect((await stopped.json()).error).toMatch(/must be running/);

      const badModel = await request(`/api/conversations/${created.id}/agent`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ vmId, model: "claude" }),
      });
      expect(badModel.status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it("provisions opencode in the VM, relays messages and streams the reply", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, user, mocks, cleanup } = app;
    try {
      const created = await createConversation(app);
      const vmId = await insertRunningVm(app);
      await setProviderKey(app);

      const attach = await request(`/api/conversations/${created.id}/agent`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ vmId, model: "anthropic/claude-sonnet-4-5" }),
      });
      expect(attach.status).toBe(202);
      await app.app.agentManager!.pending(created.id)?.catch(() => {});

      const detail = await waitFor(
        async () => (await (await request(`/api/conversations/${created.id}`)).json()) as any,
        (c) => c.agentStatus !== "provisioning"
      );
      expect(detail).toMatchObject({
        agentStatus: "idle",
        agentVmId: vmId,
        agentVmName: `agent-box-${vmId}`,
        agentModel: "anthropic/claude-sonnet-4-5",
        agentError: null,
      });

      // Provisioned over SSH with the organization's key in the opencode config.
      const script = mocks.ssh.calls.exec[0].command;
      const b64 = script.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1];
      const config = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      expect(config.provider.anthropic.options.apiKey).toBe("sk-ant-test-key-123456");
      expect(config.permission).toBe("allow");
      expect(script).toContain("workspaces/" + created.id);

      // The manager talks to the VM's IP with the password it generated.
      expect(mocks.agentClientFactory.targets[0].baseUrl).toBe("http://10.0.100.7:4096");
      expect(mocks.agentClientFactory.targets[0].password).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const client = mocks.agentClientFactory.clients[0];
      const session = [...client.sessions.values()][0];
      expect(session.model).toEqual({ providerID: "anthropic", id: "claude-sonnet-4-5" });
      expect(session.directory).toBe(`/home/agent/workspaces/${created.id}`);

      const messagesSoFar = await (
        await request(`/api/conversations/${created.id}/messages`)
      ).json();
      expect(messagesSoFar).toHaveLength(1);
      expect(messagesSoFar[0]).toMatchObject({
        authorKind: "system",
        body: expect.stringMatching(/Agent attached/),
      });

      // A user message is forwarded with the author's name.
      await client.waitForSubscriber(session.id);
      const posted = await request(`/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ body: "What is in the workspace?" }),
      });
      expect(posted.status).toBe(201);
      expect(session.prompts).toHaveLength(1);
      expect(session.prompts[0]).toContain(`${user.name}: What is in the workspace?`);
      expect(session.prompts[0]).toContain(user.name); // named in the preamble too
      expect((await (await request(`/api/conversations/${created.id}`)).json()).agentStatus).toBe(
        "busy"
      );

      // The agent answers: text, a tool call, more text, end of turn.
      session.emit({ type: "step.started", seq: 1, messageID: "m1" });
      session.emit({ type: "text.delta", seq: 2, messageID: "m1", textID: "t1", delta: "Let me " });
      session.emit({ type: "text.delta", seq: 3, messageID: "m1", textID: "t1", delta: "look." });
      session.emit({
        type: "tool.called",
        seq: 4,
        messageID: "m1",
        callID: "c1",
        name: "bash",
        input: { command: "ls" },
      });
      session.emit({
        type: "tool.success",
        seq: 5,
        messageID: "m1",
        callID: "c1",
        output: "README.md",
      });
      session.emit({ type: "step.ended", seq: 6, messageID: "m1", finish: "tool-calls" });
      session.emit({ type: "step.started", seq: 7, messageID: "m1" });
      session.emit({
        type: "text.ended",
        seq: 8,
        messageID: "m1",
        textID: "t2",
        text: " Just a README.",
      });
      session.emit({ type: "step.ended", seq: 9, messageID: "m1", finish: "stop" });

      const messages = await waitFor(
        async () =>
          (await (await request(`/api/conversations/${created.id}/messages`)).json()) as any[],
        (list) => list.some((m) => m.authorKind === "agent" && m.status === "complete")
      );
      const reply = messages.find((m) => m.authorKind === "agent");
      expect(reply).toMatchObject({
        authorName: "Agent",
        body: "Let me look. Just a README.",
        status: "complete",
        parts: [
          { type: "text", id: "t1", text: "Let me look." },
          {
            type: "tool",
            callId: "c1",
            name: "bash",
            status: "completed",
            input: { command: "ls" },
            output: "README.md",
          },
          { type: "text", id: "t2", text: " Just a README." },
        ],
      });
      expect(messages).toHaveLength(3); // system, user, agent
      expect((await (await request(`/api/conversations/${created.id}`)).json()).agentStatus).toBe(
        "idle"
      );

      // Replayed events for a finished message change nothing.
      session.emit({ type: "step.started", seq: 1, messageID: "m1" });
      session.emit({ type: "text.delta", seq: 2, messageID: "m1", textID: "t1", delta: "AGAIN" });
      await new Promise((r) => setTimeout(r, 50));
      const replayed = await (await request(`/api/conversations/${created.id}/messages`)).json();
      expect(replayed).toHaveLength(3);
      expect(replayed.find((m: any) => m.authorKind === "agent").body).toBe(
        "Let me look. Just a README."
      );

      // A failed step surfaces as an error on the message and the conversation.
      session.emit({ type: "step.started", seq: 10, messageID: "m2" });
      session.emit({
        type: "step.failed",
        seq: 11,
        messageID: "m2",
        error: "Provider request failed with HTTP 401",
      });
      const failed = await waitFor(
        async () => (await (await request(`/api/conversations/${created.id}`)).json()) as any,
        (c) => c.agentStatus === "error"
      );
      expect(failed.agentError).toBe("Provider request failed with HTTP 401");
      const errored = (
        await (await request(`/api/conversations/${created.id}/messages`)).json()
      ).at(-1);
      expect(errored).toMatchObject({
        authorKind: "agent",
        status: "error",
        parts: [{ type: "error", message: "Provider request failed with HTTP 401" }],
      });

      // Interrupt, models, detach.
      expect(
        (await request(`/api/conversations/${created.id}/agent/interrupt`, { method: "POST" }))
          .status
      ).toBe(200);
      expect(client.interrupted).toEqual([session.id]);
      const models = await request(`/api/conversations/${created.id}/agent/models`);
      expect(await models.json()).toEqual([
        { providerID: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      ]);

      const detach = await request(`/api/conversations/${created.id}/agent`, { method: "DELETE" });
      expect(detach.status).toBe(200);
      expect(await detach.json()).toMatchObject({
        agentStatus: "offline",
        agentVmId: null,
        agentVmName: null,
      });
      const finalMessages = await (
        await request(`/api/conversations/${created.id}/messages`)
      ).json();
      expect(finalMessages.at(-1)).toMatchObject({ authorKind: "system", body: "Agent detached." });
      expect(
        (await request(`/api/conversations/${created.id}/agent/interrupt`, { method: "POST" }))
          .status
      ).toBe(409);
    } finally {
      cleanup();
    }
  });

  it("reports a provisioning failure on the conversation", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, mocks, cleanup } = app;
    try {
      const created = await createConversation(app);
      const vmId = await insertRunningVm(app);
      await setProviderKey(app);
      mocks.ssh.setCommandResponse(/bash -s/, { stdout: "", stderr: "no opencode", code: 3 });

      const attach = await request(`/api/conversations/${created.id}/agent`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ vmId }),
      });
      expect(attach.status).toBe(202);
      await app.app.agentManager!.pending(created.id)?.catch(() => {});

      const detail = await waitFor(
        async () => (await (await request(`/api/conversations/${created.id}`)).json()) as any,
        (c) => c.agentStatus === "error"
      );
      expect(detail.agentStatus).toBe("error");
      expect(detail.agentError).toMatch(/exit 3/);
      expect(mocks.agentClientFactory.clients).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("rebuilds the agent runtime after a restart from what is stored", async () => {
    const app = await createTestApp({ openSignup: true });
    const { request, mocks, cleanup } = app;
    try {
      const created = await createConversation(app);
      const vmId = await insertRunningVm(app);
      await setProviderKey(app);
      await request(`/api/conversations/${created.id}/agent`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ vmId }),
      });
      await app.app.agentManager!.pending(created.id)?.catch(() => {});
      await waitFor(
        async () => (await (await request(`/api/conversations/${created.id}`)).json()) as any,
        (c) => c.agentStatus === "idle"
      );

      // Simulate the API restarting: drop in-memory runtimes.
      app.app.agentManager!.shutdown();
      const before = mocks.agentClientFactory.targets.length;

      const posted = await request(`/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ body: "still there?" }),
      });
      expect(posted.status).toBe(201);
      // A fresh client to the same VM with the stored password.
      expect(mocks.agentClientFactory.targets).toHaveLength(before + 1);
      expect(mocks.agentClientFactory.targets.at(-1)).toEqual(mocks.agentClientFactory.targets[0]);
    } finally {
      cleanup();
    }
  });
});
