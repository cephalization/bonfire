/**
 * OpenAPI Specification Tests
 *
 * Unit tests for the OpenAPI spec generation.
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../index";

describe("GET /api/openapi.json", () => {
  it("should return valid OpenAPI 3.0 spec", async () => {
    const app = createApp();
    const req = new Request("http://localhost/api/openapi.json");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const spec = await res.json();

    // Verify OpenAPI version
    expect(spec.openapi).toBe("3.0.0");

    // Verify info object
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe("Bonfire API");
    expect(spec.info.version).toBeDefined();
    expect(spec.info.description).toBe("API for managing Firecracker microVMs");
  });

  it("should include health endpoint definition", async () => {
    const app = createApp();
    const req = new Request("http://localhost/api/openapi.json");
    const res = await app.fetch(req);

    const spec = await res.json();

    // Verify paths exist
    expect(spec.paths).toBeDefined();

    // Verify health endpoint exists
    expect(spec.paths["/health"]).toBeDefined();
    expect(spec.paths["/health"].get).toBeDefined();
    expect(spec.paths["/health"].get.summary).toBe("Health check");
    expect(spec.paths["/health"].get.tags).toContain("System");

    // Verify responses
    expect(spec.paths["/health"].get.responses["200"]).toBeDefined();
    expect(spec.paths["/health"].get.responses["200"].description).toBe("API is healthy");
  });

  it("should define HealthResponse schema", async () => {
    const app = createApp();
    const req = new Request("http://localhost/api/openapi.json");
    const res = await app.fetch(req);

    const spec = await res.json();

    // Verify components/schemas exist
    expect(spec.components).toBeDefined();
    expect(spec.components.schemas).toBeDefined();

    // Verify HealthResponse schema exists
    expect(spec.components.schemas.HealthResponse).toBeDefined();
    expect(spec.components.schemas.HealthResponse.properties.status).toBeDefined();
  });
});
