/**
 * Bonfire SDK Types
 *
 * Hand-written to match the API. See CLAUDE.md on generating this from
 * /api/openapi.json.
 */

// ============================================================================
// VM Types
// ============================================================================

export interface VM {
  id: string;
  name: string;
  status: "creating" | "running" | "stopped" | "error";
  vcpus: number;
  memoryMib: number;
  imageId: string | null;
  /** Organization that owns the VM. */
  organizationId: string | null;
  /** User who created the VM. */
  createdById: string | null;
  pid: number | null;
  socketPath: string | null;
  tapDevice: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVMRequest {
  name: string;
  vcpus?: number;
  memoryMib?: number;
  imageId: string;
  /**
   * Organization to create the VM in. Defaults to the organization the API
   * key was created for.
   */
  organizationId?: string;
}

// ============================================================================
// Image Types
// ============================================================================

export interface Image {
  id: string;
  reference: string;
  kernelPath: string;
  rootfsPath: string;
  sizeBytes: number | null;
  pulledAt: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface HealthResponse {
  status: string;
}

export interface ErrorResponse {
  error: string;
}

export interface SuccessResponse {
  success: boolean;
}

// ============================================================================
// Legacy exports for backwards compatibility
// ============================================================================

export type gethealthResponse = HealthResponse;
