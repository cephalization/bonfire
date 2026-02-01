/**
 * Bonfire SDK Types
 *
 * Auto-generated from OpenAPI specification.
 * Do not edit manually.
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

export interface PullImageRequest {
  reference?: string;
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
