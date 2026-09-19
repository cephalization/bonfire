/**
 * Bonfire SDK Client
 *
 * Hand-written to match the API. See CLAUDE.md on generating this from
 * /api/openapi.json.
 */

import type { HealthResponse, VM, CreateVMRequest, Image, SuccessResponse } from "./types";

export interface ClientConfig {
  baseUrl?: string;
  /**
   * API key sent as the `X-API-Key` header. Create one in the web UI under
   * Settings → API keys; it acts as you, in the organization it was created
   * for.
   */
  apiKey?: string;
  /**
   * Organization to act in, for calls that need one (listing and creating
   * VMs). Defaults to the organization the API key was created for.
   */
  organizationId?: string;
}

export class BonfireClient {
  private baseUrl: string;
  private apiKey?: string;
  private organizationId?: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || "http://localhost:3000";
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; params?: Record<string, string> } = {}
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ============================================================================
  // Health
  // ============================================================================

  /**
   * Health check
   * Returns the health status of the API server
   */
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  // ============================================================================
  // VMs
  // ============================================================================

  /**
   * List VMs
   * Returns the VMs of the organization the client acts in
   */
  async listVMs(options: { organizationId?: string } = {}): Promise<VM[]> {
    const organizationId = options.organizationId ?? this.organizationId;
    return this.request<VM[]>("GET", "/api/vms", {
      params: organizationId ? { organizationId } : undefined,
    });
  }

  /**
   * Get VM details
   * Returns details for a single VM
   */
  async getVM(id: string): Promise<VM> {
    return this.request<VM>("GET", `/api/vms/${id}`);
  }

  /**
   * Create a new VM
   * Creates a new VM record with status 'creating' in the organization the client acts in
   */
  async createVM(request: CreateVMRequest): Promise<VM> {
    const body: CreateVMRequest = {
      ...request,
      organizationId: request.organizationId ?? this.organizationId,
    };
    return this.request<VM>("POST", "/api/vms", { body });
  }

  /**
   * Delete a VM
   * Deletes a VM record. VM must be stopped first if running.
   */
  async deleteVM(id: string): Promise<SuccessResponse> {
    return this.request<SuccessResponse>("DELETE", `/api/vms/${id}`);
  }

  /**
   * Start a VM
   * Starts a VM by allocating network resources and spawning Firecracker process
   */
  async startVM(id: string): Promise<VM> {
    return this.request<VM>("POST", `/api/vms/${id}/start`);
  }

  /**
   * Stop a VM
   * Stops a running VM by stopping Firecracker process and releasing network resources
   */
  async stopVM(id: string): Promise<VM> {
    return this.request<VM>("POST", `/api/vms/${id}/stop`);
  }

  /**
   * Get SSH private key for a VM
   * Returns the SSH private key for connecting to a running VM
   */
  async getVMSSHKey(id: string): Promise<{ privateKey: string; username: string }> {
    return this.request<{ privateKey: string; username: string }>("GET", `/api/vms/${id}/ssh-key`);
  }

  // ============================================================================
  // Images
  // ============================================================================

  /**
   * List all registered images
   * Returns all images from the database
   */
  async listImages(): Promise<Image[]> {
    return this.request<Image[]>("GET", "/api/images");
  }

  /**
   * Delete cached image
   * Removes a cached image from database
   */
  async deleteImage(id: string): Promise<SuccessResponse> {
    return this.request<SuccessResponse>("DELETE", `/api/images/${id}`);
  }

  // ============================================================================
  // Terminal WebSocket
  // ============================================================================

  /**
   * Mint a single-use ticket for the terminal WebSocket.
   *
   * A WebSocket handshake cannot carry an X-API-Key header from a browser, so
   * the terminal is authenticated with a short-lived ticket in the URL.
   */
  async createTerminalTicket(id: string): Promise<{ ticket: string; expiresAt: number }> {
    return this.request<{ ticket: string; expiresAt: number }>(
      "POST",
      `/api/vms/${id}/terminal/ticket`
    );
  }

  /**
   * Open a WebSocket for terminal access to a VM.
   *
   * Mints a ticket first, so this is async. Tickets are single use: call this
   * again for each reconnect rather than reusing the URL.
   */
  async createTerminalWebSocket(id: string): Promise<WebSocket> {
    const { ticket } = await this.createTerminalTicket(id);

    const wsUrl = new URL(`/api/vms/${id}/terminal`, this.baseUrl);
    // Convert http(s) to ws(s)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("ticket", ticket);

    return new WebSocket(wsUrl.toString());
  }
}
