/**
 * Bonfire API Client
 *
 * Fetch wrapper and endpoint methods for the web frontend.
 * Matches the API specification in PLAN.md.
 */

// Base configuration
// In development, use empty string for relative URLs to leverage Vite dev server proxy
// In production, VITE_API_URL should be set to the full API URL
const DEFAULT_BASE_URL = import.meta.env.VITE_API_URL || "";

// WebSocket base URL for terminal connections
// In development, prefer same-origin so Vite can proxy `/api` WebSockets.
export function getWebSocketBaseUrl(): string {
  // If VITE_WS_URL is set, use it explicitly
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // If VITE_API_URL is set, convert to ws (production)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/^http/, "ws");
  }

  // Default: same origin (works with Vite WS proxy)
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

// API Types matching the database schema and API responses

export interface VM {
  id: string;
  name: string;
  status: "creating" | "running" | "stopped" | "error";
  vcpus: number;
  memoryMib: number;
  imageId: string | null;
  pid: number | null;
  socketPath: string | null;
  tapDevice: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Image {
  id: string;
  reference: string;
  kernelPath: string;
  rootfsPath: string;
  sizeBytes: number | null;
  pulledAt: string;
}

export interface CreateVMRequest {
  name: string;
  vcpus?: number;
  memoryMib?: number;
  imageId?: string;
}

export interface PullImageRequest {
  reference: string;
}

export interface ExecRequest {
  command: string;
  args?: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HealthResponse {
  healthy: boolean;
}

export interface SuccessResponse {
  success: boolean;
}

export interface APIError {
  message: string;
  code?: string;
  status?: number;
}

// Agent Session Types
export interface AgentSession {
  id: string;
  userId: string;
  title: string | null;
  repoUrl: string;
  branch: string | null;
  vmId: string | null;
  workspacePath: string | null;
  status: "creating" | "ready" | "error" | "archived";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentSessionRequest {
  title?: string;
  repoUrl: string;
  branch?: string;
  vmId?: string;
}

// Custom error class for API errors
export class BonfireAPIError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly response?: Response;

