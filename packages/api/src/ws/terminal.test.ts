import { describe, it, expect, beforeEach } from "vitest";
import { bridgeShellToWebSocket, authenticateUpgrade } from "./terminal";
import { createMockSSHService, type MockSSHService } from "../services/ssh";
import { createTerminalTicketStore } from "../lib/terminal-tickets";
import { config as appConfig } from "../lib/config";

/**
 * Minimal stand-in for a `ws` WebSocket: records what the bridge sends and
 * lets a test drive the client side.
 */
function createFakeSocket() {
  const handlers = new Map<string, Array<(arg?: unknown) => void>>();
  const sent: string[] = [];
  let closed = false;

  return {
    sent,
    get closed() {
      return closed;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      closed = true;
    },
    on(event: string, handler: (arg?: unknown) => void) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    /** Simulate the client sending a frame. */
    emit(event: string, arg?: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(arg);
    },
    /** Control frames the bridge sent, parsed. */
    controlMessages() {
      return sent
        .filter((m) => m.startsWith("{"))
        .map((m) => {
          try {
            return JSON.parse(m);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
    /** Raw terminal output the bridge forwarded. */
    output() {
      return sent.filter((m) => !m.startsWith("{")).join("");
    },
  };
}

describe("authenticateUpgrade", () => {
  const vmId = "vm-1";

  it("accepts a correct X-API-Key header", () => {
    const store = createTerminalTicketStore();
    const headers = new Headers({ "X-API-Key": appConfig.apiKey });

    expect(
      authenticateUpgrade(new URL("http://x/api/vms/vm-1/terminal"), headers, vmId, store)
    ).toBe(true);
  });

  it("rejects a wrong X-API-Key header", () => {
    const store = createTerminalTicketStore();
    const headers = new Headers({ "X-API-Key": "nope" });

    expect(
      authenticateUpgrade(new URL("http://x/api/vms/vm-1/terminal"), headers, vmId, store)
    ).toBe(false);
  });

  it("accepts a valid ticket in the query string", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue(vmId);
    const url = new URL(`http://x/api/vms/vm-1/terminal?ticket=${ticket}`);

    expect(authenticateUpgrade(url, new Headers(), vmId, store)).toBe(true);
  });

  it("rejects a ticket minted for a different VM", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue("vm-other");
    const url = new URL(`http://x/api/vms/vm-1/terminal?ticket=${ticket}`);

    expect(authenticateUpgrade(url, new Headers(), vmId, store)).toBe(false);
  });

  it("rejects a replayed ticket", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue(vmId);
    const url = new URL(`http://x/api/vms/vm-1/terminal?ticket=${ticket}`);

    expect(authenticateUpgrade(url, new Headers(), vmId, store)).toBe(true);
    expect(authenticateUpgrade(url, new Headers(), vmId, store)).toBe(false);
  });

  it("rejects a handshake with neither header nor ticket", () => {
    const store = createTerminalTicketStore();

    expect(
      authenticateUpgrade(new URL("http://x/api/vms/vm-1/terminal"), new Headers(), vmId, store)
    ).toBe(false);
  });
});

describe("bridgeShellToWebSocket", () => {
  let ssh: MockSSHService;

  beforeEach(() => {
    ssh = createMockSSHService();
  });

  const bridge = (socket: ReturnType<typeof createFakeSocket>) =>
    bridgeShellToWebSocket(socket as never, {
      host: "10.0.100.5",
      privateKey: "PRIVATE_KEY",
      sshService: ssh,
    });

  it("connects over SSH as the agent user with the VM's key", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    expect(ssh.calls.connect).toHaveLength(1);
    expect(ssh.calls.connect[0].config).toMatchObject({
      host: "10.0.100.5",
      username: "agent",
      privateKey: "PRIVATE_KEY",
    });
  });

  it("opens a pty and announces ready before any output", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    expect(ssh.calls.shell).toHaveLength(1);
    expect(socket.sent[0]).toBe(JSON.stringify({ ready: true }));
  });

  it("forwards shell output to the client", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    ssh.shells[0].emitData("hello from the vm");

    expect(socket.output()).toBe("hello from the vm");
  });

  it("forwards client keystrokes to the shell", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    socket.emit("message", "ls -la\n");

    expect(ssh.shells[0].written).toEqual(["ls -la\n"]);
  });

  it("applies a resize control message instead of typing it", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    socket.emit("message", JSON.stringify({ resize: { cols: 120, rows: 40 } }));

    expect(ssh.shells[0].resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(ssh.shells[0].written).toEqual([]);
  });

  it("treats a non-resize JSON frame as keystrokes", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    socket.emit("message", '{"not":"a resize"}');

    expect(ssh.shells[0].written).toEqual(['{"not":"a resize"}']);
    expect(ssh.shells[0].resizes).toEqual([]);
  });

  it("passes a bare opening brace through as input", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    socket.emit("message", "{");

    expect(ssh.shells[0].written).toEqual(["{"]);
  });

  it("reports an SSH connection failure to the client and closes", async () => {
    ssh.setConnectionResult(false);
    const socket = createFakeSocket();
    await bridge(socket);

    expect(socket.controlMessages()).toEqual([{ error: "Connection failed" }]);
    expect(socket.closed).toBe(true);
  });

  it("reports a shell-open failure to the client and closes", async () => {
    ssh.setShellResult(false);
    const socket = createFakeSocket();
    await bridge(socket);

    expect(socket.controlMessages()).toEqual([{ error: "Failed to open shell" }]);
    expect(socket.closed).toBe(true);
  });

  it("never announces ready when the shell fails to open", async () => {
    ssh.setShellResult(false);
    const socket = createFakeSocket();
    await bridge(socket);

    expect(socket.controlMessages().some((m) => m.ready)).toBe(false);
  });

  it("closes the websocket when the remote shell exits", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    ssh.shells[0].emitClose();

    expect(socket.closed).toBe(true);
  });

  it("tears down the SSH connection when the client disconnects", async () => {
    const socket = createFakeSocket();
    await bridge(socket);

    socket.emit("close");

    expect(ssh.shells[0].closed).toBe(true);
    expect(ssh.calls.disconnect).toHaveLength(1);
  });

  it("releases the VM's terminal slot exactly once", async () => {
    const socket = createFakeSocket();
    let released = 0;

    await bridgeShellToWebSocket(socket as never, {
      host: "10.0.100.5",
      privateKey: "PRIVATE_KEY",
      sshService: ssh,
      onClosed: () => {
        released += 1;
      },
    });

    // The shell exiting and the client hanging up both trigger teardown.
    ssh.shells[0].emitClose();
    socket.emit("close");

    expect(released).toBe(1);
  });

  it("releases the terminal slot when SSH never connects", async () => {
    ssh.setConnectionResult(false);
    const socket = createFakeSocket();
    let released = 0;

    await bridgeShellToWebSocket(socket as never, {
      host: "10.0.100.5",
      privateKey: "PRIVATE_KEY",
      sshService: ssh,
      onClosed: () => {
        released += 1;
      },
    });

    expect(released).toBe(1);
  });
});
