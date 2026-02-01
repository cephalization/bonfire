/**
 * Quick Start Service
 *
 * Downloads Firecracker's public CI test images directly from S3.
 * This provides a zero-config way to get started with Bonfire.
 *
 * Firecracker CI Artifacts (Public S3):
 * - Kernels: https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/$VERSION/x86_64/vmlinux-*
 * - Rootfs: https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/$VERSION/x86_64/ubuntu-*.squashfs
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { images } from "../db/schema";
import { IMAGES_DIR } from "./registry";

export interface QuickStartImage {
  id: string;
  reference: string;
  kernelPath: string;
  rootfsPath: string;
  sizeBytes: number;
  pulledAt: Date;
}

// Public Firecracker CI artifacts
// Note: Firecracker uses CI build IDs instead of version numbers for artifacts
const CI_BUILD_ID = "v1.14-itazur";
const CI_BASE_URL = `https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/${CI_BUILD_ID}/x86_64`;

const QUICKSTART_ASSETS = {
  kernel: {
    url: `${CI_BASE_URL}/vmlinux-5.10.242`,
    filename: "vmlinux-5.10.242",
    size: 38 * 1024 * 1024, // ~38MB
  },
  rootfs: {
    url: `${CI_BASE_URL}/ubuntu-24.04.squashfs`,
    filename: "ubuntu-24.04.squashfs",
    size: 103 * 1024 * 1024, // ~103MB
  },
};

/**
 * Downloads a file from a URL and saves it to disk.
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  
  const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  await writeFile(destPath, buffer);
  
  if (onProgress) {
    onProgress(buffer.length, totalSize || buffer.length);
  }
}

export interface QuickStartConfig {
  db: BetterSQLite3Database<typeof schema>;
  imagesDir?: string;
}

export class QuickStartService {
  private db: BetterSQLite3Database<typeof schema>;
  private imagesDir: string;

  constructor(config: QuickStartConfig) {
    this.db = config.db;
    this.imagesDir = config.imagesDir || IMAGES_DIR;
  }

  /**
   * Downloads Firecracker's public test images for quick evaluation.
   *
   * @param options - Download options including progress callback
   * @returns The downloaded image metadata
   */
  async downloadQuickStartImage(options?: {
    onProgress?: (progress: { 
      stage: string; 
      downloadedBytes: number; 
      totalBytes: number; 
      percentage: number;
    }) => void;
  }): Promise<QuickStartImage> {
    const { onProgress } = options || {};
    
    const reference = "firecracker-quickstart:ubuntu-24.04";
    const imageId = createHash("sha256").update(reference).digest("hex");
    const imageDir = join(this.imagesDir, imageId);
    
    // Ensure directory exists
    await mkdir(imageDir, { recursive: true });

    // Check if already exists
    const [existing] = await this.db
      .select()
      .from(images)
      .where(eq(images.id, imageId));
    
    if (existing) {
      return {
        id: existing.id,
        reference: existing.reference,
        kernelPath: existing.kernelPath,
        rootfsPath: existing.rootfsPath,
        sizeBytes: existing.sizeBytes ?? 0,
        pulledAt: new Date(existing.pulledAt),
      };
    }

    const kernelPath = join(imageDir, "kernel");
    const rootfsPath = join(imageDir, "rootfs");

    // Download kernel
    onProgress?.({
      stage: "kernel",
      downloadedBytes: 0,
      totalBytes: QUICKSTART_ASSETS.kernel.size,
      percentage: 0,
    });

    await downloadFile(QUICKSTART_ASSETS.kernel.url, kernelPath, (downloaded, total) => {
      onProgress?.({
        stage: "kernel",
        downloadedBytes: downloaded,
        totalBytes: total,
        percentage: Math.floor((downloaded / total) * 40),
      });
    });

    // Download rootfs
    onProgress?.({
      stage: "rootfs",
      downloadedBytes: 0,
      totalBytes: QUICKSTART_ASSETS.rootfs.size,
      percentage: 40,
    });

    await downloadFile(QUICKSTART_ASSETS.rootfs.url, rootfsPath, (downloaded, total) => {
      onProgress?.({
        stage: "rootfs",
        downloadedBytes: downloaded,
        totalBytes: total,
        percentage: 40 + Math.floor((downloaded / total) * 50),
      });
    });

    // Get actual file sizes
    const fs = await import("fs/promises");
    const kernelStat = await fs.stat(kernelPath);
    const rootfsStat = await fs.stat(rootfsPath);
    const totalSize = kernelStat.size + rootfsStat.size;

    // Save to database
    const now = new Date();
    const image: QuickStartImage = {
      id: imageId,
      reference,
      kernelPath,
      rootfsPath,
      sizeBytes: totalSize,
      pulledAt: now,
    };

    await this.db.insert(images).values({
      id: image.id,
      reference: image.reference,
      kernelPath: image.kernelPath,
      rootfsPath: image.rootfsPath,
      sizeBytes: image.sizeBytes,
      pulledAt: image.pulledAt,
    });

    onProgress?.({
      stage: "complete",
      downloadedBytes: totalSize,
      totalBytes: totalSize,
      percentage: 100,
    });

    return image;
  }
}
