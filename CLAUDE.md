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
- `services/vm-watchdog.ts` — reconciles DB state against live processes
- `ws/terminal.ts` — terminal WebSocket, bridged to an SSH pty on the VM
- `lib/terminal-tickets.ts` — single-use tickets for the terminal handshake

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

This is why 162 API tests run in CI on a machine with no KVM. **Keep it.** If
you add something that shells out or touches hardware, inject it.

`services/ssh.ts` also ships a fake implementation (`createMockSSHService`)
alongside the real one. Follow that pattern.

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
API server and is the seam where per-user auth attaches in the next milestone.

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
pnpm run test:int   # integration, needs Docker
pnpm run test:e2e   # e2e, needs KVM + Linux
```

`pnpm test` is the one to run constantly; it is fast and hermetic.

## What is deliberately missing

This repo went through a large refactor in early 2026 that removed several
subsystems. Some of their clients were left behind, and a cleanup pass in
September 2026 deleted those. Be aware of what is _absent by design_ so you
don't assume it exists:

### Authentication is one shared static key

There are no users, sessions, roles or permissions. `middleware/auth.ts`
compares `X-API-Key` against a single `BONFIRE_API_KEY` and sets every caller
to `{ id: "api-user", role: "admin" }`.

`lib/config.ts` refuses to boot in production without a real key, but that is
damage control, not security. `web/src/lib/auth.ts` is a shim that stores the
key in `localStorage` and fakes a session object; `Login.tsx` collects an email
and discards it.

**Anything multi-user is blocked on replacing this.** There is no way to
express "these members belong to this thing" today.

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
2. **Real authentication and permissioning** — actual users, project/membership
   tables, API keys as rows scoped to a user, route-level authorization. This
   blocks everything below it.
3. **Repos and branches** — model a repo + branch, clone it into the sandbox at
   boot, tie it to members.
4. **Conversations** — conversation/message/participant tables scoped to a
   project, realtime over the WebSocket server that already exists.
5. **Agents as participants** in those conversations, running in a VM bound to a
   repo and branch.

## Gotchas

- `/var/lib/bonfire/` is the data root in Docker; locally the DB defaults to
  `./bonfire.db`. `DATABASE_URL` overrides both.
- Drizzle migrations live in `packages/api/drizzle/`. If you change
  `db/schema.ts` you **must** generate a migration — the schema file drifting
  ahead of the migrations is what left four phantom auth tables in the codebase
  for months.
- The VM watchdog exists because dev hot-reload kills Firecracker children and
  leaves rows marked `running`. If VMs seem stuck, check it.
- E2E tests need a self-hosted KVM runner; they only run on pushes to `main`.
