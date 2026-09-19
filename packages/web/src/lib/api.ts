/**
 * Bonfire API Client
 *
 * Fetch wrapper and endpoint methods for the web frontend.
 * Hand-written client. See CLAUDE.md on generating this from /api/openapi.json.
 */

// Base configuration
// In development without VITE_API_URL, use window.location.origin for same-origin requests
// In production, VITE_API_URL should be set to the full API URL
function getDefaultBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Use current origin for same-origin API requests (works with any hostname)
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return ""; // Fallback for SSR/build time (relative URLs)
}

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
  organizationId: string | null;
  createdById: string | null;
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
  /** Defaults to the session's active organization. */
  organizationId?: string;
}

export interface PullImageRequest {
  reference: string;
}

export interface RegisterLocalImageRequest {
  reference?: string;
  kernelPath?: string;
  rootfsPath?: string;
}

export interface SuccessResponse {
  success: boolean;
}

export interface APIError {
  message: string;
  code?: string;
  status?: number;
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
  /**
   * An API key to send as `X-API-Key`. The web app itself does not set this:
   * it is signed in with a session cookie, which the browser attaches because
   * requests are made with `credentials: "include"`.
   */
  getAuthToken?: () => string | null;
  onAuthError?: () => void;
}

// Base fetch wrapper with error handling and auth injection
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  config: APIClientConfig = {}
): Promise<T> {
  const baseUrl = config.baseUrl || getDefaultBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  // Build headers with auth
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Inject an API key if one was configured
  const token = config.getAuthToken?.();
  if (token) {
    headers["X-API-Key"] = token;
  }

  const fetchOptions: RequestInit = {
    credentials: "include",
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

export async function listVMs(
  config?: APIClientConfig,
  options: { organizationId?: string } = {}
): Promise<VM[]> {
  const query = options.organizationId
    ? `?organizationId=${encodeURIComponent(options.organizationId)}`
    : "";
  return apiFetch<VM[]>(`/api/vms${query}`, { method: "GET" }, config);
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

export interface TerminalTicket {
  ticket: string;
  expiresAt: number;
}

/**
 * Mint a single-use ticket for the terminal WebSocket.
 *
 * The WebSocket handshake cannot carry an X-API-Key header from a browser, so
 * the ticket goes in the URL instead. Tickets are single-use and short-lived,
 * so one must be minted per connection attempt.
 */
export async function createTerminalTicket(
  id: string,
  config?: APIClientConfig
): Promise<TerminalTicket> {
  return apiFetch<TerminalTicket>(`/api/vms/${id}/terminal/ticket`, { method: "POST" }, config);
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

export async function registerLocalImage(
  request: RegisterLocalImageRequest,
  config?: APIClientConfig
): Promise<Image> {
  return apiFetch<Image>(
    "/api/images/local",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    config
  );
}

export async function deleteImage(id: string, config?: APIClientConfig): Promise<SuccessResponse> {
  return apiFetch<SuccessResponse>(`/api/images/${id}`, { method: "DELETE" }, config);
}

// ============================================================================
// Conversations
// ============================================================================

export type AgentStatus = "offline" | "provisioning" | "idle" | "busy" | "error";

export interface Conversation {
  id: string;
  organizationId: string;
  title: string;
  createdById: string | null;
  agentVmId: string | null;
  agentModel: string | null;
  agentStatus: AgentStatus;
  agentError: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationParticipant {
  userId: string;
  name: string;
  email: string;
  joinedAt: string;
}

export interface ConversationDetail extends Conversation {
  participants: ConversationParticipant[];
  agentVmName: string | null;
}

export type MessagePart =
  | { type: "text"; id: string; text: string }
  | {
      type: "tool";
      callId: string;
      name: string;
      status: "running" | "completed" | "error";
      input?: unknown;
      output?: string;
      error?: string;
    }
  | { type: "error"; message: string };

export interface ConversationMessage {
  id: string;
  conversationId: string;
  authorKind: "user" | "agent" | "system";
  authorId: string | null;
  authorName: string;
  body: string;
  parts: MessagePart[];
  status: "complete" | "streaming" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface AgentModel {
  providerID: string;
  id: string;
  name: string;
}

export async function listConversations(
  config?: APIClientConfig,
  options: { organizationId?: string } = {}
): Promise<Conversation[]> {
  const query = options.organizationId
    ? `?organizationId=${encodeURIComponent(options.organizationId)}`
    : "";
  return apiFetch<Conversation[]>(`/api/conversations${query}`, {}, config);
}

export async function createConversation(
  request: { title?: string; organizationId?: string },
  config?: APIClientConfig
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(
    "/api/conversations",
    { method: "POST", body: JSON.stringify(request) },
    config
  );
}

export async function getConversation(
  id: string,
  config?: APIClientConfig
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/conversations/${id}`, {}, config);
}

export async function deleteConversation(
  id: string,
  config?: APIClientConfig
): Promise<SuccessResponse> {
  return apiFetch<SuccessResponse>(`/api/conversations/${id}`, { method: "DELETE" }, config);
}

export async function listMessages(
  conversationId: string,
  options: { after?: string } = {},
  config?: APIClientConfig
): Promise<ConversationMessage[]> {
  const query = options.after ? `?after=${encodeURIComponent(options.after)}` : "";
  return apiFetch<ConversationMessage[]>(
    `/api/conversations/${conversationId}/messages${query}`,
    {},
    config
  );
}

export async function postMessage(
  conversationId: string,
  body: string,
  config?: APIClientConfig
): Promise<ConversationMessage> {
  return apiFetch<ConversationMessage>(
    `/api/conversations/${conversationId}/messages`,
    { method: "POST", body: JSON.stringify({ body }) },
    config
  );
}

export async function attachAgent(
  conversationId: string,
  request: { vmId: string; model?: string },
  config?: APIClientConfig
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(
    `/api/conversations/${conversationId}/agent`,
    { method: "POST", body: JSON.stringify(request) },
    config
  );
}

export async function detachAgent(
  conversationId: string,
  config?: APIClientConfig
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(
    `/api/conversations/${conversationId}/agent`,
    { method: "DELETE" },
    config
  );
}

export async function interruptAgent(
  conversationId: string,
  config?: APIClientConfig
): Promise<SuccessResponse> {
  return apiFetch<SuccessResponse>(
    `/api/conversations/${conversationId}/agent/interrupt`,
    { method: "POST" },
    config
  );
}

export async function listAgentModels(
  conversationId: string,
  config?: APIClientConfig
): Promise<AgentModel[]> {
  return apiFetch<AgentModel[]>(`/api/conversations/${conversationId}/agent/models`, {}, config);
}

export type ConversationEvent =
  | { type: "ready"; conversationId: string }
  | { type: "message.created"; message: ConversationMessage }
  | { type: "message.updated"; message: ConversationMessage }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "participant.joined"; participant: { userId: string; name: string } };

/**
 * Subscribe to a conversation's server-sent events. The browser's EventSource
 * carries the session cookie, so no ticket is needed (unlike the terminal
 * WebSocket). Returns a function that closes the stream.
 */
export function subscribeToConversation(
  conversationId: string,
  onEvent: (event: ConversationEvent) => void,
  options: { baseUrl?: string; onError?: () => void } = {}
): () => void {
  const baseUrl = options.baseUrl ?? getDefaultBaseUrl();
  const source = new EventSource(`${baseUrl}/api/conversations/${conversationId}/events`, {
    withCredentials: true,
  });
  const forward = (type: ConversationEvent["type"], key: string) => (raw: Event) => {
    try {
      const data = JSON.parse((raw as MessageEvent).data);
      onEvent({ type, [key]: data } as ConversationEvent);
    } catch {
      // ignore malformed frames
    }
  };
  source.addEventListener("ready", forward("ready", "conversationId"));
  source.addEventListener("message.created", forward("message.created", "message"));
  source.addEventListener("message.updated", forward("message.updated", "message"));
  source.addEventListener("conversation.updated", forward("conversation.updated", "conversation"));
  source.addEventListener("participant.joined", forward("participant.joined", "participant"));
  source.onerror = () => options.onError?.();
  return () => source.close();
}

// ============================================================================
// Provider keys (per organization)
// ============================================================================

export interface Provider {
  id: string;
  name: string;
  keysUrl: string;
  configured: boolean;
  keyHint: string | null;
  label: string | null;
  updatedAt: string | null;
}

export async function listProviders(
  organizationId: string,
  config?: APIClientConfig
): Promise<Provider[]> {
  return apiFetch<Provider[]>(`/api/organizations/${organizationId}/providers`, {}, config);
}

export async function setProviderKey(
  organizationId: string,
  providerId: string,
  request: { apiKey: string; label?: string },
  config?: APIClientConfig
): Promise<Provider> {
  return apiFetch<Provider>(
    `/api/organizations/${organizationId}/providers/${providerId}`,
    { method: "PUT", body: JSON.stringify(request) },
    config
  );
}

export async function deleteProviderKey(
  organizationId: string,
  providerId: string,
  config?: APIClientConfig
): Promise<Provider> {
  return apiFetch<Provider>(
    `/api/organizations/${organizationId}/providers/${providerId}`,
    { method: "DELETE" },
    config
  );
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
      terminalTicket: (id: string) => createTerminalTicket(id, config),
    },
    // Images
    images: {
      list: () => listImages(config),
      pull: (req: PullImageRequest) => pullImage(req, config),
      delete: (id: string) => deleteImage(id, config),
    },
  };
}

// Default export for convenience
export default createAPIClient;
