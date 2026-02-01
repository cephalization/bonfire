import "../../test-setup";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AgentSessionDetailPage } from "./AgentSessionDetail";
import * as api from "@/lib/api";
import type { AgentSession } from "@/lib/api";

// Mock the API module
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getAgentSession: vi.fn(),
    retryAgentSession: vi.fn(),
  };
});

function renderWithRouter(component: React.ReactNode, { route = "/agent/sessions/sess-1" } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/agent/sessions/:id" element={component} />
      </Routes>
    </MemoryRouter>
  );
}

const mockSession: AgentSession = {
  id: "sess-1",
  userId: "user-1",
  title: "Test Session",
  repoUrl: "https://github.com/org/repo",
  branch: "main",
  vmId: "vm-1",
  workspacePath: "/workspace",
  status: "ready",
  errorMessage: null,
  createdAt: "2024-01-15T10:30:00Z",
  updatedAt: "2024-01-15T10:30:00Z",
};

describe("AgentSessionDetailPage", () => {
  const mockGetAgentSession = vi.mocked(api.getAgentSession);
  const mockRetryAgentSession = vi.mocked(api.retryAgentSession);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    cleanup();
    mockGetAgentSession.mockClear();
    mockRetryAgentSession.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows loading state initially", () => {
    mockGetAgentSession.mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = renderWithRouter(<AgentSessionDetailPage />);

    expect(getByTestId("detail-loading")).toBeTruthy();
  });

  it("renders session details when ready", async () => {
    mockGetAgentSession.mockResolvedValue(mockSession);

    const { getByTestId, getByText } = renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(getByTestId("session-title")).toBeTruthy();
    });

    expect(getByText("Test Session")).toBeTruthy();
    expect(getByTestId("session-repo")).toBeTruthy();
    expect(getByTestId("session-status").textContent).toBe("ready");
    expect(getByTestId("opencode-iframe")).toBeTruthy();
  });

  it("shows creating state when session is creating", async () => {
    mockGetAgentSession.mockResolvedValue({
      ...mockSession,
      status: "creating",
    });

    const { getByTestId } = renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(getByTestId("creating-state")).toBeTruthy();
    });
  });

  it("shows error state when session has error", async () => {
    mockGetAgentSession.mockResolvedValue({
      ...mockSession,
      status: "error",
      errorMessage: "Failed to clone repository",
    });

    const { getByTestId, getByText } = renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(getByTestId("error-state")).toBeTruthy();
    });

    expect(getByText("Session failed to start")).toBeTruthy();
    expect(getByTestId("retry-btn")).toBeTruthy();
  });

  it("shows error message when fetch fails", async () => {
    mockGetAgentSession.mockRejectedValue(new api.BonfireAPIError("Session not found", 404));

    const { getByTestId } = renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(getByTestId("detail-error")).toBeTruthy();
    });
  });

  it("polls for updates while session is creating", async () => {
    mockGetAgentSession.mockResolvedValue({
      ...mockSession,
      status: "creating",
    });

    renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(mockGetAgentSession).toHaveBeenCalledTimes(1);
    });

    // Fast-forward timers to trigger polling
    await vi.advanceTimersByTimeAsync(3000);

    // Should have polled again
    expect(mockGetAgentSession).toHaveBeenCalledTimes(2);
  });

  it("retries session when retry button clicked", async () => {
    mockGetAgentSession.mockResolvedValue({
      ...mockSession,
      status: "error",
      errorMessage: "Failed to clone repository",
    });
    mockRetryAgentSession.mockResolvedValue({
      ...mockSession,
      status: "creating",
      errorMessage: null,
    });

    const { getByTestId } = renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(getByTestId("error-state")).toBeTruthy();
    });

    const retryBtn = getByTestId("retry-btn");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockRetryAgentSession).toHaveBeenCalledWith("sess-1");
    });
  });

  it("displays untitled session correctly", async () => {
    mockGetAgentSession.mockResolvedValue({
      ...mockSession,
      title: null,
    });

    const { getByTestId } = renderWithRouter(<AgentSessionDetailPage />);

    await waitFor(() => {
      expect(getByTestId("session-title")).toBeTruthy();
    });

    expect(getByTestId("session-title").textContent).toBe("Untitled Session");
  });
});
