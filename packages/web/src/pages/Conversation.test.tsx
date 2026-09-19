import "../../test-setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Conversation, summarizeToolInput, upsertMessage } from "./Conversation";
import type { ConversationDetail, ConversationEvent, ConversationMessage } from "@/lib/api";

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ data: { user: { id: "user-1", name: "Tony", email: "tony@example.com" } } }),
  authClient: { useActiveOrganization: () => ({ data: { id: "org-1", name: "Acme" } }) },
}));

const api = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  postMessage: vi.fn(),
  subscribeToConversation: vi.fn(),
  listVMs: vi.fn(),
  attachAgent: vi.fn(),
  detachAgent: vi.fn(),
  interruptAgent: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

function detail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: "c1",
    organizationId: "org-1",
    title: "Planning",
    createdById: "user-1",
    agentVmId: null,
    agentModel: null,
    agentStatus: "offline",
    agentError: null,
    agentVmName: null,
    lastMessageAt: null,
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    participants: [
      {
        userId: "user-1",
        name: "Tony",
        email: "tony@example.com",
        joinedAt: "2026-09-19T10:00:00.000Z",
      },
      {
        userId: "user-2",
        name: "Bob",
        email: "bob@example.com",
        joinedAt: "2026-09-19T10:01:00.000Z",
      },
    ],
    ...overrides,
  };
}

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "m1",
    conversationId: "c1",
    authorKind: "user",
    authorId: "user-2",
    authorName: "Bob",
    body: "Hello from Bob",
    parts: [],
    status: "complete",
    createdAt: "2026-09-19T10:02:00.000Z",
    updatedAt: "2026-09-19T10:02:00.000Z",
    ...overrides,
  };
}

let emit: (event: ConversationEvent) => void = () => {};
const unsubscribe = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/conversations/c1"]}>
      <Routes>
        <Route path="/conversations/:id" element={<Conversation />} />
        <Route path="/conversations" element={<p>Back at the list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Conversation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    api.subscribeToConversation.mockImplementation((_id: string, handler: typeof emit) => {
      emit = handler;
      return unsubscribe;
    });
    api.getConversation.mockResolvedValue(detail());
    api.listMessages.mockResolvedValue([
      message(),
      message({
        id: "m2",
        authorKind: "agent",
        authorId: null,
        authorName: "Agent",
        body: "Let me check. Done.",
        parts: [
          { type: "text", id: "t1", text: "Let me check." },
          {
            type: "tool",
            callId: "c1",
            name: "bash",
            status: "completed",
            input: { command: "ls -la" },
            output: "README.md",
          },
          { type: "text", id: "t2", text: " Done." },
        ],
        createdAt: "2026-09-19T10:03:00.000Z",
      }),
      message({
        id: "m3",
        authorKind: "system",
        authorId: null,
        authorName: "Bonfire",
        body: "Agent attached.",
        createdAt: "2026-09-19T10:04:00.000Z",
      }),
    ]);
  });

  it("renders the history with people, agent parts and system notes", async () => {
    const { findByText, getByText, getByRole } = renderPage();
    expect(await findByText("Planning")).toBeTruthy();
    expect(getByText(/Tony, Bob/)).toBeTruthy();
    expect(getByText("Hello from Bob")).toBeTruthy();
    expect(getByText("Let me check.")).toBeTruthy();
    expect(getByText("bash")).toBeTruthy();
    expect(getByText("ls -la")).toBeTruthy();
    expect(getByText("Agent attached.")).toBeTruthy();
    expect(getByRole("button", { name: /add agent/i })).toBeTruthy();
    expect(api.subscribeToConversation).toHaveBeenCalledWith(
      "c1",
      expect.any(Function),
      expect.anything()
    );

    // Tool output is behind a toggle.
    fireEvent.click(getByText("bash").closest("button")!);
    expect(getByText("README.md")).toBeTruthy();
  });

  it("applies live events and sends messages with Enter", async () => {
    api.postMessage.mockResolvedValue(
      message({ id: "m9", authorId: "user-1", authorName: "Tony", body: "hi all" })
    );
    // The agent's VM changes below, which makes the page re-fetch the detail.
    api.getConversation
      .mockResolvedValueOnce(detail())
      .mockResolvedValue(detail({ agentStatus: "busy", agentVmId: "vm-1", agentVmName: "box" }));
    const { findByText, getByLabelText, getByText, queryByText } = renderPage();
    await findByText("Hello from Bob");

    act(() => {
      emit({ type: "message.created", message: message({ id: "m4", body: "Anyone there?" }) });
      emit({
        type: "message.updated",
        message: message({
          id: "m5",
          authorKind: "agent",
          authorId: null,
          authorName: "Agent",
          body: "",
          status: "streaming",
          parts: [],
        }),
      });
      emit({
        type: "conversation.updated",
        conversation: { ...detail(), agentStatus: "busy", agentVmId: "vm-1" },
      });
    });
    expect(getByText("Anyone there?")).toBeTruthy();
    expect(getByText("Thinking…")).toBeTruthy();
    expect(getByText("Agent working")).toBeTruthy();
    expect(getByText("Stop")).toBeTruthy();
    expect(queryByText(/add agent/i)).toBeNull();

    const textarea = getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hi all" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith("c1", "hi all"));
    expect(await findByText("hi all")).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("");

    fireEvent.click(getByText("Stop"));
    await waitFor(() => expect(api.interruptAgent).toHaveBeenCalledWith("c1"));
  });

  it("shows the agent error banner and can remove the agent", async () => {
    api.getConversation.mockResolvedValue(
      detail({
        agentStatus: "error",
        agentError: "Provider request failed with HTTP 401",
        agentVmId: "vm-1",
        agentVmName: "box",
      })
    );
    api.detachAgent.mockResolvedValue(detail());
    const { findByText, getByText } = renderPage();
    expect(await findByText("Provider request failed with HTTP 401")).toBeTruthy();
    expect(getByText(/agent in box/)).toBeTruthy();
    fireEvent.click(getByText("Remove agent"));
    await waitFor(() => expect(api.detachAgent).toHaveBeenCalledWith("c1"));
  });

  it("closes the event stream on unmount", async () => {
    const { findByText, unmount } = renderPage();
    await findByText("Planning");
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("upsertMessage", () => {
  it("inserts in order and replaces by id", () => {
    const a = message({ id: "a", createdAt: "2026-01-01T00:00:02.000Z" });
    const b = message({ id: "b", createdAt: "2026-01-01T00:00:01.000Z" });
    const list = upsertMessage(upsertMessage([], a), b);
    expect(list.map((m) => m.id)).toEqual(["b", "a"]);
    const updated = upsertMessage(list, { ...a, body: "edited" });
    expect(updated.map((m) => m.body)).toEqual([b.body, "edited"]);
    expect(updated).toHaveLength(2);
  });
});

describe("summarizeToolInput", () => {
  it("picks the most descriptive field and truncates", () => {
    expect(summarizeToolInput({ command: "ls" })).toBe("ls");
    expect(summarizeToolInput({ filePath: "/a/b.ts", other: 1 })).toBe("/a/b.ts");
    expect(summarizeToolInput({ command: "x".repeat(100) })).toBe(`${"x".repeat(77)}…`);
    expect(summarizeToolInput("nope")).toBe("");
    expect(summarizeToolInput({ count: 3 })).toBe("");
  });
});
