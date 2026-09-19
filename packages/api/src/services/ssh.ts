/**
 * SSH Service
 *
 * Abstracts SSH connections for VM bootstrap operations.
 * Provides a clean interface for connecting to VMs and executing commands.
 */

import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";

export interface SSHConfig {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  password?: string;
}

export interface SSHConnection {
  client: Client;
  isConnected: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ShellOptions {
  cols: number;
  rows: number;
  term?: string;
}

/**
 * An interactive PTY-backed shell on a VM.
 *
 * This is the transport behind the browser terminal: bytes in both
 * directions, plus window-size changes so full-screen programs render
 * at the client's dimensions.
 */
export interface SSHShellSession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onData(handler: (chunk: string) => void): void;
  onClose(handler: () => void): void;
}

export interface SSHService {
  connect(config: SSHConfig): Promise<SSHConnection>;
  exec(conn: SSHConnection, command: string): Promise<ExecResult>;
  shell(conn: SSHConnection, options: ShellOptions): Promise<SSHShellSession>;
  disconnect(conn: SSHConnection): Promise<void>;
  testConnection(config: SSHConfig, timeoutMs?: number): Promise<boolean>;
}

/**
 * Real SSH implementation using ssh2
 */
export class RealSSHService implements SSHService {
  async connect(config: SSHConfig): Promise<SSHConnection> {
    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on("ready", () => {
        resolve({ client, isConnected: true });
      });

      client.on("error", (err) => {
        reject(err);
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
      };

      if (config.privateKey) {
        connectConfig.privateKey = config.privateKey;
      } else if (config.password) {
        connectConfig.password = config.password;
      }

      client.connect(connectConfig);
    });
  }

  async exec(conn: SSHConnection, command: string): Promise<ExecResult> {
    if (!conn.isConnected) {
      throw new Error("SSH connection is not active");
    }

    return new Promise((resolve, reject) => {
      conn.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("close", (code: number) => {
          resolve({ stdout, stderr, code });
        });

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  async shell(conn: SSHConnection, options: ShellOptions): Promise<SSHShellSession> {
    if (!conn.isConnected) {
      throw new Error("SSH connection is not active");
    }

    return new Promise((resolve, reject) => {
      conn.client.shell(
        {
          term: options.term ?? "xterm-256color",
          cols: options.cols,
          rows: options.rows,
        },
        (err, stream) => {
          if (err) {
            reject(err);
            return;
          }

          let closed = false;

          resolve({
            write(data: string) {
              if (!closed) stream.write(data);
            },
            resize(cols: number, rows: number) {
              if (closed) return;
              // ssh2 wants (rows, cols, height, width); pixel dimensions are
              // unused by the remote pty, so 0 is fine.
              stream.setWindow(rows, cols, 0, 0);
            },
            close() {
              if (closed) return;
              closed = true;
              stream.end();
            },
            onData(handler: (chunk: string) => void) {
              stream.on("data", (data: Buffer) => handler(data.toString("utf8")));
              // A pty merges stderr into the main channel, but guard anyway:
              // some servers still open the stderr channel.
              stream.stderr?.on("data", (data: Buffer) => handler(data.toString("utf8")));
            },
            onClose(handler: () => void) {
              stream.on("close", () => {
                closed = true;
                handler();
              });
            },
          });
        }
      );
    });
  }

  async disconnect(conn: SSHConnection): Promise<void> {
    if (conn.isConnected) {
      conn.client.end();
      conn.isConnected = false;
    }
  }

  async testConnection(config: SSHConfig, timeoutMs: number = 5000): Promise<boolean> {
    const client = new Client();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.end();
        resolve(false);
      }, timeoutMs);

      client.on("ready", () => {
        clearTimeout(timeout);
        client.end();
        resolve(true);
      });

      client.on("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
      };

      if (config.privateKey) {
        connectConfig.privateKey = config.privateKey;
      } else if (config.password) {
        connectConfig.password = config.password;
      }

      client.connect(connectConfig);
    });
  }
}

/**
 * Mock SSH service for testing
 */
export interface MockShellSession extends SSHShellSession {
  /** Everything the bridge has written toward the VM. */
  written: string[];
  /** Every resize the bridge has requested. */
  resizes: Array<{ cols: number; rows: number }>;
  /** True once close() has been called or the shell has ended. */
  closed: boolean;
  /** Simulate output arriving from the VM. */
  emitData(chunk: string): void;
  /** Simulate the remote shell exiting. */
  emitClose(): void;
}

