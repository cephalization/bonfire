/**
 * Terminal Component Tests
 *
 * Tests for the Terminal component mounting/unmounting behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { Terminal } from "./Terminal";

// Track mock instances
let terminalInstances: Array<{
  write: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
}> = [];

let wsInstances: Array<{
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}> = [];

// Mock ghostty-web
vi.mock("ghostty-web", () => ({
  init: async () => {},
  Terminal: class MockTerminal {
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onResize: ReturnType<typeof vi.fn>;

    constructor() {
      this.write = vi.fn(() => {});
      this.dispose = vi.fn(() => {});
      this.focus = vi.fn(() => {});
      this.resize = vi.fn(() => {});
      this.open = vi.fn(() => {});
      this.onData = vi.fn(() => ({ dispose: () => {} }));
      this.onResize = vi.fn(() => ({ dispose: () => {} }));
      terminalInstances.push(this);
    }
  },
}));

// Mock partysocket
vi.mock("partysocket", () => ({
  WebSocket: class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 1; // OPEN
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;

    constructor() {
      this.send = vi.fn(() => {});
      this.close = vi.fn(() => {});
      this.addEventListener = vi.fn(() => {});
      wsInstances.push(this);
    }
  },
}));

describe("Terminal Component", () => {
  beforeEach(() => {
    // Reset instances
    terminalInstances = [];
    wsInstances = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders terminal container", async () => {
    const { container } = render(<Terminal vmId="test-vm-123" />);

    await waitFor(() => {
      const terminalContainer = container.querySelector('[data-testid="terminal-container"]');
      expect(terminalContainer).toBeTruthy();
    });
  });

  it("initializes ghostty terminal on mount", async () => {
    render(<Terminal vmId="test-vm-123" />);

    await waitFor(() => {
      // The terminal.open should have been called
      expect(terminalInstances.length).toBeGreaterThan(0);
      expect(terminalInstances[0].open).toHaveBeenCalled();
    });
  });

  it("creates WebSocket connection", async () => {
    render(<Terminal vmId="test-vm-456" />);

    await waitFor(() => {
      expect(wsInstances.length).toBeGreaterThan(0);
    });
  });

  it("disposes terminal on unmount", async () => {
    const { unmount } = render(<Terminal vmId="test-vm-123" />);

    await waitFor(() => {
      expect(terminalInstances.length).toBeGreaterThan(0);
    });

    unmount();

    // Should dispose the terminal
    expect(terminalInstances[0].dispose).toHaveBeenCalled();
  });

  it("closes WebSocket on unmount", async () => {
    const { unmount } = render(<Terminal vmId="test-vm-123" />);

    await waitFor(() => {
      expect(wsInstances.length).toBeGreaterThan(0);
    });

    unmount();

    // Should close the WebSocket
    expect(wsInstances[0].close).toHaveBeenCalled();
  });

  it("registers WebSocket event listeners", async () => {
    render(<Terminal vmId="test-vm-123" />);

    await waitFor(() => {
      expect(wsInstances.length).toBeGreaterThan(0);
    });

    // Should register open, message, close, error listeners
    expect(wsInstances[0].addEventListener.mock.calls.length).toBe(4);
  });

  it("registers terminal event handlers", async () => {
    render(<Terminal vmId="test-vm-123" />);

    await waitFor(() => {
      expect(terminalInstances.length).toBeGreaterThan(0);
    });

    // Should register data and resize handlers
    expect(terminalInstances[0].onData).toHaveBeenCalled();
    expect(terminalInstances[0].onResize).toHaveBeenCalled();
  });
});
