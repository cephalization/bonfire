/**
 * OpenCode Proxy Routes
 *
 * Reverse proxy to route requests to OpenCode server running in VM.
 * - Route: ANY /api/agent/sessions/:id/opencode/*
 * - Proxies to: http://<vmIp>:4096/*
 * - Requires Bonfire auth
 * - Injects Authorization header for OpenCode basic auth
 * - Injects <base href> in HTML responses
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { agentSessions, vms } from "../db/schema";
import type { AuthUser } from "../middleware/auth";

// OpenCode server port inside VM
const OPCODE_PORT = 4096;

// Hop-by-hop headers that should be stripped
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

// Error response schema
const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      example: "Session not found",
      description: "Error message",
    }),
  })
  .openapi("ErrorResponse");

// ============================================================================
// Route Definitions
// ============================================================================

const opencodeProxyRoute = createRoute({
  method: "get",
  path: "/agent/sessions/{id}/opencode/{proxyPath+}",
  tags: ["OpenCode Proxy"],
  summary: "Proxy request to OpenCode server",
  description: "Proxies requests to the OpenCode server running in the session's VM",
  request: {
    params: z.object({
      id: z.string().openapi({
        example: "sess-abc123",
        description: "Session ID",
      }),
      proxyPath: z.string().openapi({
        example: "api/status",
        description: "Path to proxy to OpenCode server",
      }),
    }),
  },
  responses: {
    200: {
      description: "Proxied response from OpenCode",
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    503: {
      description: "Session not ready",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    504: {
      description: "OpenCode server unavailable",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Proxy Configuration
// ============================================================================

export interface OpencodeProxyConfig {
  db: BetterSQLite3Database<typeof schema>;
  /**
   * Fetch function to use for proxying requests.
   * Defaults to global fetch. Can be mocked in tests.
   */
  fetchFn?: typeof fetch;
  /**
   * OpenCode basic auth credentials.
   * Defaults to "opencode:opencode"
   */
  opencodeCredentials?: string;
}

// ============================================================================
// Router Factory
// ============================================================================