export interface MockSSHService extends SSHService {
  calls: {
    connect: Array<{ config: SSHConfig }>;
    exec: Array<{ conn: SSHConnection; command: string }>;
    shell: Array<{ conn: SSHConnection; options: ShellOptions }>;
    disconnect: Array<{ conn: SSHConnection }>;
    testConnection: Array<{ config: SSHConfig; timeoutMs?: number }>;
  };
  /** The shells handed out by shell(), in order. */
  shells: MockShellSession[];
  clearCalls(): void;
  setCommandResponse(pattern: RegExp, response: ExecResult): void;
  setConnectionResult(shouldSucceed: boolean): void;
  setShellResult(shouldSucceed: boolean): void;
}

export function createMockSSHService(): MockSSHService {
  const calls = {
    connect: [] as Array<{ config: SSHConfig }>,
    exec: [] as Array<{ conn: SSHConnection; command: string }>,
    shell: [] as Array<{ conn: SSHConnection; options: ShellOptions }>,
    disconnect: [] as Array<{ conn: SSHConnection }>,
    testConnection: [] as Array<{ config: SSHConfig; timeoutMs?: number }>,
  };

  const shells: MockShellSession[] = [];
  let commandResponses = new Map<RegExp, ExecResult>();
  let shouldConnectSucceed = true;
  let shouldShellSucceed = true;

  const defaultSuccessResponse: ExecResult = {
    stdout: "",
    stderr: "",
    code: 0,
  };

  const service: MockSSHService = {
    async connect(config: SSHConfig): Promise<SSHConnection> {
      calls.connect.push({ config });

      if (!shouldConnectSucceed) {
        throw new Error("Connection failed");
      }

      return {
        client: {} as Client,
        isConnected: true,
      };
    },

    async exec(conn: SSHConnection, command: string): Promise<ExecResult> {
      calls.exec.push({ conn, command });

      // Check if there's a matching response pattern
      for (const [pattern, response] of commandResponses) {
        if (pattern.test(command)) {
          return response;
        }
      }

      return defaultSuccessResponse;
    },

    async shell(conn: SSHConnection, options: ShellOptions): Promise<SSHShellSession> {
      calls.shell.push({ conn, options });

      if (!shouldShellSucceed) {
        throw new Error("Failed to open shell");
      }

      const dataHandlers: Array<(chunk: string) => void> = [];
      const closeHandlers: Array<() => void> = [];

      const session: MockShellSession = {
        written: [],
        resizes: [],
        closed: false,
        write(data: string) {
          session.written.push(data);
        },
        resize(cols: number, rows: number) {
          session.resizes.push({ cols, rows });
        },
        close() {
          session.closed = true;
        },
        onData(handler) {
          dataHandlers.push(handler);
        },
        onClose(handler) {
          closeHandlers.push(handler);
        },
        emitData(chunk: string) {
          for (const handler of dataHandlers) handler(chunk);
        },
        emitClose() {
          session.closed = true;
          for (const handler of closeHandlers) handler();
        },
      };

      shells.push(session);
      return session;
    },

    async disconnect(conn: SSHConnection): Promise<void> {
      calls.disconnect.push({ conn });
      conn.isConnected = false;
    },

    async testConnection(config: SSHConfig, timeoutMs?: number): Promise<boolean> {
      calls.testConnection.push({ config, timeoutMs });
      return shouldConnectSucceed;
    },

    get calls() {
      return calls;
    },

    get shells() {
      return shells;
    },

    clearCalls() {
      calls.connect.length = 0;
      calls.exec.length = 0;
      calls.shell.length = 0;
      calls.disconnect.length = 0;
      calls.testConnection.length = 0;
      shells.length = 0;
    },

    setCommandResponse(pattern: RegExp, response: ExecResult) {
      commandResponses.set(pattern, response);
    },

    setConnectionResult(shouldSucceed: boolean) {
      shouldConnectSucceed = shouldSucceed;
    },

    setShellResult(shouldSucceed: boolean) {
      shouldShellSucceed = shouldSucceed;
    },
  };

  return service;
}

// Default export for convenience
export const sshService: SSHService = new RealSSHService();
