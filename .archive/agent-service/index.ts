/**
 * Agent Service
 *
 * HTTP client for communicating with guest agents running inside VMs.
 */

export {
  AgentClient,
  createAgentClient,
  AgentError,
  AgentTimeoutError,
  AgentConnectionError,
} from "./client";

export type { ExecResult, AgentClientOptions } from "./client";

// Shell service exports
export {
  connectToShell,
  createShellConnection,
  parseResizeMessage,
  isResizeMessage,
  formatOutputData,
  formatInputData,
  ShellError,
  ShellConnectionError,
} from "./shell";

export type {
  ShellStream,
  ShellConnectionOptions,
} from "./shell";
