/**
 * A small client for the opencode v2 HTTP API (https://opencode.ai/v2/docs/api).
 *
 * Only the handful of calls Bonfire needs, written against the wire format
 * rather than the SDK's request wrapper so a test can stand in a fake `fetch`.
 * Types come from `@opencode-ai/sdk/v2/types`; the server itself runs inside
 * the VM (services/agent/provisioner.ts) behind basic auth.
 */

import type { ModelRef, V2Event, SessionMessage } from "@opencode-ai/sdk/v2/types";
import { AGENT_SERVER_USERNAME } from "./provisioner";

/** Events the agent manager cares about, flattened from opencode's stream. */
export type AgentEvent =
  | { type: "step.started"; seq: number; messageID: string }
  | { type: "text.delta"; seq: number; messageID: string; textID: string; delta: string }
  | { type: "text.ended"; seq: number; messageID: string; textID: string; text: string }
  | {
      type: "tool.called";
      seq: number;
      messageID: string;
      callID: string;
      name: string;
      input: unknown;
    }
  | { type: "tool.success"; seq: number; messageID: string; callID: string; output: string }
  | { type: "tool.failed"; seq: number; messageID: string; callID: string; error: string }
  | { type: "step.ended"; seq: number; messageID: string; finish: string }
  | { type: "step.failed"; seq: number; messageID: string; error: string };

export interface AgentModel {
  providerID: string;
  id: string;
  name: string;
}

export interface AgentProvider {
  id: string;
  name: string;
}

export interface AgentSessionClient {
  health(): Promise<boolean>;
  createSession(input: {
    directory: string;
    title?: string;
    model?: ModelRef;
  }): Promise<{ id: string }>;
  /** Queue a prompt. Returns once opencode has durably admitted it. */
  prompt(sessionID: string, text: string): Promise<{ messageID: string }>;
  interrupt(sessionID: string): Promise<void>;
  listProviders(): Promise<AgentProvider[]>;
  /** Models of the configured providers only. */
  listModels(): Promise<AgentModel[]>;
  listMessages(sessionID: string): Promise<SessionMessage[]>;
  /**
   * Stream a session's events, starting after `after` (a durable sequence
   * number) when given. Resolves when the server closes the stream or the
   * signal aborts; rejects on transport errors.
   */
  subscribe(
    sessionID: string,
    onEvent: (event: AgentEvent) => void,
    options?: { after?: number; signal?: AbortSignal }
  ): Promise<void>;
}

export interface AgentTarget {
  baseUrl: string;
  password: string;
}

export type AgentClientFactory = (target: AgentTarget) => AgentSessionClient;

export class OpencodeError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "OpencodeError";
  }
}

/** Turn one opencode durable event into the flattened form, or null to ignore it. */
export function flattenEvent(event: V2Event): AgentEvent | null {
  const seq = event.durable?.seq ?? 0;
  switch (event.type) {
    case "session.next.step.started":
      return { type: "step.started", seq, messageID: event.data.assistantMessageID };
    case "session.next.text.delta":
      return {
        type: "text.delta",
        seq,
        messageID: event.data.assistantMessageID,
        textID: event.data.textID,
        delta: event.data.delta,
      };
    case "session.next.text.ended":
      return {
        type: "text.ended",
        seq,
        messageID: event.data.assistantMessageID,
        textID: event.data.textID,
        text: event.data.text,
      };
    case "session.next.tool.called":
      return {
        type: "tool.called",
        seq,
        messageID: event.data.assistantMessageID,
        callID: event.data.callID,
        name: event.data.tool,
        input: event.data.input,
      };
    case "session.next.tool.success":
      return {
        type: "tool.success",
        seq,
        messageID: event.data.assistantMessageID,
        callID: event.data.callID,
        output: event.data.content
          .map((c) => (c.type === "text" ? c.text : `[file ${c.name ?? c.uri}]`))
          .join("\n"),
      };
    case "session.next.tool.failed":
      return {
        type: "tool.failed",
        seq,
        messageID: event.data.assistantMessageID,
        callID: event.data.callID,
        error: event.data.error.message,
      };
    case "session.next.step.ended":
      return {
        type: "step.ended",
        seq,
        messageID: event.data.assistantMessageID,
        finish: event.data.finish,
      };
    case "session.next.step.failed":
      return {
        type: "step.failed",
        seq,
        messageID: event.data.assistantMessageID,
        error: event.data.error.message,
      };
    default:
      return null;
  }
}