  constructor(message: string, status: number, code?: string, response?: Response) {
    super(message);
    this.name = "BonfireAPIError";
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

// API Client configuration
export interface APIClientConfig {
  baseUrl?: string;
  getAuthToken?: () => string | null;
  onAuthError?: () => void;
}

// Base fetch wrapper with error handling and auth injection
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  config: APIClientConfig = {}
): Promise<T> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}${endpoint}`;

  // Build headers with auth
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Inject auth token if available
  const token = config.getAuthToken?.();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
  };

  let response: Response;

  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    // Network errors (offline, DNS failure, etc.)
    throw new BonfireAPIError(
      error instanceof Error ? error.message : "Network error",
      0,
      "NETWORK_ERROR"
    );
  }

  // Handle auth errors
  if (response.status === 401) {
    config.onAuthError?.();
    throw new BonfireAPIError("Authentication required", 401, "AUTH_REQUIRED", response);
  }

  // Handle non-OK responses
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorCode: string | undefined;

    try {
      const errorBody = await response.json();
      errorMessage = errorBody.message || errorBody.error || errorMessage;
      errorCode = errorBody.code;
    } catch {
      // Not JSON response, use default message
    }

    throw new BonfireAPIError(errorMessage, response.status, errorCode, response);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // Parse JSON response
  try {
    const data = await response.json();
    return data as T;
  } catch (error) {
    throw new BonfireAPIError("Invalid JSON response", response.status, "INVALID_JSON", response);
  }
}

// VM Endpoints

export async function listVMs(config?: APIClientConfig): Promise<VM[]> {
  return apiFetch<VM[]>("/api/vms", { method: "GET" }, config);
}

export async function getVM(id: string, config?: APIClientConfig): Promise<VM> {
  return apiFetch<VM>(`/api/vms/${id}`, { method: "GET" }, config);
}

export async function createVM(request: CreateVMRequest, config?: APIClientConfig): Promise<VM> {
  return apiFetch<VM>(
    "/api/vms",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    config
  );
}

export async function deleteVM(id: string, config?: APIClientConfig): Promise<SuccessResponse> {
  return apiFetch<SuccessResponse>(`/api/vms/${id}`, { method: "DELETE" }, config);
}

export async function startVM(id: string, config?: APIClientConfig): Promise<VM> {
  return apiFetch<VM>(`/api/vms/${id}/start`, { method: "POST" }, config);
}

export async function stopVM(id: string, config?: APIClientConfig): Promise<VM> {
  return apiFetch<VM>(`/api/vms/${id}/stop`, { method: "POST" }, config);
}

export async function checkVMHealth(id: string, config?: APIClientConfig): Promise<HealthResponse> {
  return apiFetch<HealthResponse>(`/api/vms/${id}/health`, { method: "GET" }, config);
}

export async function execVM(
  id: string,
  request: ExecRequest,
  config?: APIClientConfig
): Promise<ExecResult> {
  return apiFetch<ExecResult>(
    `/api/vms/${id}/exec`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    config
  );
}

// Image Endpoints

export async function listImages(config?: APIClientConfig): Promise<Image[]> {
  return apiFetch<Image[]>("/api/images", { method: "GET" }, config);
}

export async function pullImage(
  request: PullImageRequest,
  config?: APIClientConfig
): Promise<Image> {
  return apiFetch<Image>(
    "/api/images/pull",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    config
  );
}

export async function quickStartImage(config?: APIClientConfig): Promise<Image> {
  return apiFetch<Image>(
    "/api/images/quickstart",
    {
      method: "POST",
    },
    config
  );
}

export async function deleteImage(id: string, config?: APIClientConfig): Promise<SuccessResponse> {
  return apiFetch<SuccessResponse>(`/api/images/${id}`, { method: "DELETE" }, config);
}

// Agent Session Endpoints

export async function listAgentSessions(config?: APIClientConfig): Promise<AgentSession[]> {
  return apiFetch<AgentSession[]>("/api/agent/sessions", { method: "GET" }, config);
}

export async function getAgentSession(id: string, config?: APIClientConfig): Promise<AgentSession> {
  return apiFetch<AgentSession>(`/api/agent/sessions/${id}`, { method: "GET" }, config);
}

export async function createAgentSession(
  request: CreateAgentSessionRequest,
  config?: APIClientConfig
): Promise<AgentSession> {
  return apiFetch<AgentSession>(
    "/api/agent/sessions",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    config
  );
}

export async function archiveAgentSession(
  id: string,
  config?: APIClientConfig
): Promise<AgentSession> {
  return apiFetch<AgentSession>(`/api/agent/sessions/${id}/archive`, { method: "POST" }, config);
}

export async function retryAgentSession(
  id: string,
  config?: APIClientConfig
): Promise<AgentSession> {
  return apiFetch<AgentSession>(`/api/agent/sessions/${id}/retry`, { method: "POST" }, config);
}

// Create a configured API client instance
export function createAPIClient(config: APIClientConfig = {}) {
  return {
    // VMs
    vms: {
      list: () => listVMs(config),
      get: (id: string) => getVM(id, config),
      create: (req: CreateVMRequest) => createVM(req, config),
      delete: (id: string) => deleteVM(id, config),
      start: (id: string) => startVM(id, config),
      stop: (id: string) => stopVM(id, config),
      health: (id: string) => checkVMHealth(id, config),
      exec: (id: string, req: ExecRequest) => execVM(id, req, config),
    },
    // Images
    images: {
      list: () => listImages(config),
      pull: (req: PullImageRequest) => pullImage(req, config),
      delete: (id: string) => deleteImage(id, config),
    },
    // Agent Sessions
    agentSessions: {
      list: () => listAgentSessions(config),
      get: (id: string) => getAgentSession(id, config),
      create: (req: CreateAgentSessionRequest) => createAgentSession(req, config),
      archive: (id: string) => archiveAgentSession(id, config),
      retry: (id: string) => retryAgentSession(id, config),
    },
  };
}

// Default export for convenience
export default createAPIClient;
