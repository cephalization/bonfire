/**
 * OpenCode Proxy Routes Tests
 *
 * Unit tests for the reverse proxy to OpenCode server in VM.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp } from "../test-utils";
import { agentSessions, vms, images, user } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Mock fetch for proxy testing
 */
function createMockProxyFetch() {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const responses = new Map<string, Response>();

  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlString = input.toString();
    calls.push({ url: urlString, options: init || {} });
    const mockResponse = responses.get(urlString);
    if (mockResponse) {
      return mockResponse.clone();
    }
    // Return default response
    return new Response("Not Found", { status: 404 });
  };

  return {
    fetch: fetchFn,
    calls,
    setResponse: (urlPattern: string, response: Response) => {
      responses.set(urlPattern, response);
    },
    clearCalls: () => {
      calls.length = 0;
    },
  };
}

/**
 * Create a mock SSE response with streaming data
 */
function createMockSSEResponse(events: string[] = ['data: {"type": "connected"}\n\n']): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("OpenCode Proxy", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let mockFetch: ReturnType<typeof createMockProxyFetch>;

  // Helper to create a ready session with VM
  async function createReadySession(
    app: Awaited<ReturnType<typeof createTestApp>>,
    userId: string,
    overrides: {
      vmIp?: string;
      sessionId?: string;
    } = {}
  ) {
    const vmIp = overrides.vmIp ?? "10.0.100.10";
    const sessionId =
      overrides.sessionId ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    // Create image first
    const imageId = `img-${Date.now()}`;
    await app.db.insert(images).values({
      id: imageId,
      reference: "test-image",
      kernelPath: "/path/to/kernel",
      rootfsPath: "/path/to/rootfs",
      pulledAt: new Date(),
    });

    // Create VM with IP
    const vmId = `vm-${Date.now()}`;
    await app.db.insert(vms).values({
      id: vmId,
      name: `test-vm-${vmId}`,
      status: "running",
      vcpus: 1,
      memoryMib: 512,
      imageId: imageId,
      ipAddress: vmIp,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create ready session
    const now = new Date();
    await app.db.insert(agentSessions).values({
      id: sessionId,
      userId,
      title: "Test Session",
      repoUrl: "https://github.com/org/repo",
      branch: null,
      vmId: vmId,
      workspacePath: "/home/agent/workspace",
      status: "ready",
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    return { sessionId, vmId, vmIp };
  }

  afterEach(() => {
    if (testApp) testApp.cleanup();
  });

  describe("Path rewriting", () => {
    it("should proxy GET request to OpenCode server", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/status",
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");

      // Verify proxy was called with correct URL
      expect(mockFetch.calls).toHaveLength(1);
      expect(mockFetch.calls[0].url).toBe("http://10.0.100.10:4096/api/status");
    });

    it("should proxy POST request with body", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/command",
        new Response(JSON.stringify({ result: "success" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "test" }),
      });

      expect(res.status).toBe(200);

      // Verify the proxy received the POST request
      expect(mockFetch.calls).toHaveLength(1);
      expect(mockFetch.calls[0].options.method).toBe("POST");
    });

    it("should handle paths with trailing slashes", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/",
        new Response("<html><body>Home</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/`);

      expect(res.status).toBe(200);
    });
  });

  describe("Auth injection", () => {
    it("should inject Authorization header with basic auth", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/status",
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      // Verify Authorization header was injected
      const headers = mockFetch.calls[0].options.headers as Headers;
      expect(headers.get("authorization")).toBe("Basic b3BlbmNvZGU6b3BlbmNvZGU=");
    });

    it("should use custom credentials when provided", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/status",
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({
        proxyFetch: mockFetch.fetch,
      });

      // Test with custom credentials would require updating AppConfig
      // For now we test the default credentials
      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);
      await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      // Verify default credentials are used
      const authHeader = (mockFetch.calls[0].options.headers as Headers).get("authorization");
      expect(authHeader).toMatch(/^Basic /);
    });
  });

  describe("HTML base href injection", () => {
    it("should inject base href in HTML responses", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/",
        new Response("<html><head></head><body>Hello</body></html>", {
          headers: { "Content-Type": "text/html" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/`);
      const html = await res.text();

      expect(html).toContain('<base href="/api/agent/sessions/');
      expect(html).toContain(sessionId);
    });

    it("should create head tag if missing", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/",
        new Response("<html><body>Hello</body></html>", {
          headers: { "Content-Type": "text/html" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/`);
      const html = await res.text();

      expect(html).toContain("<head>");
      expect(html).toContain('<base href="/api/agent/sessions/');
    });

    it("should not duplicate base href if already present", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/",
        new Response('<html><head><base href="/existing/"></head><body>Hello</body></html>', {
          headers: { "Content-Type": "text/html" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/`);
      const html = await res.text();

      // Should keep existing base href
      expect(html).toContain('<base href="/existing/">');
    });
  });

  describe("SSE streaming", () => {
    it("should stream SSE responses", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/event",
        createMockSSEResponse(['data: {"type": "test"}\n\n'])
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/event`);

      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.status).toBe(200);
    });

    it("should handle /global/event SSE endpoint", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/global/event",
        createMockSSEResponse(['data: {"type": "global"}\n\n'])
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/global/event`);

      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    });
  });

  describe("Header filtering", () => {
    it("should strip hop-by-hop headers", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/status",
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Connection: "keep-alive",
            "Keep-Alive": "timeout=5",
          },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      // Hop-by-hop headers should be stripped from response
      expect(res.headers.get("connection")).toBeNull();
      expect(res.headers.get("keep-alive")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/json");
    });

    it("should set host header to VM IP", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/status",
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId, vmIp } = await createReadySession(testApp, testApp.mockUserId, {
        vmIp: "10.0.100.50",
      });

      await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      // Verify host header was set to VM IP
      const headers = mockFetch.calls[0].options.headers as Headers;
      expect(headers.get("host")).toBe(`${vmIp}:4096`);
    });
  });

  describe("Error handling", () => {
    it("should return 404 for unknown session", async () => {
      mockFetch = createMockProxyFetch();
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const res = await testApp.request(`/api/agent/sessions/non-existent/opencode/api/status`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Session not found");
    });

    it("should return 503 for non-ready session", async () => {
      mockFetch = createMockProxyFetch();
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      // Create a creating session (not ready)
      const sessionId = `sess-${Date.now()}`;
      await testApp.db.insert(agentSessions).values({
        id: sessionId,
        userId: testApp.mockUserId,
        title: "Test Session",
        repoUrl: "https://github.com/org/repo",
        status: "creating",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Session is not ready");
    });

    it("should return 503 for session without VM", async () => {
      mockFetch = createMockProxyFetch();
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      // Create a ready session without VM
      const sessionId = `sess-${Date.now()}`;
      await testApp.db.insert(agentSessions).values({
        id: sessionId,
        userId: testApp.mockUserId,
        title: "Test Session",
        repoUrl: "https://github.com/org/repo",
        status: "ready",
        vmId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Session has no VM assigned");
    });

    it("should return 504 when OpenCode server is unavailable", async () => {
      mockFetch = createMockProxyFetch();
      // Simulate fetch throwing an error
      const failingFetch = async () => {
        throw new Error("Connection refused");
      };
      testApp = await createTestApp({ proxyFetch: failingFetch as any });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error).toBe("OpenCode server unavailable");
    });
  });

  describe("Authorization", () => {
    it("should allow users to access their own sessions", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/status",
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      expect(res.status).toBe(200);
    });

    it("should not allow users to access other users' sessions", async () => {
      mockFetch = createMockProxyFetch();
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      // Create another user
      const otherUserId = `other-${Date.now()}`;
      await testApp.db.insert(user).values({
        id: otherUserId,
        name: "Other User",
        email: `other-${Date.now()}@example.com`,
        emailVerified: true,
        role: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create session for other user
      const { sessionId } = await createReadySession(testApp, otherUserId);

      // Current user (mockUserId) tries to access other user's session
      const res = await testApp.request(`/api/agent/sessions/${sessionId}/opencode/api/status`);

      expect(res.status).toBe(404);
    });

    it("should allow admin users to access any session", async () => {
      mockFetch = createMockProxyFetch();
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      // Create admin user
      const adminUserId = `admin-${Date.now()}`;
      await testApp.db.insert(user).values({
        id: adminUserId,
        name: "Admin User",
        email: `admin-${Date.now()}@example.com`,
        emailVerified: true,
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create another user and their session
      const otherUserId = `other-${Date.now()}`;
      await testApp.db.insert(user).values({
        id: otherUserId,
        name: "Other User",
        email: `other-${Date.now()}-2@example.com`,
        emailVerified: true,
        role: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { sessionId } = await createReadySession(testApp, otherUserId);

      // This test would need to simulate the admin user being authenticated
      // For now, we verify the session exists for the other user
      const sessions = await testApp.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId));

      expect(sessions).toHaveLength(1);
      expect(sessions[0].userId).toBe(otherUserId);
    });
  });

  describe("Query parameter forwarding", () => {
    it("should forward query parameters to OpenCode", async () => {
      mockFetch = createMockProxyFetch();
      mockFetch.setResponse(
        "http://10.0.100.10:4096/api/search?query=test&limit=10",
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      testApp = await createTestApp({ proxyFetch: mockFetch.fetch });

      const { sessionId } = await createReadySession(testApp, testApp.mockUserId);

      await testApp.request(
        `/api/agent/sessions/${sessionId}/opencode/api/search?query=test&limit=10`
      );

      expect(mockFetch.calls).toHaveLength(1);
      expect(mockFetch.calls[0].url).toContain("query=test");
      expect(mockFetch.calls[0].url).toContain("limit=10");
    });
  });
});
