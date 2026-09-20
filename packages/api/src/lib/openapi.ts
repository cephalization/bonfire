/**
 * Shared OpenAPIHono validation hook: answer 400 with a plain `error` message
 * (the first issue) instead of zod's raw error object, so clients can show it.
 */

import type { Hook } from "@hono/zod-openapi";

export const validationHook: Hook<unknown, any, any, any> = (result, c) => {
  if (result.success) return;
  const issue = result.error.issues[0];
  const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  return c.json({ error: `${path}${issue?.message ?? "Invalid request"}` }, 400);
};
