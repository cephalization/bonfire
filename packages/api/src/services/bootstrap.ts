/**
 * Bootstrap Service
 *
 * Handles VM bootstrap (currently disabled - serial console removed):
 * Bootstrapping requires serial console access to configure the VM and start OpenCode.
 * This functionality is temporarily unavailable pending architecture changes.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { agentSessions } from "../db/schema";
import { vms } from "../db/schema";

/**
 * OpenCode configuration structure
 */
export interface OpenCodeConfig {
  share: "disabled" | "enabled";
  permission: "allow" | "deny" | "ask";
  autoupdate: boolean;
  server: {
    port: number;
    hostname: string;
  };
}

/**
 * Generate OpenCode configuration for a session
 */
export function generateOpenCodeConfig(workspacePath: string): OpenCodeConfig {
  return {
    share: "disabled",
    permission: "allow",
    autoupdate: false,
    server: {
      port: 4096,
      hostname: "0.0.0.0",
    },
  };
}

/**
 * Serialize OpenCode config for environment variable injection
 */
export function serializeOpenCodeConfig(config: OpenCodeConfig): string {
  return JSON.stringify(config);
}

export interface BootstrapConfig {
  sessionId: string;
  repoUrl: string;
  branch?: string | null;
  vmId: string;
  vmIp: string;
  workspaceBasePath?: string;
  opencodePort?: number;
  healthPollIntervalMs?: number;
  healthPollTimeoutMs?: number;
  pipeDir?: string;
}

export interface BootstrapResult {
  success: boolean;
  workspacePath?: string;
  errorMessage?: string;
}

export interface BootstrapService {
  bootstrap(config: BootstrapConfig): Promise<BootstrapResult>;
  pollHealthEndpoint(
    vmIp: string,
    port?: number,
    timeoutMs?: number,
    intervalMs?: number
  ): Promise<boolean>;
}

export class RealBootstrapService implements BootstrapService {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  async bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
    const { sessionId, vmId, vmIp } = config;

    try {
      // Ensure the VM is truly running. In dev, the API can restart and kill
      // the Firecracker child, leaving stale runtime fields in the DB.
      const [vm] = await this.db.select().from(vms).where(eq(vms.id, vmId));
      if (!vm) {
        throw new Error("Associated VM not found");
      }
      if (vm.status !== "running" || !vm.pid || !vm.socketPath) {
        throw new Error("VM is not running (missing runtime info)");
      }
      try {
        process.kill(vm.pid, 0);
      } catch {
        throw new Error("VM is not running (firecracker process is not alive)");
      }

      // Bootstrap is currently disabled - serial console access removed
      const errorMessage =
        "Bootstrap temporarily unavailable: serial console access has been removed. " +
        "This functionality will be restored in a future update.";

      // Update session to error
      await this.db
        .update(agentSessions)
        .set({
          status: "error",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId));

      return {
        success: false,
        errorMessage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update session to error
      await this.db
        .update(agentSessions)
        .set({
          status: "error",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId));

      return {
        success: false,
        errorMessage,
      };
    }
  }

  async pollHealthEndpoint(
    vmIp: string,
    port: number = 4096,
    timeoutMs: number = 60000,
    intervalMs: number = 2000
  ): Promise<boolean> {
    const startTime = Date.now();
    const healthUrl = `http://${vmIp}:${port}/global/health`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(healthUrl, {
          method: "GET",
        });

        if (response.ok) {
          return true;
        }
      } catch {
        // Ignore fetch errors (VM not ready yet)
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
  }
}

/**
 * Mock bootstrap service for testing
 */
export interface MockBootstrapService extends BootstrapService {
  calls: {
    bootstrap: Array<{ config: BootstrapConfig }>;
    pollHealthEndpoint: Array<{
      vmIp: string;
      port: number;
      timeoutMs: number;
      intervalMs: number;
    }>;
  };
  clearCalls(): void;
  setBootstrapResult(result: BootstrapResult): void;
  setHealthReady(ready: boolean): void;
}

export function createMockBootstrapService(): MockBootstrapService {
  const calls = {
    bootstrap: [] as Array<{ config: BootstrapConfig }>,
    pollHealthEndpoint: [] as Array<{
      vmIp: string;
      port: number;
      timeoutMs: number;
      intervalMs: number;
    }>,
  };

  let bootstrapResult: BootstrapResult = { success: true, workspacePath: "/mock/workspace" };
  let healthReady = true;

  const service: MockBootstrapService = {
    async bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
      calls.bootstrap.push({ config });
      return bootstrapResult;
    },

    async pollHealthEndpoint(
      vmIp: string,
      port: number = 4096,
      timeoutMs: number = 60000,
      intervalMs: number = 2000
    ): Promise<boolean> {
      calls.pollHealthEndpoint.push({ vmIp, port, timeoutMs, intervalMs });
      return healthReady;
    },

    get calls() {
      return calls;
    },

    clearCalls() {
      calls.bootstrap.length = 0;
      calls.pollHealthEndpoint.length = 0;
    },

    setBootstrapResult(result: BootstrapResult) {
      bootstrapResult = result;
    },

    setHealthReady(ready: boolean) {
      healthReady = ready;
    },
  };

  return service;
}
