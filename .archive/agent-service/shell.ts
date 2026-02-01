/**
 * Agent Shell Service
 *
 * Provides WebSocket/TTY stream connection to the guest agent's shell endpoint.
 * The Slicer agent exposes a shell endpoint at /vm/{hostname}/shell that
 * provides an interactive serial console without requiring SSH.
 *
 * Based on Slicer API: https://docs.slicervm.com/reference/api
 */

import type { Server, ServerWebSocket } from "bun";

export interface ShellStream {
  /** Send data to the VM shell */
  send(data: string | Uint8Array): void;
  /** Close the shell connection */
  close(): void;
  /** Set callback for receiving data from VM */
  onData(callback: (data: Uint8Array) => void): void;
  /** Set callback for connection close */
  onClose(callback: () => void): void;
  /** Set callback for errors */
  onError(callback: (error: Error) => void): void;
  /** Send resize event (if supported by agent) */
  resize?(cols: number, rows: number): void;
}

export interface ShellConnectionOptions {
  ipAddress: string;
  hostname?: string;
  port?: number;
  timeoutMs?: number;
}

export class ShellError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "ShellError";
  }
}

export class ShellConnectionError extends ShellError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "ShellConnectionError";
  }
}

/**
 * Connect to the agent's shell endpoint via WebSocket.
 *
 * The Slicer agent provides a shell endpoint at /vm/{hostname}/shell that
 * streams terminal data bidirectionally.
 */
export async function connectToShell(options: ShellConnectionOptions): Promise<ShellStream> {
  const port = options.port ?? 8080;
  const timeoutMs = options.timeoutMs ?? 30000;

  // The Slicer agent shell endpoint
  // According to Slicer docs: /vm/{hostname}/shell
  // Default hostname for Slicer systemd images is "ubuntu-fc-uvm" for Ubuntu
  const hostname = options.hostname ?? "ubuntu-fc-uvm";
  const url = `ws://${options.ipAddress}:${port}/vm/${hostname}/shell`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new ShellConnectionError(`Connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let ws: WebSocket | null = null;
    let dataCallback: ((data: Uint8Array) => void) | null = null;
    let closeCallback: (() => void) | null = null;
    let errorCallback: ((error: Error) => void) | null = null;

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        clearTimeout(timeoutId);

        const stream: ShellStream = {
          send(data: string | Uint8Array) {
            if (ws?.readyState === WebSocket.OPEN) {
              if (typeof data === "string") {
                ws.send(data);
              } else {
                ws.send(data);
              }
            }
          },

          close() {
            if (ws) {
              ws.close();
              ws = null;
            }
          },

          onData(callback) {
            dataCallback = callback;
          },

          onClose(callback) {
            closeCallback = callback;
          },

          onError(callback) {
            errorCallback = callback;
          },

          resize(cols: number, rows: number) {
            // Send resize command if agent supports it
            // Format: {"resize": {"cols": 80, "rows": 24}}
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ resize: { cols, rows } }));
            }
          },
        };

        resolve(stream);
      };

      ws.onmessage = (event) => {
        if (dataCallback) {
          let data: Uint8Array;
          if (typeof event.data === "string") {
            data = new TextEncoder().encode(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            data = new Uint8Array(event.data);
          } else if (event.data instanceof Blob) {
            // Handle Blob asynchronously
            event.data.arrayBuffer().then((buffer) => {
              if (dataCallback) {
                dataCallback(new Uint8Array(buffer));
              }
            });
            return;
          } else {
            data = new Uint8Array(event.data);
          }
          dataCallback(data);
        }
      };

      ws.onclose = () => {
        clearTimeout(timeoutId);
        if (closeCallback) {
          closeCallback();
        }
      };

      ws.onerror = (event) => {
        clearTimeout(timeoutId);
        const error = new ShellConnectionError(
          "WebSocket connection failed",
          event instanceof Error ? event : undefined
        );
        if (errorCallback) {
          errorCallback(error);
        } else {
          reject(error);
        }
      };
    } catch (error) {
      clearTimeout(timeoutId);
      reject(
        new ShellConnectionError(
          "Failed to create WebSocket connection",
          error instanceof Error ? error : undefined
        )
      );
    }
  });
}

/**
 * Factory function to create a shell connection for a VM
 */
export function createShellConnection(
  ipAddress: string,
  options?: Omit<ShellConnectionOptions, "ipAddress">
): Promise<ShellStream> {
  return connectToShell({
    ipAddress,
    ...options,
  });
}

/**
 * Parse a terminal resize message from client.
 * Supports both JSON format {"cols": 80, "rows": 24} and legacy format.
 */
export function parseResizeMessage(
  data: string | Uint8Array
): { cols: number; rows: number } | null {
  try {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const parsed = JSON.parse(text);

    if (parsed.resize) {
      return {
        cols: parsed.resize.cols ?? parsed.cols ?? 80,
        rows: parsed.resize.rows ?? parsed.rows ?? 24,
      };
    }

    if (parsed.cols !== undefined && parsed.rows !== undefined) {
      return {
        cols: parsed.cols,
        rows: parsed.rows,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a message is a resize command
 */
export function isResizeMessage(data: string | Uint8Array): boolean {
  return parseResizeMessage(data) !== null;
}

/**
 * Format output data for sending to WebSocket client.
 * Ensures consistent encoding.
 */
export function formatOutputData(data: Uint8Array | string): string {
  if (typeof data === "string") {
    return data;
  }
  return new TextDecoder().decode(data);
}

/**
 * Format input data for sending to agent.
 * Converts string input to proper format.
 */
export function formatInputData(data: string | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new TextEncoder().encode(data);
}
