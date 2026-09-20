import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, relative } from "path";
import { mountWebApp } from "./web-assets";

/**
 * The static handler resolves roots relative to the working directory, so the
 * fixture lives under it rather than in the system temp directory.
 */
let root: string;
let relativeRoot: string;

beforeAll(() => {
  root = mkdtempSync(join(process.cwd(), "web-assets-test-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>bonfire</title>");
  writeFileSync(join(root, "assets", "app.js"), "console.log('app')");
  relativeRoot = `./${relative(process.cwd(), root)}`;
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function appWithWeb() {
  const app = new OpenAPIHono();
  app.get("/api/vms", (c) => c.json({ vms: [] }));
  mountWebApp(app, relativeRoot);
  return app;
}

describe("mountWebApp", () => {
  it("serves the built index at the root", async () => {
    const response = await appWithWeb().request("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("bonfire");
  });

  it("serves built assets", async () => {
    const response = await appWithWeb().request("/assets/app.js");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("console.log");
  });

  it("falls back to the index for client-side routes", async () => {
    const response = await appWithWeb().request("/conversations/abc123");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("bonfire");
  });

  it("leaves API routes alone", async () => {
    const response = await appWithWeb().request("/api/vms");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vms: [] });
  });

  it("does not answer unknown API paths with the index", async () => {
    const response = await appWithWeb().request("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<!doctype html>");
  });
});
