/**
 * Test Utilities
 *
 * Infrastructure for integration tests with mocked services.
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import * as schema from "./db/schema";
import { createApp } from "./index";
import { createMockBootstrapService, type MockBootstrapService } from "./services/bootstrap";
import type { FirecrackerProcess } from "./services/firecracker/process";
import type { NetworkResources } from "./services/network/index";
import type { OpenAPIHono } from "@hono/zod-openapi";

// Migration SQL from drizzle/0000_brave_maestro.sql + Better Auth tables
const MIGRATION_SQL = `
-- Better Auth tables
CREATE TABLE IF NOT EXISTS \`user\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`email\` text NOT NULL,
  \`email_verified\` integer DEFAULT false NOT NULL,
  \`image\` text,
  \`role\` text DEFAULT 'member' NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS \`user_email_unique\` ON \`user\` (\`email\`);

CREATE TABLE IF NOT EXISTS \`session\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`token\` text NOT NULL,
  \`expires_at\` integer NOT NULL,
  \`ip_address\` text,
  \`user_agent\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS \`session_token_unique\` ON \`session\` (\`token\`);

CREATE TABLE IF NOT EXISTS \`account\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`account_id\` text NOT NULL,
  \`provider_id\` text NOT NULL,
  \`access_token\` text,
  \`refresh_token\` text,
  \`access_token_expires_at\` integer,
  \`refresh_token_expires_at\` integer,
  \`scope\` text,
  \`id_token\` text,
  \`password\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE IF NOT EXISTS \`verification\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`identifier\` text NOT NULL,
  \`value\` text NOT NULL,
  \`expires_at\` integer NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL
);

-- Application tables
CREATE TABLE IF NOT EXISTS \`images\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`reference\` text NOT NULL,
  \`kernel_path\` text NOT NULL,
  \`rootfs_path\` text NOT NULL,
  \`size_bytes\` integer,
  \`pulled_at\` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS \`images_reference_unique\` ON \`images\` (\`reference\`);

CREATE TABLE IF NOT EXISTS \`vms\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`status\` text DEFAULT 'creating' NOT NULL,
  \`vcpus\` integer DEFAULT 1 NOT NULL,
  \`memory_mib\` integer DEFAULT 512 NOT NULL,
  \`image_id\` text,
  \`pid\` integer,
  \`socket_path\` text,
  \`tap_device\` text,
  \`mac_address\` text,
  \`ip_address\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS \`vms_name_unique\` ON \`vms\` (\`name\`);

CREATE TABLE IF NOT EXISTS \`agent_sessions\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`title\` text,
  \`repo_url\` text NOT NULL,
  \`branch\` text,
  \`vm_id\` text,
  \`workspace_path\` text,
  \`status\` text DEFAULT 'creating' NOT NULL,
  \`error_message\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (\`vm_id\`) REFERENCES \`vms\`(\`id\`) ON UPDATE no action ON DELETE no action
);
`;

/**
 * Mock Firecracker Service interface
 */
export interface MockFirecrackerService {
  spawnFirecracker: ReturnType<typeof mockFn<typeof spawnFirecracker>>;
  configureVMProcess: ReturnType<typeof mockFn<typeof configureVMProcess>>;
  startVMProcess: ReturnType<typeof mockFn<typeof startVMProcess>>;
  stopVMProcess: ReturnType<typeof mockFn<typeof stopVMProcess>>;
  calls: {
    spawnFirecracker: Parameters<typeof spawnFirecracker>[];
    configureVMProcess: Parameters<typeof configureVMProcess>[];
    startVMProcess: Parameters<typeof startVMProcess>[];
    stopVMProcess: Parameters<typeof stopVMProcess>[];
  };
  clearCalls: () => void;
}

type SpawnOptions = {
  vmId: string;
  socketDir?: string;
  binaryPath?: string;
};

type VMConfiguration = {
  vcpuCount: number;
  memSizeMib: number;
  kernelImagePath: string;
  rootfsPath: string;
};

type StopOptions = {
  gracefulTimeoutMs?: number;
  sigtermTimeoutMs?: number;
};

async function spawnFirecracker(options: SpawnOptions): Promise<FirecrackerProcess> {
  const socketDir = options.socketDir ?? "/tmp/bonfire-test";
  return {
    pid: 12345,
    socketPath: `${socketDir}/mock-${options.vmId}.sock`,
  };
}

