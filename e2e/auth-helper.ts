/**
 * E2E auth bootstrap
 *
 * The API has no shared key any more: everything is a user in an
 * organization. This signs up (or signs in) a dedicated e2e user, makes sure
 * they have an organization, and mints an API key bound to it for the SDK.
 *
 * The test compose file sets BONFIRE_OPEN_SIGNUP=true so this works even
 * when an earlier run already created the first user.
 */

export const E2E_EMAIL = process.env.BONFIRE_E2E_EMAIL || "e2e@bonfire.test";
export const E2E_PASSWORD = process.env.BONFIRE_E2E_PASSWORD || "e2e-password-not-for-production";
const E2E_ORG_SLUG = "e2e";

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function postJson(apiUrl: string, path: string, body: unknown, cookie?: string) {
  return fetch(`${apiUrl}${path}`, {
    method: "POST",
    // Better Auth's CSRF check wants a trusted Origin on cookie POSTs, and a
    // Node fetch does not add one by itself.
    headers: {
      "content-type": "application/json",
      origin: new URL(apiUrl).origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

export interface E2EAuth {
  apiKey: string;
  organizationId: string;
  cookie: string;
}

export async function bootstrapE2EAuth(apiUrl: string): Promise<E2EAuth> {
  // Sign up, or sign in if the user already exists from a previous run.
  let res = await postJson(apiUrl, "/api/auth/sign-up/email", {
    name: "E2E",
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  });
  if (!res.ok) {
    res = await postJson(apiUrl, "/api/auth/sign-in/email", {
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    });
  }
  if (!res.ok) {
    throw new Error(`E2E auth: could not sign up or sign in (${res.status}): ${await res.text()}`);
  }
  const cookie = cookieHeader(res);

  // Reuse the e2e organization if it exists, otherwise create it.
  const list = await fetch(`${apiUrl}/api/auth/organization/list`, { headers: { cookie } });
  const organizations = (await list.json()) as Array<{ id: string; slug: string }>;
  let organizationId = organizations.find((o) => o.slug === E2E_ORG_SLUG)?.id;

  if (!organizationId) {
    const created = await postJson(
      apiUrl,
      "/api/auth/organization/create",
      { name: "E2E", slug: E2E_ORG_SLUG },
      cookie
    );
    if (!created.ok) {
      throw new Error(`E2E auth: could not create organization: ${await created.text()}`);
    }
    organizationId = ((await created.json()) as { id: string }).id;
  }

  const key = await postJson(
    apiUrl,
    "/api/auth/api-key/create",
    { name: `e2e ${new Date().toISOString()}`, metadata: { organizationId } },
    cookie
  );
  if (!key.ok) {
    throw new Error(`E2E auth: could not create API key: ${await key.text()}`);
  }
  const { key: apiKey } = (await key.json()) as { key: string };

  return { apiKey, organizationId, cookie };
}
