import "../../test-setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Conversations } from "./Conversations";
import type { Conversation } from "@/lib/api";

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ data: { user: { id: "user-1", name: "Tony", email: "tony@example.com" } } }),
  authClient: { useActiveOrganization: () => ({ data: { id: "org-1", name: "Acme" } }) },
}));

const api = vi.hoisted(() => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    organizationId: "org-1",
    title: "Planning",
    createdById: "user-1",
    agentVmId: null,
    agentModel: null,
    agentStatus: "offline",
    agentError: null,
    lastMessageAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/conversations"]}>
      <Routes>
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/conversations/:id" element={<p>Opened chat</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Conversations", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an empty state", async () => {
    api.listConversations.mockResolvedValue([]);
    const { findByText } = renderPage();
    expect(await findByText("No conversations yet")).toBeTruthy();
    expect(api.listConversations).toHaveBeenCalledWith(undefined, { organizationId: "org-1" });
  });

  it("lists conversations with their agent status", async () => {
    api.listConversations.mockResolvedValue([
      conversation(),
      conversation({ id: "c2", title: "Deploy", agentStatus: "idle" }),
      conversation({ id: "c3", title: "Incident", agentStatus: "busy" }),
    ]);
    const { findByText, queryByText, getByText } = renderPage();
    expect(await findByText("Planning")).toBeTruthy();
    expect(getByText("Deploy")).toBeTruthy();
    expect(getByText("Agent ready")).toBeTruthy();
    expect(getByText("Agent working")).toBeTruthy();
    expect(queryByText("No agent")).toBeNull();
  });

  it("creates a conversation and opens it", async () => {
    api.listConversations.mockResolvedValue([]);
    api.createConversation.mockResolvedValue({ ...conversation({ id: "c9" }), participants: [] });
    const { findByText, getByLabelText, getByRole } = renderPage();
    await findByText("No conversations yet");

    fireEvent.change(getByLabelText("New conversation title"), { target: { value: "Release" } });
    fireEvent.submit(getByRole("button", { name: /new/i }).closest("form")!);

    await waitFor(() =>
      expect(api.createConversation).toHaveBeenCalledWith({
        title: "Release",
        organizationId: "org-1",
      })
    );
    expect(await findByText("Opened chat")).toBeTruthy();
  });
});
