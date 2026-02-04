/**
 * Image Commands (Simplified)
 *
 * Implements the image subcommands for the Bonfire CLI:
 * - list: List all registered images
 * - rm: Remove a registered image
 *
 * NOTE: 'pull' command has been removed as OCI registry pulling
 * has been simplified to local file path registration only.
 */

import { confirm, isCancel, cancel, note, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { BonfireClient } from "@bonfire/sdk";

// Image types matching the API schema
export interface Image {
  id: string;
  reference: string;
  kernelPath: string;
  rootfsPath: string;
  sizeBytes: number | null;
  pulledAt: string;
}

// API client functions
async function apiRequest<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = new URL(path, baseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Format bytes to human-readable string
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "-";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Format date to relative time
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Image Command Handlers

export async function handleImageList(_client: BonfireClient, baseUrl: string): Promise<void> {
  const images = await apiRequest<Image[]>(baseUrl, "GET", "/api/images");

  if (images.length === 0) {
    note("No images found. Images must be registered via the API directly.");
    return;
  }

  // Calculate column widths
  const idWidth = Math.max(8, ...images.map((img) => img.id.length));
  const refWidth = Math.max(10, ...images.map((img) => img.reference.length));
  const sizeWidth = 8;

  // Print header
  const header = [
    pc.bold("ID".padEnd(idWidth)),
    pc.bold("Reference".padEnd(refWidth)),
    pc.bold("Size".padEnd(sizeWidth)),
    pc.bold("Pulled At"),
  ].join("  ");

  const separator = pc.gray("-".repeat(header.length));

  // Build table rows
  const rows = images.map((image) => {
    return [
      image.id.padEnd(idWidth),
      image.reference.padEnd(refWidth),
      formatBytes(image.sizeBytes).padEnd(sizeWidth),
      formatDate(image.pulledAt),
    ].join("  ");
  });

  note([header, separator, ...rows].join("\n"), "Images");
}

export async function handleImageRemove(
  _client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("Image ID is required. Usage: bonfire image rm <id>");
  }

  const imageId = args[0];

  // Get image details first to show in confirmation
  let images: Image[];
  try {
    images = await apiRequest<Image[]>(baseUrl, "GET", "/api/images");
  } catch (error) {
    throw new Error(
      `Failed to fetch images: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const image = images.find((img) => img.id === imageId);
  if (!image) {
    throw new Error(`Image not found: ${imageId}`);
  }

  const shouldDelete = await confirm({
    message: `Are you sure you want to delete image "${image.reference}" (${imageId})?`,
    initialValue: false,
  });

  if (isCancel(shouldDelete) || !shouldDelete) {
    cancel("Deletion cancelled");
    return;
  }

  const s = spinner();
  s.start(`Deleting image ${imageId}...`);

  try {
    await apiRequest<{ success: true }>(
      baseUrl,
      "DELETE",
      `/api/images/${encodeURIComponent(imageId)}`
    );
    s.stop(`Image "${image.reference}" deleted successfully`);
  } catch (error) {
    s.stop("Failed to delete image");
    throw error;
  }
}

// Main entry point for image command
export async function handleImageCommand(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<number> {
  const subcommand = args[0];

  if (!subcommand) {
    cancel(
      "Usage: bonfire image <list|rm> [args...]\n\nNote: 'pull' command has been removed.\nImages must be registered via the API directly."
    );
    return 1;
  }

  const subcommandArgs = args.slice(1);

  try {
    switch (subcommand) {
      case "list":
        await handleImageList(client, baseUrl);
        return 0;
      case "rm":
        await handleImageRemove(client, baseUrl, subcommandArgs);
        return 0;
      case "pull":
        cancel(
          "Error: 'pull' command has been removed.\n\nOCI registry pulling has been simplified to local file path registration.\nImages must be registered via the API directly."
        );
        return 1;
      default:
        cancel(`Unknown image subcommand: ${subcommand}\nValid subcommands: list, rm`);
        return 1;
    }
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
