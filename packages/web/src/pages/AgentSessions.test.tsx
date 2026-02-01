import "../../test-setup";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentSessionsPage } from "./AgentSessions";
import * as api from "@/lib/api";
import type { AgentSession } from "@/lib/api";

// Mock the API module
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listAgentSessions: vi.fn(),
    archiveAgentSession: vi.fn(),
    retryAgentSession: vi.fn(),
    listVMs: vi.fn(async () => []),
  };
});

function renderWithRouter(component: React.ReactNode) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

const mockSessions: AgentSession[] = [
  {
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
  },
  {
    id: "sess-2",
    userId: "user-1",
    title: null,
    repoUrl: "https://github.com/org/repo2",
    branch: null,
    vmId: "vm-2",
    workspacePath: null,
    status: "creating",
    errorMessage: null,
    createdAt: "2024-01-15T11:00:00Z",
    updatedAt: "2024-01-15T11:00:00Z",
  },
  {
    id: "sess-3",
    userId: "user-1",
    title: "Error Session",
    repoUrl: "https://github.com/org/repo3",
    branch: "develop",
    vmId: "vm-3",
    workspacePath: null,
    status: "error",
    errorMessage: "Failed to clone repository",
    createdAt: "2024-01-15T09:00:00Z",
    updatedAt: "2024-01-15T09:30:00Z",
  },
];

describe("AgentSessionsPage", () => {
  const mockListAgentSessions = vi.mocked(api.listAgentSessions);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    cleanup();
    mockListAgentSessions.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows loading state initially", () => {
    mockListAgentSessions.mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = renderWithRouter(<AgentSessionsPage />);

    expect(getByTestId("sessions-loading")).toBeTruthy();
  });

  it("shows empty state when no sessions", async () => {
    mockListAgentSessions.mockResolvedValue([]);

    const { getByTestId, getByText } = renderWithRouter(<AgentSessionsPage />);

    await waitFor(() => {
      expect(getByTestId("session-list-empty")).toBeTruthy();
    });

    expect(getByText(/no sessions yet/i)).toBeTruthy();
  });

  it("renders session list", async () => {
    mockListAgentSessions.mockResolvedValue(mockSessions);

    const { getByTestId, getByText } = renderWithRouter(<AgentSessionsPage />);

    await waitFor(() => {
      expect(getByTestId("session-list")).toBeTruthy();
    });

    expect(getByText("Test Session")).toBeTruthy();
    expect(getByText("Untitled Session")).toBeTruthy();
    expect(getByText("Error Session")).toBeTruthy();
  });

  it("displays correct status badges", async () => {
    mockListAgentSessions.mockResolvedValue(mockSessions);

    const { getByTestId } = renderWithRouter(<AgentSessionsPage />);

    await waitFor(() => {
      expect(getByTestId("session-list")).toBeTruthy();
    });

    const badges = document.querySelectorAll('[data-testid="session-status"]');
    expect(badges.length).toBe(3);
    expect(badges[0].textContent).toBe("ready");
    expect(badges[1].textContent).toBe("creating");
    expect(badges[2].textContent).toBe("error");
  });

  it("shows error message when fetch fails", async () => {
    mockListAgentSessions.mockRejectedValue(new api.BonfireAPIError("Failed to fetch", 500));

    const { getByTestId } = renderWithRouter(<AgentSessionsPage />);

    await waitFor(() => {
      expect(getByTestId("sessions-error")).toBeTruthy();
    });
  });

  it("opens create session modal when button clicked", async () => {
    mockListAgentSessions.mockResolvedValue([]);

    const { getByTestId, getByText } = renderWithRouter(<AgentSessionsPage />);

    await waitFor(() => {
      expect(getByTestId("session-list-empty")).toBeTruthy();
    });

    const newSessionBtn = getByTestId("new-session-btn");
    fireEvent.click(newSessionBtn);

    await waitFor(() => {
      expect(getByText("Create Agent Session")).toBeTruthy();
    });
  });

  it("polls for updates when there are creating sessions", async () => {
    mockListAgentSessions.mockResolvedValue([mockSessions[1]]);

    renderWithRouter(<AgentSessionsPage />);

    await waitFor(() => {
      expect(mockListAgentSessions).toHaveBeenCalledTimes(1);
    });

    // Fast-forward timers to trigger polling
    await vi.advanceTimersByTimeAsync(3000);

    // fetch should have been called again
    expect(mockListAgentSessions).toHaveBeenCalledTimes(2);
  });
});
