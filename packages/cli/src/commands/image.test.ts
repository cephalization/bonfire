/**
 * Unit tests for Image command argument parsing and utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  handleImageCommand,
  handleImagePull,
  handleImageList,
  handleImageRemove,
} from "./image.js";

// Mock the API for testing
const mockFetch = async (url: string, options?: RequestInit): Promise<Response> => {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Mock responses based on path
  if (path === "/api/images" && options?.method === "GET") {
    return new Response(
      JSON.stringify([
        {
          id: "img-123",
          reference: "ubuntu:latest",
          kernelPath: "/var/lib/bonfire/images/img-123/kernel",
          rootfsPath: "/var/lib/bonfire/images/img-123/rootfs",
          sizeBytes: 104857600,
          pulledAt: "2024-01-15T10:30:00Z",
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (path === "/api/images/pull" && options?.method === "POST") {
    const body = JSON.parse(options.body as string);
    return new Response(
      JSON.stringify({
        id: "img-456",
        reference: body.reference,
        kernelPath: `/var/lib/bonfire/images/img-456/kernel`,
        rootfsPath: `/var/lib/bonfire/images/img-456/rootfs`,
        sizeBytes: 209715200,
        pulledAt: new Date().toISOString(),
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }

  if (path.startsWith("/api/images/") && options?.method === "DELETE") {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
};

describe("handleImageCommand argument parsing", () => {
  it("returns error when no subcommand provided", async () => {
    const mockClient = {} as any;
    const exitCode = await handleImageCommand(mockClient, "http://localhost:3000", []);
    expect(exitCode).toBe(1);
  });

  it("returns error for unknown subcommand", async () => {
    const mockClient = {} as any;
    const exitCode = await handleImageCommand(mockClient, "http://localhost:3000", ["unknown"]);
    expect(exitCode).toBe(1);
  });
});

describe("handleImagePull", () => {
  it("throws when reference is missing", async () => {
    const mockClient = {} as any;

    await expect(handleImagePull(mockClient, "http://localhost:3000", [])).rejects.toThrow(
      "Image reference is required"
    );
  });
});

describe("handleImageRemove", () => {
  it("throws when image ID is missing", async () => {
    const mockClient = {} as any;

    await expect(handleImageRemove(mockClient, "http://localhost:3000", [])).rejects.toThrow(
      "Image ID is required"
    );
  });
});

describe("Image command dispatch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatches pull subcommand", async () => {
    const mockClient = {} as any;
    const exitCode = await handleImageCommand(mockClient, "http://localhost:3000", [
      "pull",
      "ubuntu:latest",
    ]);
    expect(exitCode).toBe(0);
  });

  it("dispatches list subcommand", async () => {
    const mockClient = {} as any;
    const exitCode = await handleImageCommand(mockClient, "http://localhost:3000", ["list"]);
    expect(exitCode).toBe(0);
  });
});
