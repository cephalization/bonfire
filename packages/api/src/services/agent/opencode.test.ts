import { describe, it, expect } from "vitest";
import {
  createOpencodeClient,
  flattenEvent,
  readServerSentEvents,
  OpencodeError,
} from "./opencode";

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("readServerSentEvents", () => {
  it("yields data payloads across chunk boundaries", async () => {
    const frames = ['data: {"a":1}\n\nda', 'ta: {"b":2}\n\n', ': comment\n\ndata: {"c":3}\n\n'];
    const out: string[] = [];
    for await (const data of readServerSentEvents(sseResponse(frames).body!)) out.push(data);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe("flattenEvent", () => {
  it("maps text, tool and step events and ignores the rest", () => {
    const base = { id: "evt", durable: { aggregateID: "s", seq: 7, version: 1 } };
    expect(
      flattenEvent({
        ...base,
        type: "session.next.text.delta",
        data: { timestamp: 0, sessionID: "s", assistantMessageID: "m", textID: "t", delta: "hi" },
      } as any)
    ).toEqual({ type: "text.delta", seq: 7, messageID: "m", textID: "t", delta: "hi" });

    expect(
      flattenEvent({
        ...base,
        type: "session.next.tool.success",
        data: {
          timestamp: 0,
          sessionID: "s",
          assistantMessageID: "m",
          callID: "c",
          structured: {},
          content: [
            { type: "text", text: "line 1" },
            { type: "file", uri: "file:///x", mime: "text/plain", name: "x" },
          ],
          provider: { executed: true },
        },
      } as any)
    ).toEqual({
      type: "tool.success",
      seq: 7,
      messageID: "m",
      callID: "c",
      output: "line 1\n[file x]",
    });

    expect(
      flattenEvent({
        ...base,
        type: "session.next.step.failed",
        data: {
          timestamp: 0,
          sessionID: "s",
          assistantMessageID: "m",
          error: { type: "unknown", message: "boom" },
        },
      } as any)
    ).toEqual({ type: "step.failed", seq: 7, messageID: "m", error: "boom" });

    expect(flattenEvent({ ...base, type: "session.next.prompted", data: {} } as any)).toBeNull();
  });
});

describe("createOpencodeClient", () => {
  it("sends basic auth and speaks the v2 wire format", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init! });
      if (url.endsWith("/api/health")) return Response.json({ healthy: true });
      if (url.endsWith("/api/session") && init?.method === "POST") {
        return Response.json({ data: { id: "ses_1" } });
      }
      if (url.endsWith("/api/session/ses_1/prompt")) {
        return Response.json({ data: { id: "msg_1" } });
      }
      if (url.endsWith("/api/provider")) {
        return Response.json({ data: [{ id: "anthropic", name: "Anthropic" }] });
      }
      if (url.endsWith("/api/model")) {
        return Response.json({
          data: [
            { id: "claude", providerID: "anthropic", name: "Claude", enabled: true },
            { id: "gpt", providerID: "openai", name: "GPT", enabled: true },
          ],
        });
      }
      if (url.includes("/api/session/ses_1/event")) {
        return sseResponse([
          'data: {"type":"session.next.step.started","durable":{"seq":1},"data":{"assistantMessageID":"m"}}\n\n',
          'data: {"type":"session.next.text.delta","durable":{"seq":2},"data":{"assistantMessageID":"m","textID":"t","delta":"Hello"}}\n\n',
          "data: not json\n\n",
        ]);
      }
      return new Response(JSON.stringify({ message: "nope" }), { status: 404 });
    };

    const client = createOpencodeClient(
      { baseUrl: "http://10.0.0.5:4096/", password: "pw" },
      fetchImpl
    );

    expect(await client.health()).toBe(true);
    const auth = (calls[0].init.headers as Record<string, string>).authorization;
    expect(auth).toBe(`Basic ${Buffer.from("opencode:pw").toString("base64")}`);
    expect(calls[0].url).toBe("http://10.0.0.5:4096/api/health");

    const session = await client.createSession({
      directory: "/home/agent/workspaces/c1",
      model: { providerID: "anthropic", id: "claude" },
    });
    expect(session.id).toBe("ses_1");
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      location: { directory: "/home/agent/workspaces/c1" },
      model: { providerID: "anthropic", id: "claude" },
    });

    const prompt = await client.prompt("ses_1", "Tony: hi");
    expect(prompt.messageID).toBe("msg_1");
    expect(JSON.parse(calls[2].init.body as string)).toEqual({
      prompt: { text: "Tony: hi" },
      delivery: "queue",
    });

    expect(await client.listModels()).toEqual([
      { providerID: "anthropic", id: "claude", name: "Claude" },
    ]);

    const events: unknown[] = [];
    await client.subscribe("ses_1", (e) => events.push(e), { after: 3 });
    expect(calls.at(-1)!.url).toBe("http://10.0.0.5:4096/api/session/ses_1/event?after=3");
    expect(events).toEqual([
      { type: "step.started", seq: 1, messageID: "m" },
      { type: "text.delta", seq: 2, messageID: "m", textID: "t", delta: "Hello" },
    ]);

    await expect(client.interrupt("ses_2")).rejects.toThrow(OpencodeError);
    await expect(client.interrupt("ses_2")).rejects.toThrow("404: nope");
    expect(
      await createOpencodeClient({ baseUrl: "http://x", password: "p" }, async () => {
        throw new Error("ECONNREFUSED");
      }).health()
    ).toBe(false);
  });
});
