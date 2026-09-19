/**
 * Test Utilities
 *
 * Infrastructure for integration tests with mocked services.
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import * as schema from "./db/schema";
import { createApp } from "./index";
import { applyMigrations } from "./db/migrate";
import { createAuth, type Auth, type PasswordHasher } from "./lib/auth";

import type { FirecrackerProcess } from "./services/firecracker/process";
import type { NetworkResources } from "./services/network/index";

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
  /** Let anyone sign up. Default false, as in production. */
  openSignup?: boolean;
}

/** Origin the test app is served from; Better Auth requires it on cookie POSTs. */
export const TEST_ORIGIN = "http://localhost";

/**
 * A signed-in test user. `headers` carries their session cookie plus the
 * Origin header Better Auth's CSRF check expects on cookie-authenticated POSTs.
 */
export interface TestPrincipal {
  id: string;
  name: string;
  email: string;
  password: string;
  cookie: string;
  headers: Record<string, string>;
}

export interface TestOrganization {
  id: string;
  name: string;
  slug: string;
}

/**
 * Test app context returned by createTestApp
 */
export interface TestApp {
  app: ReturnType<typeof createApp>;
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
  auth: Auth;
  /**
   * Like `app.request`, but authenticated as `user` unless the call already
   * carries a `cookie` or `x-api-key` header.
   */
  request: (path: string, init?: RequestInit) => Promise<Response>;
  cleanup: () => void;
  /** The first user, who already has `organization` as their active org. */
  user: TestPrincipal;
  organization: TestOrganization;
  /** Sign up another user through the real auth endpoints. */
  signUp: (input?: { name?: string; email?: string; password?: string }) => Promise<TestPrincipal>;
  signIn: (email: string, password: string) => Promise<TestPrincipal | null>;
  /** Create an organization as `who`; it becomes their active organization. */
  createOrganization: (who: TestPrincipal, name?: string) => Promise<TestOrganization>;
  /** Mint an API key for `who`, bound to `organizationId`. Returns the plaintext key. */
  createApiKey: (who: TestPrincipal, organizationId: string, name?: string) => Promise<string>;
  mocks: {
    firecracker: MockFirecrackerService;
    network: MockNetworkService;
  };
}

/** scrypt is deliberately slow; tests do not need to pay for it. */
export const fastPasswordHasher: PasswordHasher = {
  hash: async (password) => `plain:${password}`,
  verify: async ({ hash, password }) => hash === `plain:${password}`,
};

/** Turn a response's Set-Cookie headers into a Cookie request header. */
export function cookieHeaderFromResponse(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

let userCounter = 0;

/**
 * Creates a Hono app with fresh temp SQLite DB and mocked services.
 *
 * The database is migrated with the real migrations, auth is the real Better
 * Auth instance (with a fast password hasher), and one user with one
 * organization is signed up so most tests can start making VM requests.
 *
 * @example
 * ```typescript
 * const { request, organization, cleanup, mocks } = await createTestApp();
 *
 * const res = await request('/api/vms', {
 *   method: 'POST',
 *   body: JSON.stringify({ name: 'test-vm', imageId }),
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

  applyMigrations(sqlite);

  // Create mocked services
  const firecracker = config.firecracker ?? createMockFirecrackerService();
  const network = config.network ?? createMockNetworkService();

  const auth = createAuth({
    db,
    baseUrl: TEST_ORIGIN,
    trustedOrigins: [TEST_ORIGIN],
    webUrl: "http://localhost:5173",
    openSignup: config.openSignup ?? false,
    password: fastPasswordHasher,
    log: () => {},
  });

  // Create app using the real createApp function with injected dependencies
  const app = createApp({
    db,
    auth,
    networkService: network as any,
    spawnFirecrackerFn: firecracker.spawnFirecracker as any,
    configureVMProcessFn: firecracker.configureVMProcess as any,
    startVMProcessFn: firecracker.startVMProcess as any,
    stopVMProcessFn: firecracker.stopVMProcess as any,
  });

  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN, ...headers },
      body: JSON.stringify(body),
    });

  const principalFromAuthResponse = async (
    res: Response,
    password: string
  ): Promise<TestPrincipal | null> => {
    if (!res.ok) return null;
    const body = (await res.json()) as { user: { id: string; name: string; email: string } };
    const cookie = cookieHeaderFromResponse(res);
    return { ...body.user, password, cookie, headers: { cookie, origin: TEST_ORIGIN } };
  };

  const signUp: TestApp["signUp"] = async (input = {}) => {
    userCounter += 1;
    const name = input.name ?? `Test User ${userCounter}`;
    const email = input.email ?? `user-${userCounter}-${randomUUID().slice(0, 8)}@example.com`;
    const password = input.password ?? "correct horse battery staple";

    const res = await json("/api/auth/sign-up/email", { name, email, password });
    const principal = await principalFromAuthResponse(res, password);
    if (!principal) {
      const text = await res.text();
      throw new Error(`Sign-up failed (${res.status}): ${text}`);
    }
    return principal;
  };

  const signIn: TestApp["signIn"] = async (email, password) => {
    const res = await json("/api/auth/sign-in/email", { email, password });
    return principalFromAuthResponse(res, password);
  };

  const createOrganization: TestApp["createOrganization"] = async (who, name) => {
    const orgName = name ?? `Org ${randomUUID().slice(0, 8)}`;
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const res = await json("/api/auth/organization/create", { name: orgName, slug }, who.headers);
    if (!res.ok) {
      throw new Error(`Organization creation failed (${res.status}): ${await res.text()}`);
    }
    const org = (await res.json()) as TestOrganization;
    return { id: org.id, name: org.name, slug: org.slug };
  };

  const createApiKey: TestApp["createApiKey"] = async (who, organizationId, name = "test key") => {
    const res = await json(
      "/api/auth/api-key/create",
      { name, metadata: { organizationId } },
      who.headers
    );
    if (!res.ok) {
      throw new Error(`API key creation failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as { key: string };
    return body.key;
  };

  // The first user may always sign up; they then get an organization.
  const user = await signUp();
  const organization = await createOrganization(user, "Test Org");

  const request: TestApp["request"] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("cookie") && !headers.has("x-api-key")) {
      headers.set("cookie", user.cookie);
    }
    if (headers.has("cookie") && !headers.has("origin")) {
      headers.set("origin", TEST_ORIGIN);
    }
    return Promise.resolve(app.request(path, { ...init, headers }));
  };

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
    auth,
    request,
    cleanup,
    user,
    organization,
    signUp,
    signIn,
    createOrganization,
    createApiKey,
    mocks: {
      firecracker,
      network,
    },
  };
}
