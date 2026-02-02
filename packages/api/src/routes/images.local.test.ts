import { describe, it, expect } from "vitest";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createTestApp } from "../test-utils";

describe("Images API - local registration", () => {
  it("registers a local image by paths", async () => {
    const testApp = await createTestApp();

    const dir = `/tmp/bonfire-local-image-${Date.now()}`;
    await mkdir(dir, { recursive: true });

    const kernelPath = join(dir, "kernel");
    const rootfsPath = join(dir, "rootfs.ext4");

    await writeFile(kernelPath, "kernel-bytes");
    await writeFile(rootfsPath, "rootfs-bytes");

    const res = await testApp.request("/api/images/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: "local:test-agent",
        kernelPath,
        rootfsPath,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reference).toBe("local:test-agent");
    expect(body.kernelPath).toBe(kernelPath);
    expect(body.rootfsPath).toBe(rootfsPath);
    expect(typeof body.id).toBe("string");

    testApp.cleanup();
  });

  it("returns 400 when files are missing", async () => {
    const testApp = await createTestApp();

    const res = await testApp.request("/api/images/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: "local:missing",
        kernelPath: "/tmp/does-not-exist-kernel",
        rootfsPath: "/tmp/does-not-exist-rootfs",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Run ./scripts/build-agent-image-docker.sh");

    testApp.cleanup();
  });
});
