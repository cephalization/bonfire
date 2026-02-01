/**
 * Health Endpoint Tests
 *
 * Unit tests for the health check endpoint.
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../index";

describe("GET /health", () => {
  it("should return 200 with status ok", async () => {
    const app = createApp();
    const req = new Request("http://localhost/health");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
