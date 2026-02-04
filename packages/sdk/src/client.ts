/**
 * Bonfire SDK Client
 *
 * Auto-generated from OpenAPI specification.
 * Do not edit manually.
 */

import type { HealthResponse, VM, CreateVMRequest, Image, SuccessResponse } from "./types";

export interface ClientConfig {
  baseUrl?: string;
  token?: string; // Bearer token (optional)
  cookie?: string; // Cookie header value (optional)
}

export class BonfireClient {
  private baseUrl: string;
  private token?: string;
  private cookie?: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || "http://localhost:3000";
    this.token = config.token;
    this.cookie = config.cookie;
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

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    if (this.cookie) {
      headers["Cookie"] = this.cookie;
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
   * List all VMs
   * Returns all VMs from the database
   */
  async listVMs(): Promise<VM[]> {
    return this.request<VM[]>("GET", "/api/vms");
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
   * Creates a new VM record with status 'creating'
   */
  async createVM(request: CreateVMRequest): Promise<VM> {
    return this.request<VM>("POST", "/api/vms", { body: request });
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
   * Create a WebSocket connection for terminal access to a VM
   * Returns a WebSocket instance connected to the VM's terminal
   */
  createTerminalWebSocket(id: string): WebSocket {
    const wsUrl = new URL(`/api/vms/${id}/terminal`, this.baseUrl);
    // Convert http(s) to ws(s)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    // Pass auth cookie as query parameter since WebSocket connections
    // cannot set custom headers in the browser
    if (this.cookie) {
      wsUrl.searchParams.set("cookie", this.cookie);
    }
    return new WebSocket(wsUrl.toString());
  }
}
