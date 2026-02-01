/**
 * Unit tests for Login command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleLoginCommand } from "./login.js";

// Mock fetch for testing
const mockFetch = async (
  url: string,
  options?: RequestInit
): Promise<Response> => {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  if (path === "/api/auth/sign-in/email" && options?.method === "POST") {
    const body = JSON.parse(options.body as string);
    
    // Simulate successful login
    if (body.email === "test@example.com" && body.password === "password123") {
      return new Response(
        JSON.stringify({
          token: "test-session-token-12345",
          user: {
            id: "user-123",
            email: body.email,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Simulate failed login
    return new Response(
      JSON.stringify({
        message: "Invalid email or password",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: "Not found" }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
};

describe("handleLoginCommand", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Note: These tests are limited because login requires interactive prompts
  // which cannot be easily mocked in unit tests. The actual login flow
  // should be tested via integration tests.

  it("exists and is exportable", () => {
    expect(handleLoginCommand).toBeDefined();
    expect(typeof handleLoginCommand).toBe("function");
  });

  it("has correct function signature for CLI integration", () => {
    // Login command requires interactive prompts which can't be unit tested
    // The function returns Promise<number> for exit code
    expect(handleLoginCommand.length).toBe(0);
  });
});

describe("Login API mock", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns token on successful sign-in", async () => {
    const response = await fetch("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.token).toBe("test-session-token-12345");
    expect(data.user.email).toBe("test@example.com");
  });

  it("returns error on invalid credentials", async () => {
    const response = await fetch("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "wrong@example.com",
        password: "wrongpassword",
      }),
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.message).toBe("Invalid email or password");
  });
});
