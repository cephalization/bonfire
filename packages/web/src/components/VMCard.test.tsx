import "../../test-setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VMCard } from "./VMCard";
import type { VM } from "@/lib/api";

function createMockVM(overrides: Partial<VM> = {}): VM {
  return {
    id: "vm-123",
    name: "test-vm",
    status: "running",
    vcpus: 2,
    memoryMib: 1024,
    imageId: "img-1",
    pid: 12345,
    socketPath: "/tmp/test.sock",
    tapDevice: "tap0",
    macAddress: "00:00:00:00:00:01",
    ipAddress: "10.0.100.2",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRouter(component: React.ReactNode) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

describe("VMCard", () => {
  beforeEach(() => {
    cleanup();
  });

  describe("Rendering", () => {
    it("renders VM name", () => {
      const vm = createMockVM({ name: "my-awesome-vm" });
      const { getByText } = renderWithRouter(<VMCard vm={vm} />);

      expect(getByText("my-awesome-vm")).toBeTruthy();
    });

    it("renders VM specs", () => {
      const vm = createMockVM({ vcpus: 4, memoryMib: 2048 });
      const { getByText } = renderWithRouter(<VMCard vm={vm} />);

      expect(getByText("4 vCPUs · 2048 MB")).toBeTruthy();
    });

    it("renders single vCPU correctly", () => {
      const vm = createMockVM({ vcpus: 1, memoryMib: 512 });
      const { getByText } = renderWithRouter(<VMCard vm={vm} />);

      expect(getByText("1 vCPU · 512 MB")).toBeTruthy();
    });

    it("renders IP address when available", () => {
      const vm = createMockVM({ ipAddress: "10.0.100.5", status: "running" });
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} />);

      expect(getByTestId("vm-ip").textContent).toBe("IP: 10.0.100.5");
    });

    it("shows starting message when running but no IP", () => {
      const vm = createMockVM({ ipAddress: null, status: "running" });
      const { getByText } = renderWithRouter(<VMCard vm={vm} />);

      expect(getByText("Starting...")).toBeTruthy();
    });
  });

  describe("Status badges", () => {
    it("shows green badge for running status", () => {
      const vm = createMockVM({ status: "running" });
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} />);

      const badge = getByTestId("vm-status-badge");
      expect(badge.textContent).toBe("Running");
      expect(badge.className).toContain("bg-green-500/15");
    });

    it("shows gray badge for stopped status", () => {
      const vm = createMockVM({ status: "stopped" });
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} />);

      const badge = getByTestId("vm-status-badge");
      expect(badge.textContent).toBe("Stopped");
      expect(badge.className).toContain("bg-gray-500/15");
    });

    it("shows yellow badge for creating status", () => {
      const vm = createMockVM({ status: "creating" });
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} />);

      const badge = getByTestId("vm-status-badge");
      expect(badge.textContent).toBe("Creating");
      expect(badge.className).toContain("bg-yellow-500/15");
    });

    it("shows red badge for error status", () => {
      const vm = createMockVM({ status: "error" });
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} />);

      const badge = getByTestId("vm-status-badge");
      expect(badge.textContent).toBe("Error");
    });
  });

  describe("Action buttons", () => {
    it("shows Start button for stopped VM", () => {
      const vm = createMockVM({ status: "stopped" });
      const onStart = vi.fn(() => {});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} onStart={onStart} />);

      expect(getByTestId("vm-start-btn")).toBeTruthy();
    });

    it("does not show Start button for running VM", () => {
      const vm = createMockVM({ status: "running" });
      const onStart = vi.fn(() => {});
      const { queryByTestId } = renderWithRouter(<VMCard vm={vm} onStart={onStart} />);

      expect(queryByTestId("vm-start-btn")).toBeNull();
    });

    it("shows Stop button for running VM", () => {
      const vm = createMockVM({ status: "running" });
      const onStop = vi.fn(() => {});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} onStop={onStop} />);

      expect(getByTestId("vm-stop-btn")).toBeTruthy();
    });

    it("does not show Stop button for stopped VM", () => {
      const vm = createMockVM({ status: "stopped" });
      const onStop = vi.fn(() => {});
      const { queryByTestId } = renderWithRouter(<VMCard vm={vm} onStop={onStop} />);

      expect(queryByTestId("vm-stop-btn")).toBeNull();
    });

    it("shows Delete button when onDelete is provided", () => {
      const vm = createMockVM({});
      const onDelete = vi.fn(() => {});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} onDelete={onDelete} />);

      expect(getByTestId("vm-delete-btn")).toBeTruthy();
    });

    it("does not show Delete button when onDelete is not provided", () => {
      const vm = createMockVM({});
      const { queryByTestId } = renderWithRouter(<VMCard vm={vm} />);

      expect(queryByTestId("vm-delete-btn")).toBeNull();
    });

    it("always shows Terminal button", () => {
      const vm = createMockVM({});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} />);

      expect(getByTestId("vm-terminal-btn")).toBeTruthy();
    });
  });

  describe("Click handlers", () => {
    it("calls onStart when Start button is clicked", () => {
      const vm = createMockVM({ status: "stopped" });
      const onStart = vi.fn(() => {});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} onStart={onStart} />);

      fireEvent.click(getByTestId("vm-start-btn"));
      expect(onStart).toHaveBeenCalledWith("vm-123");
    });

    it("calls onStop when Stop button is clicked", () => {
      const vm = createMockVM({ status: "running" });
      const onStop = vi.fn(() => {});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} onStop={onStop} />);

      fireEvent.click(getByTestId("vm-stop-btn"));
      expect(onStop).toHaveBeenCalledWith("vm-123");
    });

    it("calls onDelete when Delete button is clicked", () => {
      const vm = createMockVM({});
      const onDelete = vi.fn(() => {});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} onDelete={onDelete} />);

      fireEvent.click(getByTestId("vm-delete-btn"));
      expect(onDelete).toHaveBeenCalledWith("vm-123");
    });
  });

  describe("Loading state", () => {
    it("applies opacity and disables interaction when loading", () => {
      const vm = createMockVM({});
      const { getByTestId } = renderWithRouter(<VMCard vm={vm} isLoading={true} />);

      const card = getByTestId("vm-card-vm-123");
      expect(card.className).toContain("opacity-60");
      expect(card.className).toContain("pointer-events-none");
    });
  });
});
