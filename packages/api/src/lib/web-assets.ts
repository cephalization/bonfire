/**
 * Serving the built web app from the API
 *
 * Under Docker Compose nginx serves the SPA and proxies `/api` to the API. A
 * single-container deployment (Railway, or any one-process host) has no nginx,
 * so the API serves the build itself. One origin means session cookies and the
 * Better Auth origin check need no extra configuration.
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import { serveStatic } from "@hono/node-server/serve-static";

/**
 * Serve the files in `root` (a path relative to the process's working
 * directory, which is all the Node static handler resolves) and fall back to
 * `index.html` for client-side routes.
 *
 * Call this after every API route is registered: Hono runs matching handlers
 * in registration order, so the routes answer first and only unclaimed paths
 * reach the static files.
 */
export function mountWebApp(app: OpenAPIHono, root: string): void {
  app.use("*", serveStatic({ root }));

  // Paths like /conversations/:id and /invitations/:id have no file on disk;
  // they are entry points into the SPA. API paths keep their own 404s so a
  // mistyped endpoint does not answer with HTML.
  const index = serveStatic({ root, rewriteRequestPath: () => "/index.html" });
  app.get("*", (c, next) => (c.req.path.startsWith("/api") ? next() : index(c, next)));
}
