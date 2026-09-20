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

// ============================================================================
// Conversations
// ============================================================================

export type AgentStatus = "offline" | "provisioning" | "idle" | "busy" | "error";

export interface Conversation {
  id: string;
  organizationId: string;
  title: string;
  createdById: string | null;
  /** The VM the attached agent runs in; null without an agent. */
  agentVmId: string | null;
  /** "provider/model" the agent was asked to use; null lets opencode pick. */
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
  /** Ordered parts of an agent message (text, tool calls, errors); empty for people. */
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

// ============================================================================
// Provider keys (per organization)
// ============================================================================

export interface Provider {
  id: string;
  name: string;
  keysUrl: string;
  configured: boolean;
  /** Last characters of the stored key, for telling keys apart. */
  keyHint: string | null;
  label: string | null;
  updatedAt: string | null;
}