export function createOpencodeProxyRouter(config: OpencodeProxyConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { db } = config;
  const fetchFn = config.fetchFn ?? fetch;

  // Generate basic auth header from credentials
  const opencodeAuth = config.opencodeCredentials ?? "opencode:opencode";
  const basicAuthHeader = "Basic " + Buffer.from(opencodeAuth).toString("base64");

  // Helper to get user from context
  function getUser(c: any): AuthUser {
    const user = c.get("user") as AuthUser | undefined;
    if (!user) {
      throw new Error("Unauthorized - user not found in context");
    }
    return user;
  }

  // Helper to check if user can access session
  async function canAccessSession(sessionId: string, user: AuthUser): Promise<boolean> {
    const [session] = await db
      .select({ userId: agentSessions.userId })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId));

    if (!session) return false;
    if (user.role === "admin") return true;
    return session.userId === user.id;
  }

  // Helper to inject base href into HTML
  function injectBaseHref(html: string, baseHref: string): string {
    // Check if already has base tag
    if (/<base\s+href=/i.test(html)) {
      return html;
    }

    // Inject base href in <head> or create one if missing
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, `$&<base href="${baseHref}">`);
    } else if (/<html[^>]*>/i.test(html)) {
      return html.replace(/<html[^>]*>/i, `$&<head><base href="${baseHref}"></head>`);
    } else {
      return `<head><base href="${baseHref}"></head>${html}`;
    }
  }

  // Helper to strip hop-by-hop headers
  function stripHopByHopHeaders(headers: Headers): Headers {
    const newHeaders = new Headers();
    headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) {
        newHeaders.set(key, value);
      }
    });
    return newHeaders;
  }

  // Main proxy handler
  async function handleProxyRequest(c: any) {
    try {
      const user = getUser(c);
      const sessionId = c.req.param("id");
      // Extract proxy path from the URL by removing the prefix
      // The URL pattern is: /api/agent/sessions/:id/opencode/[proxyPath]
      const requestUrl = new URL(c.req.url);
      const pathMatch = requestUrl.pathname.match(
        /\/api\/agent\/sessions\/[^/]+\/opencode\/?(.*)$/
      );
      const proxyPath = pathMatch?.[1] ?? "";

      // Check session exists and user has access
      const canAccess = await canAccessSession(sessionId, user);
      if (!canAccess) {
        return c.json({ error: "Session not found" }, 404);
      }

      // Get session with VM details
      const [session] = await db
        .select({
          id: agentSessions.id,
          status: agentSessions.status,
          vmId: agentSessions.vmId,
        })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId));

      if (!session) {
        return c.json({ error: "Session not found" }, 404);
      }

      // Check session is ready
      if (session.status !== "ready") {
        return c.json({ error: "Session is not ready" }, 503);
      }

      // Get VM IP address
      if (!session.vmId) {
        return c.json({ error: "Session has no VM assigned" }, 503);
      }

      const [vm] = await db
        .select({ ipAddress: vms.ipAddress })
        .from(vms)
        .where(eq(vms.id, session.vmId));

      if (!vm || !vm.ipAddress) {
        return c.json({ error: "VM not found or has no IP address" }, 503);
      }

      // Build target URL
      const targetUrl = new URL(proxyPath, `http://${vm.ipAddress}:${OPCODE_PORT}/`);

      // Copy query parameters
      requestUrl.searchParams.forEach((value, key) => {
        targetUrl.searchParams.set(key, value);
      });

      // Prepare headers
      const incomingHeaders = new Headers(c.req.header());

      // Strip hop-by-hop headers
      const outgoingHeaders = stripHopByHopHeaders(incomingHeaders);

      // Set host header to VM IP
      outgoingHeaders.set("host", `${vm.ipAddress}:${OPCODE_PORT}`);

      // Add OpenCode authorization header
      outgoingHeaders.set("authorization", basicAuthHeader);

      // Make the proxied request
      let proxyResponse: Response;
      try {
        proxyResponse = await fetchFn(targetUrl.toString(), {
          method: c.req.method,
          headers: outgoingHeaders,
          body: c.req.method !== "GET" && c.req.method !== "HEAD" ? await c.req.blob() : undefined,
        });
      } catch (error) {
        console.error(`Proxy error for session ${sessionId}:`, error);
        return c.json({ error: "OpenCode server unavailable" }, 504);
      }

      // Process response
      const contentType = proxyResponse.headers.get("content-type") ?? "";
      const isHtml = contentType.includes("text/html");
      const isEventStream = contentType.includes("text/event-stream");

      // For SSE streaming, pass through directly
      if (isEventStream) {
        const responseHeaders = stripHopByHopHeaders(proxyResponse.headers);
        return new Response(proxyResponse.body, {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: responseHeaders,
        });
      }

      // For HTML, inject base href
      if (isHtml) {
        const html = await proxyResponse.text();
        const baseHref = `/api/agent/sessions/${sessionId}/opencode/`;
        const modifiedHtml = injectBaseHref(html, baseHref);

        const responseHeaders = stripHopByHopHeaders(proxyResponse.headers);
        responseHeaders.set("content-length", String(Buffer.byteLength(modifiedHtml)));

        return new Response(modifiedHtml, {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: responseHeaders,
        });
      }

      // For other responses, pass through with stripped headers
      const responseHeaders = stripHopByHopHeaders(proxyResponse.headers);
      return new Response(proxyResponse.body, {
        status: proxyResponse.status,
        statusText: proxyResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("Proxy request failed:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  }

  // Register wildcard handlers for all methods
  // Use '*' to match any path after /opencode
  // Note: We don't use OpenAPI for this route because it's a proxy with dynamic paths
  app.on(
    ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    "/agent/sessions/:id/opencode/*",
    handleProxyRequest
  );

  return app;
}
