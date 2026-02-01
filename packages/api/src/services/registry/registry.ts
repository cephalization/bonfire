/**
 * OCI Registry Service
 *
 * This service pulls OCI images (kernel + rootfs) from registries.
 * Follows the OCI Distribution Specification:
 * https://github.com/opencontainers/distribution-spec
 */

import { createHash } from "crypto";
import { mkdir, writeFile, unlink, rmdir, stat } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Image, NewImage } from "../../db/schema";
import { images } from "../../db/schema";
import { eq } from "drizzle-orm";

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface ParsedReference {
  registry: string;
  repository: string;
  tag: string;
}

export interface PullOptions {
  onProgress?: (progress: PullProgress) => void;
}

export interface PullProgress {
  layer: string;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export interface OCIDescriptor {
  mediaType: string;
  size: number;
  digest: string;
}

export interface OCIManifest {
  schemaVersion: number;
  mediaType?: string;
  config: OCIDescriptor;
  layers: OCIDescriptor[];
  annotations?: Record<string, string>;
}

export interface RegistryError extends Error {
  statusCode?: number;
  code?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export const IMAGES_DIR = process.env.IMAGES_DIR || "/var/lib/bonfire/images";

export const OCI_MEDIA_TYPES = {
  MANIFEST: "application/vnd.oci.image.manifest.v1+json",
  INDEX: "application/vnd.oci.image.index.v1+json",
  CONFIG: "application/vnd.oci.image.config.v1+json",
  LAYER_TAR_GZIP: "application/vnd.oci.image.layer.v1.tar+gzip",
  LAYER_TAR: "application/vnd.oci.image.layer.v1.tar",
} as const;

// ============================================================================
// Reference Parsing
// ============================================================================

/**
 * Parses an OCI image reference into its components.
 * Supports formats:
 * - registry/repo:tag
 * - registry/namespace/repo:tag
 * - ghcr.io/openfaasltd/slicer-systemd:5.10.240-x86_64-latest
 *
 * @param reference - The image reference string
 * @returns ParsedReference with registry, repository, and tag
 */
export function parseReference(reference: string): ParsedReference {
  if (!reference || reference.trim() === "") {
    throw new Error("Reference cannot be empty");
  }

  // Default tag
  let tag = "latest";
  let fullRef = reference;

  // Extract tag if present
  const tagIndex = reference.lastIndexOf(":");
  const slashIndex = reference.lastIndexOf("/");
  
  if (tagIndex > slashIndex && tagIndex > 0) {
    tag = reference.slice(tagIndex + 1);
    fullRef = reference.slice(0, tagIndex);
  }

  // Split into registry and repository
  const parts = fullRef.split("/");
  
  if (parts.length < 2) {
    // Just repository name, use default registry
    return {
      registry: "registry-1.docker.io",
      repository: fullRef,
      tag,
    };
  }

  // Check if first part is a registry (contains . or : or is "localhost")
  const firstPart = parts[0];
  const isRegistry = 
    firstPart.includes(".") || 
    firstPart.includes(":") || 
    firstPart === "localhost";

  if (isRegistry) {
    return {
      registry: firstPart,
      repository: parts.slice(1).join("/"),
      tag,
    };
  }

  // No registry specified, use default
  return {
    registry: "registry-1.docker.io",
    repository: fullRef,
    tag,
  };
}

/**
 * Generates a unique ID from the reference string.
 *
 * @param reference - The image reference
 * @returns SHA256 hash of the reference
 */
export function generateImageId(reference: string): string {
  return createHash("sha256").update(reference).digest("hex");
}

/**
 * Creates a safe directory name from the reference.
 *
 * @param reference - The image reference
 * @returns Safe directory name
 */
export function createSafeDirName(reference: string): string {
  return reference.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

// ============================================================================
// HTTP Helpers
// ============================================================================

/**
 * Constructs the base URL for a registry.
 *
 * @param registry - The registry hostname
 * @returns HTTPS URL for the registry
 */
export function getRegistryUrl(registry: string): string {
  // GHCR.io and other registries use HTTPS
  return `https://${registry}`;
}

/**
 * Fetches the manifest for an image from the registry.
 *
 * @param registry - Registry hostname
 * @param repository - Repository path
 * @param tag - Image tag
 * @returns The OCI manifest
 */
export async function fetchManifest(
  registry: string,
  repository: string,
  tag: string
): Promise<OCIManifest> {
  const baseUrl = getRegistryUrl(registry);
  const url = `${baseUrl}/v2/${repository}/manifests/${tag}`;

  const response = await fetch(url, {
    headers: {
      Accept: `${OCI_MEDIA_TYPES.MANIFEST},${OCI_MEDIA_TYPES.INDEX}`,
    },
  });

  if (!response.ok) {
    const error: RegistryError = new Error(
      `Failed to fetch manifest: ${response.status} ${response.statusText}`
    );
    error.statusCode = response.status;
    throw error;
  }

  // Check if we got an index (multi-arch) or manifest
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("index")) {
    // Got an index, we need to parse it and select the appropriate manifest
    const index = await response.json();
    
    if (!index.manifests || index.manifests.length === 0) {
      throw new Error("Image index contains no manifests");
    }
    
    // Select the first manifest (could be enhanced to match platform)
    const manifestDescriptor = index.manifests[0];
    
    // Fetch the actual manifest
    const manifestUrl = `${baseUrl}/v2/${repository}/manifests/${manifestDescriptor.digest}`;
    const manifestResponse = await fetch(manifestUrl, {
      headers: {
        Accept: OCI_MEDIA_TYPES.MANIFEST,
      },
    });
    
    if (!manifestResponse.ok) {
      const error: RegistryError = new Error(
        `Failed to fetch manifest from index: ${manifestResponse.status} ${manifestResponse.statusText}`
      );
      error.statusCode = manifestResponse.status;
      throw error;
    }
    
    return manifestResponse.json();
  }

  return response.json();
}

/**
 * Fetches a blob from the registry and streams it to a file.
 *
 * @param registry - Registry hostname
 * @param repository - Repository path
 * @param digest - Blob digest (format: sha256:xxx)
 * @param destPath - Destination file path
 * @param onProgress - Optional progress callback
 */
export async function fetchBlob(
  registry: string,
  repository: string,
  digest: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const baseUrl = getRegistryUrl(registry);
  const url = `${baseUrl}/v2/${repository}/blobs/${digest}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error: RegistryError = new Error(
      `Failed to fetch blob: ${response.status} ${response.statusText}`
    );
    error.statusCode = response.status;
    throw error;
  }

  const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Write to file
  await writeFile(destPath, buffer);

  // Report progress
  if (onProgress) {
    onProgress(buffer.length, totalSize || buffer.length);
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Ensures the images directory exists.
 */
export async function ensureImagesDir(): Promise<void> {
  try {
    await mkdir(IMAGES_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create images directory: ${error}`);
  }
}

