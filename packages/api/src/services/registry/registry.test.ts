/**
 * Registry Service Unit Tests
 *
 * Tests for OCI image reference parsing and related utilities.
 * Integration tests for actual pulls require network and are in separate file.
 */

import { describe, it, expect } from "vitest";
import {
  parseReference,
  generateImageId,
  createSafeDirName,
  getRegistryUrl,
  ParsedReference,
} from "./registry";

// ============================================================================
// Reference Parsing Tests
// ============================================================================

describe("parseReference", () => {
  it("should parse a simple reference with registry, repo, and tag", () => {
    const ref = "ghcr.io/openfaasltd/slicer-systemd:5.10.240-x86_64-latest";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "ghcr.io",
      repository: "openfaasltd/slicer-systemd",
      tag: "5.10.240-x86_64-latest",
    });
  });

  it("should parse a reference with default tag (latest)", () => {
    const ref = "ghcr.io/openfaasltd/slicer-systemd";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "ghcr.io",
      repository: "openfaasltd/slicer-systemd",
      tag: "latest",
    });
  });

  it("should parse a reference with nested repository path", () => {
    const ref = "registry.example.com/org/project/subproject:tag";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "registry.example.com",
      repository: "org/project/subproject",
      tag: "tag",
    });
  });

  it("should parse a reference with port in registry", () => {
    const ref = "localhost:5000/myrepo:mytag";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "localhost:5000",
      repository: "myrepo",
      tag: "mytag",
    });
  });

  it("should use default Docker Hub registry when no registry specified", () => {
    const ref = "library/ubuntu:latest";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "registry-1.docker.io",
      repository: "library/ubuntu",
      tag: "latest",
    });
  });

  it("should use default Docker Hub registry for simple repo name", () => {
    const ref = "ubuntu";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "registry-1.docker.io",
      repository: "ubuntu",
      tag: "latest",
    });
  });

  it("should handle digest references (the @ is included in repository)", () => {
    const ref = "ghcr.io/openfaasltd/slicer-systemd@sha256:abc123";
    const result = parseReference(ref);

    // The @ is not a recognized separator - it becomes part of the repository path
    expect(result.registry).toBe("ghcr.io");
    expect(result.repository).toBe("openfaasltd/slicer-systemd@sha256");
    expect(result.tag).toBe("abc123");
  });

  it("should handle tag with special characters", () => {
    const ref = "ghcr.io/repo/image:v1.0.0-beta.1";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "ghcr.io",
      repository: "repo/image",
      tag: "v1.0.0-beta.1",
    });
  });

  it("should throw error for empty reference", () => {
    expect(() => parseReference("")).toThrow("Reference cannot be empty");
    expect(() => parseReference("   ")).toThrow("Reference cannot be empty");
  });

  it("should handle repository names with dots", () => {
    const ref = "ghcr.io/org.io/project:latest";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "ghcr.io",
      repository: "org.io/project",
      tag: "latest",
    });
  });

  it("should handle repository names with hyphens", () => {
    const ref = "docker.io/my-org/my-repo:v1";
    const result = parseReference(ref);

    expect(result).toEqual({
      registry: "docker.io",
      repository: "my-org/my-repo",
      tag: "v1",
    });
  });
});

// ============================================================================
// ID Generation Tests
// ============================================================================

describe("generateImageId", () => {
  it("should generate consistent SHA256 hash", () => {
    const ref = "ghcr.io/openfaasltd/slicer-systemd:latest";
    const id1 = generateImageId(ref);
    const id2 = generateImageId(ref);

    expect(id1).toBe(id2);
    expect(id1.length).toBe(64); // SHA256 hex = 64 chars
  });

  it("should generate different IDs for different references", () => {
    const id1 = generateImageId("ghcr.io/repo1:latest");
    const id2 = generateImageId("ghcr.io/repo2:latest");

    expect(id1).not.toBe(id2);
  });

  it("should generate different IDs for different tags", () => {
    const id1 = generateImageId("ghcr.io/repo:v1");
    const id2 = generateImageId("ghcr.io/repo:v2");

    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// Safe Directory Name Tests
// ============================================================================

describe("createSafeDirName", () => {
  it("should keep safe characters", () => {
    const ref = "ghcr.io-repo-image-v1.0.0";
    const result = createSafeDirName(ref);

    expect(result).toBe("ghcr.io-repo-image-v1.0.0");
  });

  it("should replace slashes with underscores", () => {
    const ref = "ghcr.io/repo/image";
    const result = createSafeDirName(ref);

    expect(result).toBe("ghcr.io_repo_image");
  });

  it("should replace colons with underscores", () => {
    const ref = "ghcr.io/repo:image";
    const result = createSafeDirName(ref);

    expect(result).toBe("ghcr.io_repo_image");
  });

  it("should replace special characters with underscores", () => {
    const ref = "ghcr.io/repo@image#test";
    const result = createSafeDirName(ref);

    expect(result).toBe("ghcr.io_repo_image_test");
  });
});

// ============================================================================
// Registry URL Tests
// ============================================================================

describe("getRegistryUrl", () => {
  it("should create HTTPS URL", () => {
    const result = getRegistryUrl("ghcr.io");
    expect(result).toBe("https://ghcr.io");
  });

  it("should create HTTPS URL with port", () => {
    const result = getRegistryUrl("localhost:5000");
    expect(result).toBe("https://localhost:5000");
  });

  it("should create HTTPS URL for Docker Hub", () => {
    const result = getRegistryUrl("registry-1.docker.io");
    expect(result).toBe("https://registry-1.docker.io");
  });
});
