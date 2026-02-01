/**
 * Auth Integration Tests
 *
 * Tests for Better Auth email/password authentication flow.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp } from "../src/test-utils";

describe("Auth Integration Tests", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  beforeEach(async () => {
    testApp = await createTestApp({ skipAuth: false });
  });

  afterEach(async () => {
    await testApp.cleanup();
  });

  describe("POST /api/auth/sign-up", () => {
    it("creates a new user with email and password", async () => {
      const response = await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
          name: "Test User",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe("test@example.com");
      expect(data.user.name).toBe("Test User");
    });

    it("returns error for duplicate email", async () => {
      // Create first user
      await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "duplicate@example.com",
          password: "password123",
          name: "First User",
        }),
      });

      // Try to create second user with same email
      const response = await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "duplicate@example.com",
          password: "password456",
          name: "Second User",
        }),
      });

      expect(response.status).toBe(422);
    });

    it("validates email format", async () => {
      const response = await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "invalid-email",
          password: "password123",
          name: "Test User",
        }),
      });

      // Better Auth returns 400 for validation errors
      expect(response.status).toBe(400);
    });

    it("enforces minimum password length", async () => {
      const response = await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "short",
          name: "Test User",
        }),
      });

      // Better Auth returns 400 for validation errors
      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/auth/sign-in", () => {
    beforeEach(async () => {
      // Create a test user
      await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "signin@example.com",
          password: "password123",
          name: "Sign In Test User",
        }),
      });
    });

    it("returns session for valid credentials", async () => {
      const response = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "signin@example.com",
          password: "password123",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe("signin@example.com");
    });

    it("returns error for invalid password", async () => {
      const response = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "signin@example.com",
          password: "wrongpassword",
        }),
      });

      expect(response.status).toBe(401);
    });

    it("returns error for non-existent user", async () => {
      const response = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "nonexistent@example.com",
          password: "password123",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/auth/sign-out", () => {
    it("signs out user with valid session", async () => {
      // Create a user and sign in
      await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "signout@example.com",
          password: "password123",
          name: "Sign Out Test User",
        }),
      });

      const signInResponse = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "signout@example.com",
          password: "password123",
        }),
      });

      const cookies = signInResponse.headers.get("set-cookie");
      
      const response = await testApp.request("/api/auth/sign-out", {
        method: "POST",
        headers: cookies ? { Cookie: cookies } : {},
      });

      expect(response.status).toBe(200);
    });

    it("returns success even without session", async () => {
      const response = await testApp.request("/api/auth/sign-out", {
        method: "POST",
      });

      // Sign-out typically returns 200 even if not signed in
      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/auth/get-session", () => {
    beforeEach(async () => {
      // Create a test user
      await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "session@example.com",
          password: "password123",
          name: "Session Test User",
        }),
      });
    });

    it("returns session for authenticated user", async () => {
      // Sign in to get session cookie
      const signInResponse = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "session@example.com",
          password: "password123",
        }),
      });

      const cookies = signInResponse.headers.get("set-cookie");
      
      // Better Auth uses /api/auth/get-session, not /api/auth/session
      const response = await testApp.request("/api/auth/get-session", {
        headers: cookies ? { Cookie: cookies } : {},
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe("session@example.com");
    });

    it("returns empty for unauthenticated user", async () => {
      // Better Auth uses /api/auth/get-session
      const response = await testApp.request("/api/auth/get-session");

      // Better Auth returns 200 with null/empty response for unauthenticated requests
      expect(response.status).toBe(200);
      const data = await response.json();
      // Response is null when not authenticated
      expect(data === null || data.user === null).toBe(true);
    });
  });

  describe("Protected Routes", () => {
    it("rejects requests without valid session", async () => {
      const response = await testApp.request("/api/vms", {
        method: "GET",
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized - valid session required");
    });

    it("allows requests with valid session", async () => {
      // Create and sign in a test user
      await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "protected@example.com",
          password: "password123",
          name: "Protected Test User",
        }),
      });

      const signInResponse = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "protected@example.com",
          password: "password123",
        }),
      });

      const cookies = signInResponse.headers.get("set-cookie");

      // Now try to access protected route
      const response = await testApp.request("/api/vms", {
        method: "GET",
        headers: cookies ? { Cookie: cookies } : {},
      });

      // Should not return 401 (may return 200 or other status depending on implementation)
      expect(response.status).not.toBe(401);
    });
  });

  describe("Auth Flow", () => {
    it("complete flow: sign up, sign in, access protected resource, sign out", async () => {
      // Step 1: Sign up
      const signUpResponse = await testApp.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "flow@example.com",
          password: "password123",
          name: "Flow Test User",
        }),
      });

      expect(signUpResponse.status).toBe(200);

      // Step 2: Sign in
      const signInResponse = await testApp.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "flow@example.com",
          password: "password123",
        }),
      });

      expect(signInResponse.status).toBe(200);
      const cookies = signInResponse.headers.get("set-cookie");

      // Step 3: Access protected route
      const protectedResponse = await testApp.request("/api/vms", {
        method: "GET",
        headers: cookies ? { Cookie: cookies } : {},
      });

      expect(protectedResponse.status).not.toBe(401);

      // Step 4: Sign out
      const signOutResponse = await testApp.request("/api/auth/sign-out", {
        method: "POST",
        headers: cookies ? { Cookie: cookies } : {},
      });

      expect(signOutResponse.status).toBe(200);

      // Step 5: Verify session is invalidated
      const sessionResponse = await testApp.request("/api/auth/get-session", {
        headers: cookies ? { Cookie: cookies } : {},
      });

      // After sign out, get-session returns 200 with null/empty response
      expect(sessionResponse.status).toBe(200);
      const sessionData = await sessionResponse.json();
      // Response is null when not authenticated
      expect(sessionData === null || sessionData.user === null).toBe(true);
    });
  });
});