/**
 * Parse a text/event-stream body into `data:` payloads. Exported for tests.
 * opencode sends one JSON object per `data:` line and no event names.
 */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export function createOpencodeClientFactory(fetchImpl: typeof fetch = fetch): AgentClientFactory {
  return (target) => createOpencodeClient(target, fetchImpl);
}

export function createOpencodeClient(
  target: AgentTarget,
  fetchImpl: typeof fetch = fetch
): AgentSessionClient {
  const base = target.baseUrl.replace(/\/$/, "");
  const authorization = `Basic ${Buffer.from(`${AGENT_SERVER_USERNAME}:${target.password}`).toString("base64")}`;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    init?: { signal?: AbortSignal; accept?: string }
  ): Promise<{ response: Response; json: () => Promise<T> }> {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization,
        accept: init?.accept ?? "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: init?.signal,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const text = await response.text();
        try {
          const parsed = JSON.parse(text) as { message?: string };
          detail = parsed.message ?? text;
        } catch {
          detail = text;
        }
      } catch {
        // ignore
      }
      throw new OpencodeError(
        `opencode ${method} ${path} failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        response.status
      );
    }
    return { response, json: () => response.json() as Promise<T> };
  }

  return {
    async health() {
      try {
        const { json } = await call<{ healthy: boolean }>("GET", "/api/health");
        return (await json()).healthy === true;
      } catch {
        return false;
      }
    },

    async createSession(input) {
      const { json } = await call<{ data: { id: string } }>("POST", "/api/session", {
        location: { directory: input.directory },
        ...(input.model ? { model: input.model } : {}),
      });
      return { id: (await json()).data.id };
    },

    async prompt(sessionID, text) {
      const { json } = await call<{ data: { id: string } }>(
        "POST",
        `/api/session/${encodeURIComponent(sessionID)}/prompt`,
        { prompt: { text }, delivery: "queue" }
      );
      return { messageID: (await json()).data.id };
    },

    async interrupt(sessionID) {
      await call("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`);
    },

    async listProviders() {
      const { json } = await call<{ data: Array<{ id: string; name: string }> }>(
        "GET",
        "/api/provider"
      );
      return (await json()).data.map((p) => ({ id: p.id, name: p.name }));
    },

    async listModels() {
      const providers = new Set((await this.listProviders()).map((p) => p.id));
      const { json } = await call<{
        data: Array<{ id: string; providerID: string; name: string; enabled: boolean }>;
      }>("GET", "/api/model");
      return (await json()).data
        .filter((m) => providers.has(m.providerID) && m.enabled !== false)
        .map((m) => ({ providerID: m.providerID, id: m.id, name: m.name }));
    },

    async listMessages(sessionID) {
      const { json } = await call<{ data: SessionMessage[] }>(
        "GET",
        `/api/session/${encodeURIComponent(sessionID)}/message?order=asc&limit=200`
      );
      return (await json()).data;
    },

    async subscribe(sessionID, onEvent, options = {}) {
      const query = options.after !== undefined ? `?after=${options.after}` : "";
      const { response } = await call(
        "GET",
        `/api/session/${encodeURIComponent(sessionID)}/event${query}`,
        undefined,
        { signal: options.signal, accept: "text/event-stream" }
      );
      if (!response.body) throw new OpencodeError("opencode event stream had no body", 502);
      for await (const data of readServerSentEvents(response.body, options.signal)) {
        let parsed: V2Event;
        try {
          parsed = JSON.parse(data) as V2Event;
        } catch {
          continue;
        }
        const event = flattenEvent(parsed);
        if (event) onEvent(event);
      }
    },
  };
}