async function configureVMProcess(socketPath: string, config: VMConfiguration): Promise<void> {}

async function startVMProcess(socketPath: string): Promise<void> {}

async function stopVMProcess(
  socketPath: string,
  pid: number,
  options?: StopOptions
): Promise<void> {}

/**
 * Create a mock function that tracks calls
 */
function mockFn<T extends (...args: any[]) => any>(
  implementation: T
): T & { calls: Parameters<T>[] } {
  const calls: Parameters<T>[] = [];

  const mockFunction = ((...args: Parameters<T>): ReturnType<T> => {
    calls.push(args);
    return implementation(...args);
  }) as T & { calls: Parameters<T>[] };

  mockFunction.calls = calls;

  return mockFunction;
}

/**
 * Creates a mock Firecracker service with call tracking
 */
export function createMockFirecrackerService(): MockFirecrackerService {
  const calls = {
    spawnFirecracker: [] as Parameters<typeof spawnFirecracker>[],
    configureVMProcess: [] as Parameters<typeof configureVMProcess>[],
    startVMProcess: [] as Parameters<typeof startVMProcess>[],
    stopVMProcess: [] as Parameters<typeof stopVMProcess>[],
  };

  const service: MockFirecrackerService = {
    spawnFirecracker: Object.assign(
      async (options: SpawnOptions) => {
        calls.spawnFirecracker.push([options]);
        const socketDir = options.socketDir ?? "/tmp/bonfire-test";
        return {
          pid: Math.floor(Math.random() * 100000) + 1000,
          socketPath: `${socketDir}/mock-${options.vmId}.sock`,
          stdinPipePath: `${socketDir}/${options.vmId}.stdin`,
          stdoutPipePath: `${socketDir}/${options.vmId}.stdout`,
        };
      },
      { calls: calls.spawnFirecracker }
    ),
    configureVMProcess: Object.assign(
      async (socketPath: string, config: VMConfiguration) => {
        calls.configureVMProcess.push([socketPath, config]);
      },
      { calls: calls.configureVMProcess }
    ),
    startVMProcess: Object.assign(
      async (socketPath: string) => {
        calls.startVMProcess.push([socketPath]);
      },
      { calls: calls.startVMProcess }
    ),
    stopVMProcess: Object.assign(
      async (socketPath: string, pid: number, options?: StopOptions) => {
        calls.stopVMProcess.push([socketPath, pid, options]);
      },
      { calls: calls.stopVMProcess }
    ),
    calls,
    clearCalls: () => {
      calls.spawnFirecracker.length = 0;
      calls.configureVMProcess.length = 0;
      calls.startVMProcess.length = 0;
      calls.stopVMProcess.length = 0;
    },
  };

  return service;
}

/**
 * Mock Network Service interface with IP tracking
 */
export interface MockNetworkService {
  allocate: ReturnType<typeof mockFn<typeof allocate>>;
  release: ReturnType<typeof mockFn<typeof release>>;
  getAllocatedIPs: () => string[];
  getIPPool: () => { allocated: Set<string>; available: string[] };
  calls: {
    allocate: Parameters<typeof allocate>[];
    release: Parameters<typeof release>[];
  };
  clearCalls: () => void;
}

type AllocateFn = (vmId: string) => Promise<NetworkResources>;
type ReleaseFn = (resources: Partial<NetworkResources>) => Promise<void>;

async function allocate(vmId: string): Promise<NetworkResources> {
  return {
    tapDevice: `tap-${vmId}`,
    macAddress: "00:00:00:00:00:01",
    ipAddress: "10.0.100.2",
  };
}

async function release(resources: Partial<NetworkResources>): Promise<void> {}

/**
 * Creates a mock Network service with IP allocation tracking
 */
