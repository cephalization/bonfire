/**
 * Image registration
 *
 * An image is a kernel and a rootfs already on the host's disk. Registering
 * one records the paths; nothing is copied. Used by the images route and by
 * the default-image bootstrap at server start.
 */

import { createHash } from "crypto";
import { existsSync } from "fs";
import { stat } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { images } from "../db/schema";

type Db = BetterSQLite3Database<typeof schema>;

export const DEFAULT_IMAGE_REFERENCE = "local:agent-ready";
export const DOCKER_IMAGES_DIR = "/var/lib/bonfire/images";

/**
 * Walk up from this module to the pnpm workspace root, in both `src/` and the
 * bundled `dist/` layout. Null when the package is installed somewhere else.
 */
export function findRepoRoot(
  from: string = dirname(fileURLToPath(import.meta.url))
): string | null {
  let current = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, "pnpm-workspace.yaml")) || existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Where the kernel and rootfs files live. `IMAGES_DIR` wins; otherwise the
 * Docker data directory when it exists, else `images/` at the repo root,
 * which is where `scripts/build-agent-image-docker.sh` writes.
 */
export function resolveDefaultImagesDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.IMAGES_DIR) return env.IMAGES_DIR;
  if (existsSync(DOCKER_IMAGES_DIR)) return DOCKER_IMAGES_DIR;
  const repoRoot = findRepoRoot();
  return repoRoot ? join(repoRoot, "images") : DOCKER_IMAGES_DIR;
}

export const DEFAULT_IMAGES_DIR = resolveDefaultImagesDir();

export interface RegisterLocalImageInput {
  reference: string;
  /** Absolute path to an existing kernel file. */
  kernelPath: string;
  /** Absolute path to an existing rootfs file. */
  rootfsPath: string;
}

/** Register the image, or refresh its paths if the reference already exists. */
export async function registerLocalImage(
  db: Db,
  input: RegisterLocalImageInput
): Promise<schema.Image> {
  const { reference, kernelPath, rootfsPath } = input;

  const [kernelStat, rootfsStat] = await Promise.all([stat(kernelPath), stat(rootfsPath)]);
  const sizeBytes = kernelStat.size + rootfsStat.size;
  const now = new Date();

  const [existing] = await db.select().from(images).where(eq(images.reference, reference));

  if (existing) {
    await db
      .update(images)
      .set({ kernelPath, rootfsPath, sizeBytes, pulledAt: now })
      .where(eq(images.reference, reference));
  } else {
    await db.insert(images).values({
      id: createHash("sha256").update(reference).digest("hex"),
      reference,
      kernelPath,
      rootfsPath,
      sizeBytes,
      pulledAt: now,
    });
  }

  const [saved] = await db.select().from(images).where(eq(images.reference, reference));
  if (!saved) throw new Error("Failed to register local image");
  return saved;
}

/**
 * Register the default agent image if its files are present on disk.
 *
 * The Docker image ships `agent-kernel` and `agent-rootfs.ext4` into the data
 * directory. Doing this in-process at startup means no credential is needed,
 * which matters now that every API route requires a signed-in user.
 */
export async function bootstrapDefaultImage(
  db: Db,
  imagesDir: string = DEFAULT_IMAGES_DIR
): Promise<schema.Image | null> {
  const kernelPath = `${imagesDir}/agent-kernel`;
  const rootfsPath = `${imagesDir}/agent-rootfs.ext4`;

  try {
    await Promise.all([stat(kernelPath), stat(rootfsPath)]);
  } catch {
    return null;
  }

  const [existing] = await db
    .select()
    .from(images)
    .where(eq(images.reference, DEFAULT_IMAGE_REFERENCE));
  if (existing) return existing;

  return registerLocalImage(db, { reference: DEFAULT_IMAGE_REFERENCE, kernelPath, rootfsPath });
}