// ============================================================================
// Fake for tests
// ============================================================================

export interface MockAgentSession {
  id: string;
  directory: string;
  model?: ModelRef;
  prompts: string[];
  /** Push events into every live subscription of this session. */
  emit(event: AgentEvent): void;
  /** Close the live streams (as the server would on restart). */
  closeStreams(): void;
}

export interface MockAgentClient extends AgentSessionClient {
  sessions: Map<string, MockAgentSession>;
  healthy: boolean;
  interrupted: string[];
  /** Resolves once a subscription for the session exists. */
  waitForSubscriber(sessionID: string): Promise<void>;
}

export interface MockAgentClientFactory extends AgentClientFactory {
  /** One fake server per base URL, in order of first use. */
  clients: MockAgentClient[];
  /** Every target a client was requested for, in order. */
  targets: AgentTarget[];
}

/**
 * Like the real factory, two clients for the same base URL talk to the same
 * server: sessions created through one are visible through the other.
 */
export function createMockAgentClientFactory(): MockAgentClientFactory {
  const clients: MockAgentClient[] = [];
  const targets: AgentTarget[] = [];
  const byBaseUrl = new Map<string, MockAgentClient>();
  const factory = (target: AgentTarget) => {
    targets.push(target);
    let client = byBaseUrl.get(target.baseUrl);
    if (!client) {
      client = createMockAgentClient();
      byBaseUrl.set(target.baseUrl, client);
      clients.push(client);
    }
    return client;
  };
  return Object.assign(factory, { clients, targets });
}

export function createMockAgentClient(): MockAgentClient {
  const sessions = new Map<string, MockAgentSession>();
  const subscribers = new Map<
    string,
    Set<{ onEvent: (e: AgentEvent) => void; close: () => void }>
  >();
  const waiters = new Map<string, Array<() => void>>();
  let counter = 0;

  function subscribersOf(id: string) {
    let set = subscribers.get(id);
    if (!set) {
      set = new Set();
      subscribers.set(id, set);
    }
    return set;
  }

  const client: MockAgentClient = {
    sessions,
    healthy: true,
    interrupted: [],

    async health() {
      return client.healthy;
    },

    async createSession(input) {
      const id = `ses_mock_${++counter}`;
      const session: MockAgentSession = {
        id,
        directory: input.directory,
        model: input.model,
        prompts: [],
        emit(event) {
          for (const sub of subscribersOf(id)) sub.onEvent(event);
        },
        closeStreams() {
          for (const sub of [...subscribersOf(id)]) sub.close();
        },
      };
      sessions.set(id, session);
      return { id };
    },

    async prompt(sessionID, text) {
      const session = sessions.get(sessionID);
      if (!session) throw new OpencodeError("Invalid session ID", 400);
      session.prompts.push(text);
      return { messageID: `msg_user_${session.prompts.length}` };
    },

    async interrupt(sessionID) {
      client.interrupted.push(sessionID);
    },

    async listProviders() {
      return [{ id: "anthropic", name: "Anthropic" }];
    },

    async listModels() {
      return [{ providerID: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }];
    },

    async listMessages() {
      return [];
    },

    subscribe(sessionID, onEvent, options = {}) {
      return new Promise<void>((resolve, reject) => {
        if (!sessions.has(sessionID)) {
          reject(new OpencodeError("Invalid session ID", 400));
          return;
        }
        const set = subscribersOf(sessionID);
        const entry = {
          onEvent,
          close: () => {
            set.delete(entry);
            resolve();
          },
        };
        set.add(entry);
        options.signal?.addEventListener("abort", entry.close, { once: true });
        for (const wake of waiters.get(sessionID) ?? []) wake();
        waiters.delete(sessionID);
      });
    },

    waitForSubscriber(sessionID) {
      if ((subscribers.get(sessionID)?.size ?? 0) > 0) return Promise.resolve();
      return new Promise((resolve) => {
        const list = waiters.get(sessionID) ?? [];
        list.push(resolve);
        waiters.set(sessionID, list);
      });
    },
  };

  return client;
}