export function createMockNetworkService(subnet: string = "10.0.100.0/24"): MockNetworkService {
  // Internal state for this mock instance
  const state = {
    allocatedIPs: new Set<string>(),
    nextIP: 2, // Start from .2 (.1 is gateway)
  };

  const calls = {
    allocate: [] as Parameters<typeof allocate>[],
    release: [] as Parameters<typeof release>[],
  };

  const service: MockNetworkService = {
    allocate: Object.assign(
      async (vmId: string): Promise<NetworkResources> => {
        calls.allocate.push([vmId]);

        // Find next available IP starting from state.nextIP
        let attempts = 0;
        while (attempts < 253) {
          const ip = `10.0.100.${state.nextIP}`;
          const currentIP = state.nextIP;
          state.nextIP = (state.nextIP % 254) + 2; // Wrap around
          attempts++;

          if (!state.allocatedIPs.has(ip)) {
            state.allocatedIPs.add(ip);
            return {
              tapDevice: `tap-mock-${vmId.slice(0, 8)}`,
              macAddress: `02:00:00:00:00:${currentIP.toString(16).padStart(2, "0")}`,
              ipAddress: ip,
            };
          }
        }

        throw new Error("IP pool exhausted");
      },
      { calls: calls.allocate }
    ),
    release: Object.assign(
      async (resources: Partial<NetworkResources>): Promise<void> => {
        calls.release.push([resources]);
        if (resources.ipAddress) {
          state.allocatedIPs.delete(resources.ipAddress);
        }
      },
      { calls: calls.release }
    ),
    getAllocatedIPs: () => Array.from(state.allocatedIPs),
    getIPPool: () => ({
      allocated: new Set(state.allocatedIPs),
      available: Array.from({ length: 253 }, (_, i) => `10.0.100.${i + 2}`).filter(
        (ip) => !state.allocatedIPs.has(ip)
      ),
    }),
    calls,
    clearCalls: () => {
      calls.allocate.length = 0;
      calls.release.length = 0;
    },
  };

  return service;
}

/**
 * Test app configuration
 */
export interface TestAppConfig {
  firecracker?: MockFirecrackerService;
  network?: MockNetworkService;
  bootstrapService?: MockBootstrapService;
  skipAuth?: boolean;
  /**
   * Fetch function for proxy requests (can be mocked in tests)
   */
  proxyFetch?: typeof fetch;
}

/**
 * Test app context returned by createTestApp
 */
export interface TestApp {
  app: OpenAPIHono;
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
  request: OpenAPIHono["request"];
  cleanup: () => void;
  mockUserId: string;
  mocks: {
    firecracker: MockFirecrackerService;
    network: MockNetworkService;
    bootstrapService: MockBootstrapService;
  };
}

/**
 * Creates a Hono app with fresh temp SQLite DB and mocked services.
 *
 * @param config - Optional test configuration with mock services
 * @returns Test app context with app, db, request helper, and cleanup
 *
 * @example
 * ```typescript
 * const { app, db, request, cleanup, mocks } = await createTestApp();
 *
 * const res = await request('/api/vms', {
 *   method: 'POST',
 *   body: JSON.stringify({ name: 'test-vm' }),
 * });
 *
 * expect(res.status).toBe(201);
 * expect(mocks.firecracker.calls.spawnFirecracker).toHaveLength(1);
 *
 * cleanup();
 * ```
 */
export async function createTestApp(config: TestAppConfig = {}): Promise<TestApp> {
  // Create fresh temp database
  const dbPath = `/tmp/bonfire-test-${randomUUID()}.db`;
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Run migrations
  sqlite.exec(MIGRATION_SQL);

  // Create mocked services
  const firecracker = config.firecracker ?? createMockFirecrackerService();
  const network = config.network ?? createMockNetworkService();
  const bootstrapService = config.bootstrapService ?? createMockBootstrapService();

  // Create a mock user for testing
  const mockUserId = `test-user-${randomUUID()}`;
  const now = new Date();
  sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
    VALUES ('${mockUserId}', 'Test User', '${mockUserId}@test.com', 1, 'member', ${now.getTime()}, ${now.getTime()})
  `);

  // Create app using the real createApp function with injected dependencies
  const app = createApp({
    db,
    networkService: network as any,
    spawnFirecrackerFn: firecracker.spawnFirecracker as any,
    configureVMProcessFn: firecracker.configureVMProcess as any,
    startVMProcessFn: firecracker.startVMProcess as any,
    stopVMProcessFn: firecracker.stopVMProcess as any,
    bootstrapService,
    skipAuth: config.skipAuth ?? true,
    mockUserId,
    fetchFn: config.proxyFetch,
  });

  // Cleanup function
  const cleanup = () => {
    try {
      sqlite.close();
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    app,
    db,
    sqlite,
    request: app.request.bind(app),
    cleanup,
    mockUserId,
    mocks: {
      firecracker,
      network,
      bootstrapService,
    },
  };
}
