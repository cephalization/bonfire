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

export interface SSHService {
  connect(config: SSHConfig): Promise<SSHConnection>;
  exec(conn: SSHConnection, command: string): Promise<ExecResult>;
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
export interface MockSSHService extends SSHService {
  calls: {
    connect: Array<{ config: SSHConfig }>;
    exec: Array<{ conn: SSHConnection; command: string }>;
    disconnect: Array<{ conn: SSHConnection }>;
    testConnection: Array<{ config: SSHConfig; timeoutMs?: number }>;
  };
  clearCalls(): void;
  setCommandResponse(pattern: RegExp, response: ExecResult): void;
  setConnectionResult(shouldSucceed: boolean): void;
}

export function createMockSSHService(): MockSSHService {
  const calls = {
    connect: [] as Array<{ config: SSHConfig }>,
    exec: [] as Array<{ conn: SSHConnection; command: string }>,
    disconnect: [] as Array<{ conn: SSHConnection }>,
    testConnection: [] as Array<{ config: SSHConfig; timeoutMs?: number }>,
  };

  let commandResponses = new Map<RegExp, ExecResult>();
  let shouldConnectSucceed = true;

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

    clearCalls() {
      calls.connect.length = 0;
      calls.exec.length = 0;
      calls.disconnect.length = 0;
      calls.testConnection.length = 0;
    },

    setCommandResponse(pattern: RegExp, response: ExecResult) {
      commandResponses.set(pattern, response);
    },

    setConnectionResult(shouldSucceed: boolean) {
      shouldConnectSucceed = shouldSucceed;
    },
  };

  return service;
}

// Default export for convenience
export const sshService: SSHService = new RealSSHService();
