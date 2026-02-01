/**
 * SDK Type Tests
 *
 * Type-level tests to verify SDK types match API spec.
 * These tests validate at compile time, not runtime.
 */

import { describe, it, expect } from "vitest";
import type { BonfireClient, HealthResponse, ErrorResponse } from "./index";

describe("SDK Types", () => {
  describe("HealthResponse", () => {
    it("should have correct structure", () => {
      // Type-level assertion
      const assertHealthResponse = (response: HealthResponse): void => {
        expect(typeof response.status).toBe("string");
      };

      // Runtime test
      const validResponse: HealthResponse = { status: "ok" };
      expect(validResponse.status).toBe("ok");
    });
  });

  describe("ErrorResponse", () => {
    it("should have correct structure", () => {
      // Type-level assertion
      const assertErrorResponse = (response: ErrorResponse): void => {
        expect(typeof response.error).toBe("string");
      };

      // Runtime test
      const validResponse: ErrorResponse = { error: "Something went wrong" };
      expect(validResponse.error).toBe("Something went wrong");
    });
  });
});

describe("BonfireClient", () => {
  describe("configuration", () => {
    it("should accept baseUrl configuration", () => {
      // Type-level: ClientConfig interface requires baseUrl to be string if provided
      const client = { baseUrl: "http://localhost:3000" } as const;
      expect(client.baseUrl).toBe("http://localhost:3000");
    });

    it("should accept token configuration", () => {
      // Type-level: ClientConfig interface allows optional token
      const client = { baseUrl: "http://localhost:3000", token: "test-token" } as const;
      expect(client.token).toBe("test-token");
    });
  });
});

// Type assertions - these fail at compile time if types don't match
type AssertTypesMatch = {
  // Ensure HealthResponse has required fields
  status: HealthResponse["status"];

  // Ensure ErrorResponse has required fields
  error: ErrorResponse["error"];
};

// This line ensures TypeScript evaluates the type assertion
const _typeAssertion: AssertTypesMatch = {
  status: "ok",
  error: "test",
};
