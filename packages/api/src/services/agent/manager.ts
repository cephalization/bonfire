/**
 * Agent manager: the bridge between conversations and opencode sessions.
 *
 * One conversation has at most one agent. Attaching one provisions an opencode
 * server in a VM of the organization (provisioner.ts), creates a session in it
 * and streams the session's events (opencode.ts) into conversation messages,
 * which are persisted and published on the conversation event bus so every
 * open browser sees the agent type.
 *
 * Runtime state (the event stream, in-flight messages) is per process. After a
 * restart the runtime is rebuilt lazily from the database the next time a
 * message is sent, and opencode replays the session's durable events; rows
 * are keyed by opencode's message id so a replay updates rather than
 * duplicates.
 */

import { randomBytes, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import type { Conversation, ConversationMessage, MessagePart, VM } from "../../db/schema";
import type { SecretBox } from "../../lib/secrets";
import type { ConversationEventBus } from "../conversation-events";
import type { SSHService } from "../ssh";
import { loadPrivateKey } from "../ssh-keys";
import { sshService as defaultSSHService } from "../ssh";
import {
  createOpencodeClientFactory,
  type AgentClientFactory,
  type AgentEvent,
  type AgentModel,
  type AgentSessionClient,
} from "./opencode";
import { AGENT_SERVER_PORT, provisionAgent, workspaceDirectory } from "./provisioner";

type Db = BetterSQLite3Database<typeof schema>;

export const AGENT_AUTHOR_NAME = "Agent";
const SYSTEM_AUTHOR_NAME = "Bonfire";
const FLUSH_INTERVAL_MS = 200;

export interface AgentManagerConfig {
  db: Db;
  events: ConversationEventBus;
  secrets: SecretBox;
  clientFactory?: AgentClientFactory;
  sshService?: SSHService;
  loadPrivateKeyFn?: (vmId: string) => Promise<string | null>;
  provisionFn?: typeof provisionAgent;
  /** How long to wait for the opencode server to answer after starting it. */
  healthTimeoutMs?: number;
  healthIntervalMs?: number;
  log?: (message: string) => void;
}

export interface AttachAgentInput {
  vmId: string;
  /** "providerID/modelID"; omitted lets opencode pick its default. */
  model?: string | null;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 502 = 502
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentManager {
  /**
   * Provision and attach an agent. The returned promise settles when the agent
   * is ready or failed; the conversation row reflects progress in between.
   */
  attach(conversationId: string, input: AttachAgentInput): Promise<Conversation>;
  detach(conversationId: string): Promise<Conversation>;
  /** Forward a stored user message to the attached agent. */
  send(conversation: Conversation, message: ConversationMessage): Promise<void>;
  interrupt(conversationId: string): Promise<void>;
  listModels(conversationId: string): Promise<AgentModel[]>;
  /** The in-flight attach for a conversation, if any (tests await it). */
  pending(conversationId: string): Promise<unknown> | undefined;
  shutdown(): void;
}

interface LiveMessage {
  rowId: string;
  externalId: string;
  parts: MessagePart[];
  status: ConversationMessage["status"];
  createdAt: Date;
  dirty: boolean;
}

interface Runtime {
  conversationId: string;
  sessionId: string;
  client: AgentSessionClient;
  abort: AbortController;
  lastSeq: number;
  /** Agent messages seen in this process, by opencode message id. */
  live: Map<string, LiveMessage>;
  /** opencode message ids whose rows were already complete when first seen (replays). */
  ignored: Set<string>;
  prompted: boolean;
  flushTimer: NodeJS.Timeout | null;
  loop: Promise<void>;
}

export function parseModelRef(model: string | null | undefined) {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) };
}

/** What the agent is told before the first message of a session. */
export function sessionPreamble(names: string[]): string {
  const people = names.length ? names.join(", ") : "the members of this organization";
  return (
    "You are an agent taking part in a group conversation in Bonfire with " +
    `${people}. Each message you receive is prefixed with the name of the person ` +
    "who wrote it. Reply to the group; keep answers concise unless asked for " +
    "detail. You are running inside a sandbox VM whose working directory is " +
    "the conversation's workspace.\n\n"
  );
}

