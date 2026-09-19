# CLAUDE.md

Guidance for humans and agents working in this repo. Read this before the
README — the README is user-facing, this is about the code.

## What Bonfire is

A self-hosted manager for ephemeral **Firecracker microVMs**. You create a VM,
it boots from a prepared kernel + rootfs, gets a TAP device and an IP on a
host bridge, and you SSH into it.

## Layout

pnpm workspaces + turborepo. Four packages:

| Package        | What it does                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| `packages/api` | Hono + `@hono/zod-openapi` server. SQLite via Drizzle. Owns Firecracker, networking and SSH. |
| `packages/web` | React 19 + Vite + Tailwind 4 + Radix (shadcn-style).                                         |
| `packages/cli` | `bonfire` command, built with Clack.                                                         |
| `packages/sdk` | Hand-written typed HTTP client.                                                              |

Inside `packages/api/src`:

- `routes/` — HTTP handlers, one router factory per resource
- `services/firecracker/` — `config` (VM JSON), `process` (spawn/kill),
  `socket-client` (Firecracker's HTTP-over-unix-socket API)
- `services/network/` — `ip-pool` (allocation), `tap` (device lifecycle)
- `services/ssh.ts`, `services/ssh-keys.ts` — ssh2 wrapper, per-VM keypairs
- `services/images.ts` — image registration, default-image bootstrap at start
- `services/vm-watchdog.ts` — reconciles DB state against live processes
- `ws/terminal.ts` — terminal WebSocket, bridged to an SSH pty on the VM
- `lib/terminal-tickets.ts` — single-use tickets for the terminal handshake
- `lib/auth.ts` — the Better Auth instance (`createAuth`), mounted at `/api/auth`
- `lib/authz.ts` — organization membership checks used by every VM route
- `middleware/auth.ts` — turns a session cookie or `X-API-Key` into a `Principal`
- `db/migrate.ts` — applies the drizzle-kit migrations in `drizzle/`

## Conventions

### Dependency injection for testability

This is the most important convention in the repo. Anything that touches the
kernel — spawning Firecracker, creating TAP devices, opening SSH connections —
is passed in as a function or service rather than imported directly:

```ts
createVMsRouter({
  db,
  networkService,
  spawnFirecrackerFn: appConfig.spawnFirecrackerFn,
  startVMProcessFn: appConfig.startVMProcessFn,
  // ...
});
```

This is why the whole API test suite runs in CI on a machine with no KVM.
**Keep it.** If you add something that shells out or touches hardware, inject
it.

`services/ssh.ts` also ships a fake implementation (`createMockSSHService`)
alongside the real one. Follow that pattern.

Auth is injected the same way: `createApp({ auth })`. `createTestApp()` in
`test-utils.ts` builds a real Better Auth instance against a migrated temp
SQLite database (with a fast password hasher), signs up a user, creates an
organization, and returns a `request` helper that carries that user's session
cookie. Route tests therefore go through the real auth middleware.

### How auth and authorization work

- **Better Auth** (`lib/auth.ts`) owns accounts, sessions, organizations,
  invitations and API keys. Its routes live under `/api/auth/*` and its tables
  are hand-written in `db/schema.ts` (table variable names must equal Better
  Auth model names: `user`, `session`, `organization`, `member`, `invitation`,
  `apikey`, ...).
- **Two credentials** are accepted by `middleware/auth.ts`: the session cookie
  (browser) and an `X-API-Key` header (CLI, SDK). Both resolve to a `Principal`
  `{ user, via, defaultOrganizationId }`. An API key's organization is stored
  in its metadata when it is created.
- **Everything is scoped to an organization** (`lib/authz.ts`). Listing and
  creating VMs resolves an organization (explicit `organizationId`, else the
  session's active organization, else the API key's) and requires membership.
  Per-VM routes use `loadAuthorizedVm`, which answers "not found" for VMs in
  organizations the caller is not in, so ids cannot be probed. Images are
  global: any signed-in user can see and register them.
- **Sign-up is invitation-only by default**: the first user may sign up, and so
  may anyone with a pending invitation for their email. `BONFIRE_OPEN_SIGNUP`
  opens it. This is enforced in a Better Auth `databaseHooks.user.create`
  hook.
- **There is no email service.** Invitation links are returned to the inviter
  in the UI and written to the API log.
- The terminal WebSocket accepts a ticket (minted by an authorized caller) or
  ordinary credentials on the handshake; see `authenticateUpgrade`.

### How the browser terminal is wired

`ws/terminal.ts` bridges the WebSocket to a pty-backed SSH shell on the VM,
using `services/ssh.ts` (`shell()`) and the per-VM key from
`services/ssh-keys.ts`. The protocol, which `web/src/components/Terminal.tsx`
already spoke:

- server → client: `{"ready":true}` once the shell is open, then raw output.
  The client clears its screen on `ready` and drops anything before it, so
  `ready` must precede the first byte of output.
- server → client: `{"error":"..."}` for anything the user should see.
- client → server: raw keystrokes, or `{"resize":{"cols":N,"rows":N}}`.

A frame is only parsed as a control message if it starts with `{`, so typing a
brace into the shell is passed through rather than swallowed.

**Authentication is the non-obvious part.** A browser cannot set an
`X-API-Key` header on a WebSocket handshake — there is no API for it. So the
client first POSTs `/api/vms/:id/terminal/ticket` (authenticated normally) and
puts the returned ticket in the socket URL. Tickets are single-use and expire
in 30 seconds, so a URL captured from logs or history is not a usable
credential. The handshake still accepts `X-API-Key` for clients that can set
headers, such as the CLI and tests.

Because tickets are spent on use, `Terminal.tsx` passes PartySocket a _URL
function_ rather than a string, so each automatic reconnect mints a fresh one.

One VM has one terminal at a time; a second connection is refused with
`"Terminal already connected"`, matching the documented 409.

The ticket store is in-memory, so it is per-process. That is fine for a single
API server.

### Other conventions

- **Route factories**: every router is a `createXRouter(config)` function, not a
  module-level singleton.
- **OpenAPI first**: routes are declared with `createRoute` and served at
  `/api/openapi.json`.
- **Tests live next to code**: `foo.ts` / `foo.test.ts`.
- **Formatting and linting**: `oxfmt` and `oxlint`, enforced by husky +
  lint-staged and in CI. Run `pnpm format` and `pnpm lint` before pushing.

## Running things

```bash
pnpm install
pnpm dev            # mprocs: api + web
pnpm build
pnpm typecheck
pnpm test           # unit tests, no KVM needed
pnpm run test:e2e   # e2e, needs KVM + Linux
```

`pnpm test` is the one to run constantly; it is fast and hermetic. It covers
the routes end to end (real auth, real migrations, mocked hardware); there is
no separate "integration" tier.

## What is deliberately missing

This repo went through a large refactor in early 2026 that removed several
subsystems. Some of their clients were left behind, and a cleanup pass in
September 2026 deleted those. Be aware of what is _absent by design_ so you
don't assume it exists:

### Things that used to be missing

Authentication was a single shared static key until September 2026. It is now
real (see "How auth and authorization work" above). If you find code or docs
that talk about `BONFIRE_API_KEY` or `dev-api-key-change-in-production`, they
are stale.

### Endpoints that were removed (don't re-add clients for them)

- `POST /api/vms/:id/exec` — replaced by SSH (`bonfire vm ssh <name> -- <cmd>`)
- `GET /api/vms/:id/health` — removed with the guest agent
- `/api/agent/sessions/*` — the whole agent-session feature was removed
  server-side. The orphaned frontend was deleted in September 2026; it is
  recoverable from the `backup/main-2026-09-19` branch if it is useful as a
  sketch when the feature is rebuilt.

### There are three hand-maintained API clients

`sdk/src/client.ts`, `web/src/lib/api.ts` and `cli/src/lib/client.ts` each
describe the same API by hand. Nothing consumes `/api/openapi.json`. This is
precisely how the orphaned endpoints above went unnoticed for seven months:
every test mocks at the client boundary, so a client calling a deleted route
still passes.

**Generating the SDK from the OpenAPI document, and having `web` and `cli` use
it, would make that class of bug structurally impossible.** Worth doing before
much more API surface is added.

## Planned direction

Roughly in order:

1. ~~Restore the browser terminal over SSH.~~ Done — see "How the browser
   terminal is wired" above.
2. ~~Real authentication and permissioning.~~ Done — users, organizations,
   memberships, invitations, per-user API keys, membership checks on every VM
   route. Still open within it: an email service for invitations and password
   resets, and finer-grained permissions than owner/admin/member.
3. **Repos and branches** — model a repo + branch, clone it into the sandbox at
   boot, tie it to members.
4. **Conversations** — conversation/message/participant tables scoped to a
   project, realtime over the WebSocket server that already exists.
5. **Agents as participants** in those conversations, running in a VM bound to a
   repo and branch.

## Gotchas

- `/var/lib/bonfire/` is the data root in Docker; locally the DB defaults to
  `./bonfire.db`. `DATABASE_URL` overrides both.
- Drizzle migrations live in `packages/api/drizzle/` and are applied by
  `db/migrate.ts` (on server start, in tests, and by `pnpm --filter
@bonfire/api migrate`). If you change `db/schema.ts` you **must** run
  `pnpm --filter @bonfire/api db:generate` and commit the result — the schema
  file drifting ahead of the migrations is what left four phantom auth tables
  in the codebase for months. Databases created before the migration journal
  existed are upgraded in place; see the comment in `db/migrate.ts`.
- `BONFIRE_URL` must be the URL the browser uses. Better Auth ties cookies and
  CSRF origin checks to it, so behind the Docker nginx it is the web URL.
- A cookie-authenticated `POST` to `/api/auth/*` must carry an `Origin` (or
  `Referer`) header from a trusted origin, or Better Auth answers
  `MISSING_OR_NULL_ORIGIN`. Browsers do this automatically; curl and Node
  scripts must add it (see `e2e/auth-helper.ts`). `X-API-Key` requests to
  `/api/vms` and `/api/images` are not affected.
- The VM watchdog exists because dev hot-reload kills Firecracker children and
  leaves rows marked `running`. If VMs seem stuck, check it.
- E2E tests need a self-hosted KVM runner; they only run on pushes to `main`.
