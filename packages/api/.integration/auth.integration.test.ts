/**
 * Auth Integration Tests
 *
 * Tests for API Key authentication flow.
 * Replaces Better Auth with simple X-API-Key header validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp } from "../src/test-utils";

describe("Auth Integration Tests", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  // Default API key from config - must match packages/api/src/lib/config.ts
  const TEST_API_KEY = "dev-api-key-change-in-production";

  beforeEach(async () => {
    testApp = await createTestApp({ skipAuth: false });
  });

  afterEach(async () => {
    await testApp.cleanup();
  });

  describe("API Key Authentication", () => {
    it("allows requests with valid X-API-Key header", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": TEST_API_KEY },
      });

      // Should not return 401
      expect(response.status).not.toBe(401);
    });

    it("rejects requests without X-API-Key header", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("X-API-Key header required");
    });

    it("rejects requests with invalid API key", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": "invalid-key" },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("invalid API key");
    });

    it("rejects requests with empty API key", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": "" },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("X-API-Key header required");
    });
  });

  describe("Protected Routes", () => {
    it("rejects VM list without API key", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
      });

      expect(response.status).toBe(401);
    });

    it("rejects VM creation without API key", async () => {
      const response = await testApp.request("/api/vms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test-vm" }),
      });

      expect(response.status).toBe(401);
    });

    it("rejects image list without API key", async () => {
      const response = await testApp.request("/api/images", {
        method: "GET",
      });

      expect(response.status).toBe(401);
    });

    it("allows VM list with valid API key", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": TEST_API_KEY },
      });

      expect(response.status).not.toBe(401);
    });

    it("allows image list with valid API key", async () => {
      const response = await testApp.request("/api/images", {
        method: "GET",
        headers: { "X-API-Key": TEST_API_KEY },
      });

      expect(response.status).not.toBe(401);
    });
  });

  describe("Complete Auth Flow", () => {
    it("complete flow: access denied without key, access granted with key", async () => {
      // Step 1: Try to access without API key - should fail
      const noKeyResponse = await testApp.request("/api/vms", {
        method: "GET",
      });
      expect(noKeyResponse.status).toBe(401);

      // Step 2: Try with wrong key - should fail
      const wrongKeyResponse = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": "wrong-key" },
      });
      expect(wrongKeyResponse.status).toBe(401);

      // Step 3: Access with correct key - should succeed
      const correctKeyResponse = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": TEST_API_KEY },
      });
      expect(correctKeyResponse.status).toBe(200);

      // Step 4: Can perform operations
      const createResponse = await testApp.request("/api/vms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": TEST_API_KEY,
        },
        body: JSON.stringify({ name: "auth-test-vm" }),
      });
      expect(createResponse.status).not.toBe(401);
    });
  });

  describe("Auth Error Messages", () => {
    it("returns clear error for missing header", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized - X-API-Key header required");
    });

    it("returns clear error for invalid key", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
        headers: { "X-API-Key": "wrong-key" },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized - invalid API key");
    });
  });
});