export function createAgentManager(config: AgentManagerConfig): AgentManager {
  const {
    db,
    events,
    secrets,
    clientFactory = createOpencodeClientFactory(),
    sshService = defaultSSHService,
    loadPrivateKeyFn = loadPrivateKey,
    provisionFn = provisionAgent,
    healthTimeoutMs = 30_000,
    healthIntervalMs = 500,
    log = (message) => console.log(`[agent] ${message}`),
  } = config;

  const runtimes = new Map<string, Runtime>();
  const inflight = new Map<string, Promise<Conversation>>();

  // --------------------------------------------------------------------------
  // Database helpers
  // --------------------------------------------------------------------------

  async function loadConversation(id: string): Promise<Conversation> {
    const [row] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    if (!row) throw new AgentError("Conversation not found", 404);
    return row;
  }

  async function updateConversation(
    id: string,
    patch: Partial<typeof schema.conversations.$inferInsert>
  ): Promise<Conversation> {
    const [row] = await db
      .update(schema.conversations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    if (row) events.publish(id, { type: "conversation.updated", conversation: row });
    return row;
  }

  async function insertSystemMessage(conversationId: string, body: string) {
    const now = new Date();
    const [row] = await db
      .insert(schema.conversationMessages)
      .values({
        id: randomUUID(),
        conversationId,
        authorKind: "system",
        authorName: SYSTEM_AUTHOR_NAME,
        body,
        parts: [],
        status: "complete",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversations.id, conversationId));
    events.publish(conversationId, { type: "message.created", message: row });
  }

  async function loadProviderKeys(organizationId: string): Promise<Record<string, string>> {
    const rows = await db
      .select()
      .from(schema.providerCredentials)
      .where(eq(schema.providerCredentials.organizationId, organizationId));
    const keys: Record<string, string> = {};
    for (const row of rows) keys[row.providerId] = secrets.decrypt(row.keyCiphertext);
    return keys;
  }

  async function loadVm(vmId: string, organizationId: string): Promise<VM | null> {
    const [vm] = await db
      .select()
      .from(schema.vms)
      .where(and(eq(schema.vms.id, vmId), eq(schema.vms.organizationId, organizationId)));
    return vm ?? null;
  }

  async function participantNames(conversationId: string): Promise<string[]> {
    const rows = await db
      .select({ name: schema.user.name })
      .from(schema.conversationParticipants)
      .innerJoin(schema.user, eq(schema.user.id, schema.conversationParticipants.userId))
      .where(eq(schema.conversationParticipants.conversationId, conversationId));
    return rows.map((r) => r.name);
  }

  // --------------------------------------------------------------------------
  // Streaming agent messages
  // --------------------------------------------------------------------------

  function toRow(runtime: Runtime, live: LiveMessage): ConversationMessage {
    return {
      id: live.rowId,
      conversationId: runtime.conversationId,
      authorKind: "agent",
      externalId: live.externalId,
      authorId: null,
      authorName: AGENT_AUTHOR_NAME,
      body: live.parts
        .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join(""),
      parts: live.parts,
      status: live.status,
      createdAt: live.createdAt,
      updatedAt: new Date(),
    };
  }

  async function flush(runtime: Runtime, live: LiveMessage) {
    if (!live.dirty) return;
    live.dirty = false;
    const row = toRow(runtime, live);
    await db
      .update(schema.conversationMessages)
      .set({ body: row.body, parts: row.parts, status: row.status, updatedAt: row.updatedAt })
      .where(eq(schema.conversationMessages.id, live.rowId));
  }

  function scheduleFlush(runtime: Runtime) {
    if (runtime.flushTimer) return;
    runtime.flushTimer = setTimeout(() => {
      runtime.flushTimer = null;
      for (const live of runtime.live.values()) {
        void flush(runtime, live).catch((error) => log(`flush failed: ${String(error)}`));
      }
    }, FLUSH_INTERVAL_MS);
  }

  function publish(runtime: Runtime, live: LiveMessage, created = false) {
    live.dirty = true;
    events.publish(runtime.conversationId, {
      type: created ? "message.created" : "message.updated",
      message: toRow(runtime, live),
    });
    scheduleFlush(runtime);
  }

  /** Find or create the row for an opencode assistant message. */
  async function liveMessage(runtime: Runtime, externalId: string): Promise<LiveMessage | null> {
    const existing = runtime.live.get(externalId);
    if (existing) return existing;
    if (runtime.ignored.has(externalId)) return null;

    const [row] = await db
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, runtime.conversationId),
          eq(schema.conversationMessages.externalId, externalId)
        )
      );

    if (row && row.status !== "streaming") {
      // A replay of a message that finished before this process started.
      runtime.ignored.add(externalId);
      return null;
    }

    let live: LiveMessage;
    if (row) {
      // Interrupted mid-stream by a restart; the replay rebuilds it from scratch.
      live = {
        rowId: row.id,
        externalId,
        parts: [],
        status: "streaming",
        createdAt: row.createdAt,
        dirty: true,
      };
      runtime.live.set(externalId, live);
      publish(runtime, live);
    } else {
      const now = new Date();
      live = {
        rowId: randomUUID(),
        externalId,
        parts: [],
        status: "streaming",
        createdAt: now,
        dirty: false,
      };
      runtime.live.set(externalId, live);
      const created = toRow(runtime, live);
      await db.insert(schema.conversationMessages).values(created);
      await db
        .update(schema.conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(schema.conversations.id, runtime.conversationId));
      events.publish(runtime.conversationId, { type: "message.created", message: created });
    }
    return live;
  }

  async function finish(runtime: Runtime, live: LiveMessage, status: "complete" | "error") {
    live.status = status;
    publish(runtime, live);
    await flush(runtime, live);
    runtime.live.delete(live.externalId);
    runtime.ignored.add(live.externalId);
  }

  async function handleEvent(runtime: Runtime, event: AgentEvent) {
    if (event.seq) runtime.lastSeq = Math.max(runtime.lastSeq, event.seq);
    const live = await liveMessage(runtime, event.messageID);
    if (!live) return;

    switch (event.type) {
      case "step.started": {
        await updateConversation(runtime.conversationId, { agentStatus: "busy", agentError: null });
        break;
      }
      case "text.delta": {
        const part = live.parts.find((p) => p.type === "text" && p.id === event.textID);
        if (part && part.type === "text") part.text += event.delta;
        else live.parts.push({ type: "text", id: event.textID, text: event.delta });
        publish(runtime, live);
        break;
      }
      case "text.ended": {
        const part = live.parts.find((p) => p.type === "text" && p.id === event.textID);
        if (part && part.type === "text") part.text = event.text;
        else live.parts.push({ type: "text", id: event.textID, text: event.text });
        publish(runtime, live);
        break;
      }
      case "tool.called": {
        live.parts.push({
          type: "tool",
          callId: event.callID,
          name: event.name,
          status: "running",
          input: event.input,
        });
        publish(runtime, live);
        break;
      }
      case "tool.success":
      case "tool.failed": {
        const part = live.parts.find((p) => p.type === "tool" && p.callId === event.callID);
        if (part && part.type === "tool") {
          if (event.type === "tool.success") {
            part.status = "completed";
            part.output = event.output.slice(0, 20_000);
          } else {
            part.status = "error";
            part.error = event.error;
          }
        }
        publish(runtime, live);
        break;
      }
      case "step.ended": {
        // A step that ends in tool calls is followed by another step on the
        // same message; anything else ends the agent's turn.
        if (event.finish === "tool-calls") break;
        await finish(runtime, live, "complete");
        await updateConversation(runtime.conversationId, { agentStatus: "idle" });
        break;
      }
      case "step.failed": {
        live.parts.push({ type: "error", message: event.error });
        await finish(runtime, live, "error");
        await updateConversation(runtime.conversationId, {
          agentStatus: "error",
          agentError: event.error,
        });
        break;
      }
    }
  }

  function startLoop(runtime: Runtime): Promise<void> {
    const { signal } = runtime.abort;
    let queue: Promise<void> = Promise.resolve();
    const onEvent = (event: AgentEvent) => {
      // Events are handled strictly in order, even though handling is async.
      queue = queue
        .then(() => handleEvent(runtime, event))
        .catch((error) => log(`event handling failed: ${String(error)}`));
    };

    return (async () => {
      let backoff = 500;
      while (!signal.aborted) {
        try {
          await runtime.client.subscribe(runtime.sessionId, onEvent, {
            after: runtime.lastSeq || undefined,
            signal,
          });
          backoff = 500;
        } catch (error) {
          if (signal.aborted) break;
          log(`event stream for ${runtime.conversationId} failed: ${String(error)}`);
        }
        if (signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 10_000);
      }
      await queue;
    })();
  }

  function stopRuntime(conversationId: string) {
    const runtime = runtimes.get(conversationId);
    if (!runtime) return;
    runtimes.delete(conversationId);
    runtime.abort.abort();
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    for (const live of runtime.live.values()) {
      void flush(runtime, live).catch(() => {});
    }
  }

  function agentBaseUrl(vm: VM): string {
    return `http://${vm.ipAddress}:${AGENT_SERVER_PORT}`;
  }

  /** The runtime for a conversation with an attached agent, rebuilt after a restart. */
  async function ensureRuntime(
    conversation: Conversation,
    knownClient?: AgentSessionClient
  ): Promise<Runtime> {
    const existing = runtimes.get(conversation.id);
    if (existing) return existing;

    if (!conversation.agentVmId || !conversation.agentSessionId) {
      throw new AgentError("No agent is attached to this conversation", 409);
    }
    let client = knownClient;
    if (!client) {
      const vm = await loadVm(conversation.agentVmId, conversation.organizationId);
      if (!vm || vm.status !== "running" || !vm.ipAddress || !vm.agentPasswordCiphertext) {
        throw new AgentError("The agent's VM is not running", 409);
      }
      client = clientFactory({
        baseUrl: agentBaseUrl(vm),
        password: secrets.decrypt(vm.agentPasswordCiphertext),
      });
    }
    const runtime: Runtime = {
      conversationId: conversation.id,
      sessionId: conversation.agentSessionId,
      client,
      abort: new AbortController(),
      lastSeq: 0,
      live: new Map(),
      ignored: new Set(),
      prompted: false,
      flushTimer: null,
      loop: Promise.resolve(),
    };
    runtime.loop = startLoop(runtime);
    runtimes.set(conversation.id, runtime);
    return runtime;
  }

  async function waitForHealth(client: AgentSessionClient): Promise<void> {
    const deadline = Date.now() + healthTimeoutMs;
    while (true) {
      if (await client.health()) return;
      if (Date.now() >= deadline) {
        throw new AgentError("The opencode server in the VM did not become healthy in time", 502);
      }
      await new Promise((resolve) => setTimeout(resolve, healthIntervalMs));
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async function doAttach(conversationId: string, input: AttachAgentInput): Promise<Conversation> {
    const conversation = await loadConversation(conversationId);
    const vm = await loadVm(input.vmId, conversation.organizationId);
    if (!vm) throw new AgentError("VM not found", 404);
    if (vm.status !== "running" || !vm.ipAddress) {
      throw new AgentError("The VM must be running before an agent can use it", 400);
    }
    if (input.model && !parseModelRef(input.model)) {
      throw new AgentError('Model must be written as "provider/model"', 400);
    }
    const providerKeys = await loadProviderKeys(conversation.organizationId);
    if (Object.keys(providerKeys).length === 0) {
      throw new AgentError(
        "Configure at least one provider API key for this organization first",
        400
      );
    }

    stopRuntime(conversationId);
    await updateConversation(conversationId, {
      agentVmId: vm.id,
      agentModel: input.model ?? null,
      agentSessionId: null,
      agentStatus: "provisioning",
      agentError: null,
    });

    try {
      const privateKey = await loadPrivateKeyFn(vm.id);
      if (!privateKey) throw new AgentError("No SSH key is stored for this VM", 502);

      let password: string;
      if (vm.agentPasswordCiphertext) {
        password = secrets.decrypt(vm.agentPasswordCiphertext);
      } else {
        password = randomBytes(24).toString("base64url");
        await db
          .update(schema.vms)
          .set({ agentPasswordCiphertext: secrets.encrypt(password), updatedAt: new Date() })
          .where(eq(schema.vms.id, vm.id));
      }

      const provisioned = await provisionFn({
        host: vm.ipAddress,
        privateKey,
        sshService,
        providerKeys,
        password,
        workspace: conversation.id,
      });
      log(
        `${provisioned.started ? "started" : "reusing"} opencode in VM ${vm.name} for conversation ${conversation.id}`
      );

      const client = clientFactory({ baseUrl: agentBaseUrl(vm), password });
      await waitForHealth(client);
      const session = await client.createSession({
        directory: provisioned.directory ?? workspaceDirectory(conversation.id),
        title: conversation.title,
        model: parseModelRef(input.model),
      });

      const updated = await updateConversation(conversationId, {
        agentSessionId: session.id,
        agentStatus: "idle",
        agentError: null,
      });
      await insertSystemMessage(
        conversationId,
        `Agent attached, running in VM "${vm.name}"${input.model ? ` with ${input.model}` : ""}.`
      );
      await ensureRuntime(updated, client);
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateConversation(conversationId, { agentStatus: "error", agentError: message });
      throw error instanceof AgentError ? error : new AgentError(message, 502);
    }
  }

  const manager: AgentManager = {
    attach(conversationId, input) {
      const existing = inflight.get(conversationId);
      if (existing) return existing;
      const task = doAttach(conversationId, input).finally(() => inflight.delete(conversationId));
      inflight.set(conversationId, task);
      return task;
    },

    async detach(conversationId) {
      const conversation = await loadConversation(conversationId);
      stopRuntime(conversationId);
      const updated = await updateConversation(conversationId, {
        agentVmId: null,
        agentModel: null,
        agentSessionId: null,
        agentStatus: "offline",
        agentError: null,
      });
      if (conversation.agentVmId) await insertSystemMessage(conversationId, "Agent detached.");
      return updated;
    },

    async send(conversation, message) {
      const runtime = await ensureRuntime(conversation);
      let text = `${message.authorName}: ${message.body}`;
      if (!runtime.prompted) {
        text = sessionPreamble(await participantNames(conversation.id)) + text;
      }
      try {
        await runtime.client.prompt(runtime.sessionId, text);
        runtime.prompted = true;
        await updateConversation(conversation.id, { agentStatus: "busy", agentError: null });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await updateConversation(conversation.id, { agentStatus: "error", agentError: detail });
        throw new AgentError(`Could not reach the agent: ${detail}`, 502);
      }
    },

    async interrupt(conversationId) {
      const runtime = await ensureRuntime(await loadConversation(conversationId));
      await runtime.client.interrupt(runtime.sessionId);
    },

    async listModels(conversationId) {
      const runtime = await ensureRuntime(await loadConversation(conversationId));
      return runtime.client.listModels();
    },

    pending(conversationId) {
      return inflight.get(conversationId);
    },

    shutdown() {
      for (const id of [...runtimes.keys()]) stopRuntime(id);
    },
  };

  return manager;
}
