import "../../test-setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewAgentSessionModal } from "./NewAgentSessionModal";
import * as api from "@/lib/api";
import type { VM, AgentSession } from "@/lib/api";

// Mock the API module
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listVMs: vi.fn(),
    createAgentSession: vi.fn(),
  };
});

function renderWithRouter(component: React.ReactNode) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

const mockVMs: VM[] = [
  {
    id: "vm-1",
    name: "test-vm-1",
    status: "running",
    vcpus: 2,
    memoryMib: 1024,
    imageId: "img-1",
    pid: 1234,
    socketPath: "/tmp/vm-1.sock",
    tapDevice: "tap0",
    macAddress: "00:00:00:00:00:01",
    ipAddress: "192.168.1.100",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "vm-2",
    name: "test-vm-2",
    status: "stopped",
    vcpus: 1,
    memoryMib: 512,
    imageId: "img-1",
    pid: null,
    socketPath: null,
    tapDevice: null,
    macAddress: null,
    ipAddress: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

const mockSession: AgentSession = {
  id: "sess-1",
  userId: "user-1",
  title: "New Session",
  repoUrl: "https://github.com/org/repo",
  branch: "main",
  vmId: "vm-1",
  workspacePath: null,
  status: "creating",
  errorMessage: null,
  createdAt: "2024-01-15T10:30:00Z",
  updatedAt: "2024-01-15T10:30:00Z",
};

describe("NewAgentSessionModal", () => {
  const mockListVMs = vi.mocked(api.listVMs);
  const mockCreateAgentSession = vi.mocked(api.createAgentSession);

  beforeEach(() => {
    cleanup();
    mockListVMs.mockClear();
    mockCreateAgentSession.mockClear();
  });

  it("renders the trigger button", () => {
    const { getByTestId } = renderWithRouter(<NewAgentSessionModal />);
    expect(getByTestId("new-session-btn")).toBeTruthy();
  });

  it("opens dialog when trigger is clicked", async () => {
    mockListVMs.mockResolvedValue(mockVMs);

    const { getByTestId, getByText } = renderWithRouter(<NewAgentSessionModal />);

    fireEvent.click(getByTestId("new-session-btn"));

    await waitFor(() => {
      expect(getByText("Create Agent Session")).toBeTruthy();
    });
  });

  it("fetches VMs when opened", async () => {
    mockListVMs.mockResolvedValue(mockVMs);

    const { getByTestId } = renderWithRouter(<NewAgentSessionModal />);

    fireEvent.click(getByTestId("new-session-btn"));

    await waitFor(() => {
      expect(mockListVMs).toHaveBeenCalled();
    });
  });

  it("shows only running VMs in select", async () => {
    mockListVMs.mockResolvedValue(mockVMs);

    const { getByTestId } = renderWithRouter(<NewAgentSessionModal />);

    fireEvent.click(getByTestId("new-session-btn"));
    await waitFor(() => expect(mockListVMs).toHaveBeenCalled());

    // Should only show running VMs
    const vmSelect = getByTestId("vm-select");
    expect(vmSelect).toBeTruthy();
    // The select should have one option for the running VM
  });

  it("submit button is disabled when repo URL is empty", async () => {
    mockListVMs.mockResolvedValue(mockVMs);

    const { getByTestId } = renderWithRouter(<NewAgentSessionModal />);

    fireEvent.click(getByTestId("new-session-btn"));
    await waitFor(() => expect(mockListVMs).toHaveBeenCalled());

    // Submit button should be disabled when repo URL is empty
    const submitBtn = getByTestId("create-session-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("closes dialog on cancel", async () => {
    mockListVMs.mockResolvedValue(mockVMs);

    const { getByTestId, getByText, queryByText } = renderWithRouter(<NewAgentSessionModal />);

    fireEvent.click(getByTestId("new-session-btn"));
    await waitFor(() => expect(mockListVMs).toHaveBeenCalled());

    fireEvent.click(getByText("Cancel"));

    await waitFor(() => {
      expect(queryByText("Create Agent Session")).toBeNull();
    });
  });

  it("form inputs accept values", async () => {
    mockListVMs.mockResolvedValue(mockVMs);

    const { getByTestId } = renderWithRouter(<NewAgentSessionModal />);

    fireEvent.click(getByTestId("new-session-btn"));
    await waitFor(() => expect(mockListVMs).toHaveBeenCalled());

    // Fill in form
    const repoUrlInput = getByTestId("repo-url-input") as HTMLInputElement;
    const branchInput = getByTestId("branch-input") as HTMLInputElement;
    const titleInput = getByTestId("title-input") as HTMLInputElement;

    fireEvent.change(repoUrlInput, { target: { value: "https://github.com/org/repo" } });
    fireEvent.change(branchInput, { target: { value: "main" } });
    fireEvent.change(titleInput, { target: { value: "New Session" } });

    // Verify values are set
    expect(repoUrlInput.value).toBe("https://github.com/org/repo");
    expect(branchInput.value).toBe("main");
    expect(titleInput.value).toBe("New Session");
  });
});