/**
 * Gets the path for a specific image's data.
 *
 * @param imageId - The unique image ID
 * @returns Full path to the image directory
 */
export function getImagePath(imageId: string): string {
  return join(IMAGES_DIR, imageId);
}

/**
 * Extracts a gzip-compressed tarball.
 *
 * @param sourcePath - Path to the .tar.gz file
 * @param destDir - Destination directory
 */
export async function extractTarGz(
  sourcePath: string,
  destDir: string
): Promise<void> {
  await mkdir(destDir, { recursive: true });

  // Use tar command for extraction (more reliable than pure JS)
  try {
    await execAsync(`tar -xzf "${sourcePath}" -C "${destDir}"`);
  } catch (error) {
    throw new Error(`Failed to extract tarball: ${error}`);
  }
}

// ============================================================================
// Main Functions
// ============================================================================

export interface RegistryServiceConfig {
  db: BetterSQLite3Database<typeof import("../../db/schema")>;
  imagesDir?: string;
}

export class RegistryService {
  private db: BetterSQLite3Database<typeof import("../../db/schema")>;
  private imagesDir: string;

  constructor(config: RegistryServiceConfig) {
    this.db = config.db;
    this.imagesDir = config.imagesDir || IMAGES_DIR;
  }

  /**
   * Pulls an OCI image from a registry.
   *
   * @param reference - The image reference (registry/repo:tag)
   * @param options - Pull options including progress callback
   * @returns The pulled image metadata
   */
  async pullImage(reference: string, options?: PullOptions): Promise<Image> {
    const { onProgress } = options || {};
    
    // Parse the reference
    const parsed = parseReference(reference);
    
    // Generate unique ID for this image
    const imageId = generateImageId(reference);
    const imageDir = join(this.imagesDir, imageId);
    
    // Ensure images directory exists
    await mkdir(this.imagesDir, { recursive: true });
    await mkdir(imageDir, { recursive: true });

    try {
      // Fetch manifest
      onProgress?.({
        layer: "manifest",
        downloadedBytes: 0,
        totalBytes: 0,
        percentage: 10,
      });

      const manifest = await fetchManifest(
        parsed.registry,
        parsed.repository,
        parsed.tag
      );

      onProgress?.({
        layer: "manifest",
        downloadedBytes: 1,
        totalBytes: 1,
        percentage: 20,
      });

      // For Slicer images, we expect kernel and rootfs layers
      // Kernel is typically the first layer, rootfs is the second
      if (manifest.layers.length < 2) {
        throw new Error(
          `Image must have at least 2 layers (kernel + rootfs), found ${manifest.layers.length}`
        );
      }

      const kernelLayer = manifest.layers[0];
      const rootfsLayer = manifest.layers[1];

      // Download kernel
      const kernelPath = join(imageDir, "kernel");
      onProgress?.({
        layer: "kernel",
        downloadedBytes: 0,
        totalBytes: kernelLayer.size,
        percentage: 25,
      });

      await fetchBlob(
        parsed.registry,
        parsed.repository,
        kernelLayer.digest,
        kernelPath,
        (downloaded, total) => {
          onProgress?.({
            layer: "kernel",
            downloadedBytes: downloaded,
            totalBytes: total,
            percentage: 25 + Math.floor((downloaded / total) * 25),
          });
        }
      );

      // Download rootfs
      const rootfsPath = join(imageDir, "rootfs");
      onProgress?.({
        layer: "rootfs",
        downloadedBytes: 0,
        totalBytes: rootfsLayer.size,
        percentage: 50,
      });

      await fetchBlob(
        parsed.registry,
        parsed.repository,
        rootfsLayer.digest,
        rootfsPath,
        (downloaded, total) => {
          onProgress?.({
            layer: "rootfs",
            downloadedBytes: downloaded,
            totalBytes: total,
            percentage: 50 + Math.floor((downloaded / total) * 45),
          });
        }
      );

      // Calculate total size
      const kernelStats = await stat(kernelPath);
      const rootfsStats = await stat(rootfsPath);
      const totalSize = kernelStats.size + rootfsStats.size;

      onProgress?.({
        layer: "complete",
        downloadedBytes: totalSize,
        totalBytes: totalSize,
        percentage: 100,
      });

      // Save to database
      const newImage: NewImage = {
        id: imageId,
        reference,
        kernelPath,
        rootfsPath,
        sizeBytes: totalSize,
        pulledAt: new Date(),
      };

      await this.db.insert(images).values(newImage).onConflictDoUpdate({
        target: images.reference,
        set: {
          kernelPath,
          rootfsPath,
          sizeBytes: totalSize,
          pulledAt: new Date(),
        },
      });

      // Fetch and return the image record
      const [image] = await this.db
        .select()
        .from(images)
        .where(eq(images.id, imageId));

      if (!image) {
        throw new Error("Failed to retrieve image after insert");
      }

      return image;
    } catch (error) {
      // Clean up on failure
      try {
        await this.cleanupImageDir(imageId);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Deletes an image from disk and database.
   *
   * @param imageId - The unique image ID
   */
  async deleteImage(imageId: string): Promise<void> {
    // Remove from database first
    await this.db.delete(images).where(eq(images.id, imageId));

    // Clean up files
    await this.cleanupImageDir(imageId);
  }

  /**
   * Cleans up an image directory.
   *
   * @param imageId - The unique image ID
   */
  private async cleanupImageDir(imageId: string): Promise<void> {
    const imageDir = join(this.imagesDir, imageId);
    
    try {
      // Try to remove files individually for better error handling
      const files = ["kernel", "rootfs"];
      
      for (const file of files) {
        try {
          await unlink(join(imageDir, file));
        } catch {
          // File might not exist, ignore
        }
      }

      // Remove the directory
      await rmdir(imageDir);
    } catch {
      // Directory might not exist, ignore
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a registry service instance.
 *
 * @param config - Configuration including database instance
 * @returns RegistryService instance
 */
export function createRegistryService(
  config: RegistryServiceConfig
): RegistryService {
  return new RegistryService(config);
}
