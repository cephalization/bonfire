import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { applyMigrations } from "../db/migrate";
import {
  bootstrapDefaultImage,
  DEFAULT_IMAGE_REFERENCE,
  DOCKER_IMAGES_DIR,
  findRepoRoot,
  registerLocalImage,
  resolveDefaultImagesDir,
} from "./images";

function createDb() {
  const sqlite = new Database(":memory:");
  applyMigrations(sqlite);
  return drizzle(sqlite, { schema });
}

describe("images service", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("registers an image and refreshes it on re-registration", async () => {
    dir = await mkdtemp(join(tmpdir(), "bonfire-images-"));
    const kernelPath = join(dir, "kernel");
    const rootfsPath = join(dir, "rootfs.ext4");
    await writeFile(kernelPath, "abc");
    await writeFile(rootfsPath, "defgh");
    const db = createDb();

    const first = await registerLocalImage(db, { reference: "local:x", kernelPath, rootfsPath });
    expect(first.sizeBytes).toBe(8);

    await writeFile(rootfsPath, "defghij");
    const second = await registerLocalImage(db, { reference: "local:x", kernelPath, rootfsPath });
    expect(second.id).toBe(first.id);
    expect(second.sizeBytes).toBe(10);
  });

  it("bootstraps the default image only when both files exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "bonfire-images-"));
    const db = createDb();

    expect(await bootstrapDefaultImage(db, dir)).toBeNull();

    await writeFile(join(dir, "agent-kernel"), "k");
    expect(await bootstrapDefaultImage(db, dir)).toBeNull();

    await writeFile(join(dir, "agent-rootfs.ext4"), "r");
    const image = await bootstrapDefaultImage(db, dir);
    expect(image?.reference).toBe(DEFAULT_IMAGE_REFERENCE);

    // A second boot leaves the existing row alone.
    expect((await bootstrapDefaultImage(db, dir))?.id).toBe(image!.id);
  });
});

describe("resolveDefaultImagesDir", () => {
  it("prefers IMAGES_DIR", () => {
    expect(resolveDefaultImagesDir({ IMAGES_DIR: "/somewhere/images" })).toBe("/somewhere/images");
  });

  it("falls back to images/ at the repo root outside Docker", () => {
    const repoRoot = findRepoRoot();
    expect(repoRoot).not.toBeNull();
    const resolved = resolveDefaultImagesDir({});
    expect([join(repoRoot!, "images"), DOCKER_IMAGES_DIR]).toContain(resolved);
  });
});
