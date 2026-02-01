/**
 * Image Commands
 *
 * Implements the image subcommands for the Bonfire CLI:
 * - pull: Pull an image from registry
 * - list: List all cached images
 * - rm: Remove a cached image
 */

import {
  spinner,
  confirm,
  isCancel,
  cancel,
} from "@clack/prompts";
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
export async function handleImagePull(
  client: BonfireClient,
  baseUrl: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("Image reference is required. Usage: bonfire image pull <reference>");
  }

  const reference = args[0];

  const s = spinner();
  s.start(`Pulling image ${reference}...`);

  try {
    const image = await apiRequest<Image>(baseUrl, "POST", "/api/images/pull", {
      reference,
    });
    s.stop(pc.green(`✓ Image pulled successfully`));

    console.log();
    console.log(pc.bold("Image Details:"));
    console.log(`  ID:         ${image.id}`);
    console.log(`  Reference:  ${image.reference}`);
    console.log(`  Size:       ${formatBytes(image.sizeBytes)}`);
    console.log(`  Pulled At:  ${new Date(image.pulledAt).toLocaleString()}`);
  } catch (error) {
    s.stop(pc.red("Failed to pull image"));
    throw error;
  }
}

export async function handleImageList(
  client: BonfireClient,
  baseUrl: string
): Promise<void> {
  try {
    const images = await apiRequest<Image[]>(baseUrl, "GET", "/api/images");

    if (images.length === 0) {
      console.log(pc.gray("No images found. Use 'bonfire image pull <reference>' to pull an image."));
      return;
    }

    // Calculate column widths
    const idWidth = Math.max(8, ...images.map((img) => img.id.length));
    const refWidth = Math.max(10, ...images.map((img) => img.reference.length));
    const sizeWidth = 8;
    const pulledWidth = 12;

    // Print header
    const header = [
      "ID".padEnd(idWidth),
      "Reference".padEnd(refWidth),
      "Size".padEnd(sizeWidth),
      "Pulled At",
    ].join("  ");

    console.log(pc.bold(header));
    console.log(pc.gray("-".repeat(header.length)));

    // Print rows
    for (const image of images) {
      const row = [
        image.id.padEnd(idWidth),
        image.reference.padEnd(refWidth),
        formatBytes(image.sizeBytes).padEnd(sizeWidth),
        formatDate(image.pulledAt),
      ].join("  ");

      console.log(row);
    }
  } catch (error) {
    throw error;
  }
}

export async function handleImageRemove(
  client: BonfireClient,
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
    throw new Error(`Failed to fetch images: ${error instanceof Error ? error.message : String(error)}`);
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
    s.stop(pc.green(`✓ Image "${image.reference}" deleted successfully`));
  } catch (error) {
    s.stop(pc.red("Failed to delete image"));
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
    console.error(pc.red("Usage: bonfire image <pull|list|rm> [args...]"));
    return 1;
  }

  const subcommandArgs = args.slice(1);

  try {
    switch (subcommand) {
      case "pull":
        await handleImagePull(client, baseUrl, subcommandArgs);
        return 0;
      case "list":
        await handleImageList(client, baseUrl);
        return 0;
      case "rm":
        await handleImageRemove(client, baseUrl, subcommandArgs);
        return 0;
      default:
        console.error(pc.red(`Unknown image subcommand: ${subcommand}`));
        console.error(pc.gray("Valid subcommands: pull, list, rm"));
        return 1;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(pc.red(`Error: ${error.message}`));
    } else {
      console.error(pc.red(`Error: ${String(error)}`));
    }
    return 1;
  }
}
