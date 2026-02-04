/**
 * Bonfire SDK Client
 *
 * Auto-generated from OpenAPI specification.
 * Do not edit manually.
 */

import type { HealthResponse, VM, CreateVMRequest, Image, SuccessResponse } from "./types";

export interface ClientConfig {
  baseUrl?: string;
  apiKey?: string; // API key for authentication (X-API-Key header)
}

export class BonfireClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || "http://localhost:3000";
    this.apiKey = config.apiKey;
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
   * Create a WebSocket connection for terminal access to a VM
   * Returns a WebSocket instance connected to the VM's terminal
   * Note: API key must be passed differently for WebSocket connections
   */
  createTerminalWebSocket(id: string): WebSocket {
    const wsUrl = new URL(`/api/vms/${id}/terminal`, this.baseUrl);
    // Convert http(s) to ws(s)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    // Note: WebSocket connections in browsers cannot set custom headers.
    // The API key should be configured via other means (e.g., query param)
    // for browser-based WebSocket connections.
    return new WebSocket(wsUrl.toString());
  }
}
