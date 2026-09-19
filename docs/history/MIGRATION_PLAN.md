# Bun -> Node 24 + pnpm Migration Plan (Always-Green)

This document is the operational runbook for migrating Bonfire from Bun to Node 24+ with pnpm, while keeping SQLite (via Drizzle + `better-sqlite3`). It is written to be resilient: if anything goes sideways, you can restart from this file.

Scope

- Remove Bun entirely: runtime, test runner, scripts, Docker base images, CI setup, docs.
- Pin modern Node (24+).
- Keep SQLite as an embedded DB (single file) and keep Drizzle.
- Preserve terminal architecture (Firecracker serial console via FIFOs) and its client protocol.
- Rewrite branch history from merge-base after the migration is stable.

Guiding constraints

- Always-green: after each step, we must be able to run a defined set of checks successfully.
- No history rewriting until after the migration is fully green at HEAD.
- Keep changes staged and reviewable; avoid a single monolithic diff.

Definitions

- Merge-base: `BASE=$(git merge-base HEAD main)` (currently `b8d4e76ee7baa4be0ea237e2fbaaed8c2292e081`).
- Green gates:
  - `pnpm -r typecheck`
  - `pnpm -r test` (unit)
  - `pnpm run test:int` (Docker integration)
  - `docker build -f docker/Dockerfile .`
  - Optional/when available: `pnpm run test:e2e` on a KVM-capable host

Safety / recovery

1. Create a permanent backup pointer before starting:
   - `git branch backup/initial-plan-impl-pre-migration HEAD`
   - (Optional) `git push -u origin backup/initial-plan-impl-pre-migration`
2. Keep work on a dedicated working branch (the current branch is fine if already isolated).
3. If a step fails and rollback is needed:
   - Prefer `git revert <bad-commit>` (non-destructive) while iterating.
   - Avoid destructive resets unless explicitly intended.
4. Before history rewrite:
   - Create a second backup pointer: `git branch backup/initial-plan-impl-pre-rewrite HEAD`.

Hybrid approach: parallel inventory, single integrator
We will use subagents to map blast radius and tricky invariants, then implement centrally to avoid conflicts.

Subagent inventory prompts (run in parallel)

- API runtime/WS agent
  - Identify Bun-specific server entrypoints (`Bun.serve`, `hono/bun`) and how terminal WS is currently wired.
  - Enumerate required invariants for terminal WS behavior:
    - `ready` message, error message format, exclusive session semantics, resize handling (ignored), reconnection handling.
  - Identify how auth applies to WS (cookies, query param fallback).

- DB/migrations agent
  - Enumerate all uses of `bun:sqlite`, `drizzle-orm/bun-sqlite`, `BunSQLiteDatabase` types.
  - Identify where migrations/seed are executed and what assumptions exist (paths, schema presence).
  - Confirm Better Auth schema/tables requirements and where they’re enforced.

- Tests agent
  - Enumerate all `bun:test` usages and any Bun-only behaviors relied upon.
  - Classify tests: unit vs integration vs e2e.
  - Propose Vitest configuration split (node env vs happy-dom) and migration steps.

- Docker/CI agent
  - Enumerate all Dockerfiles and compose files that use Bun images/commands.
  - Identify e2e harness scripts that assume Bun (`scripts/run-e2e-combined.sh`, etc.).
  - Propose Node 24 + pnpm Docker build strategy that supports `better-sqlite3`.

- Web/Vite agent
  - Enumerate Bun-driven workarounds in Vite (`websocket-interceptor`, WS proxy disabled).
  - Confirm how the web terminal computes WS URL and how auth cookies should flow.

Deliverable from each subagent

- A bullet list of files to change.
- A list of invariants to preserve.
- Any high-risk edge cases.

Execution phases (always-green)

Phase 0: Preflight

- Confirm current baseline passes existing checks (as-is) so we know what “green” means.
- Snapshot the merge-base and current branch status.

Phase 1: pnpm + Node scaffolding (no runtime switch yet)
Goal: add pnpm + Node version pinning without breaking existing behavior.

Tasks

- Add `pnpm-workspace.yaml` with `packages/*`.
- Root `package.json`:
  - Add `packageManager: "pnpm@<pinned>"`.
  - Add `engines: { "node": ">=24" }`.
  - Add pnpm scripts in parallel to existing bun scripts (temporary) so we can keep green while migrating.
  - Add `corepack` expectation to docs/CI later.
- Introduce `pnpm-lock.yaml`.

Green gates

- Ensure pnpm can install:
  - `corepack enable`
  - `pnpm install`
- Keep existing tests green (still using bun where necessary) OR provide pnpm scripts that invoke bun for now.

Notes

- This phase can keep Bun as a dependency temporarily to remain green.
- “Always-green” here means: whatever CI/README expects should still work while pnpm is being introduced.

Phase 2: SQLite driver migration (Bun sqlite -> better-sqlite3)
Goal: switch DB layer first while minimizing surface changes.

Tasks

- Replace DB wiring:
  - `packages/api/src/db/index.ts`
  - `packages/api/src/db/migrate.ts`
  - `packages/api/migrate.ts`
  - `packages/api/src/db/seed.ts`
- Replace types across API:
  - `BunSQLiteDatabase` -> `BetterSQLite3Database` (Drizzle)
  - Update all router/service configs accordingly.
- Update integration/test utilities:
  - `packages/api/src/test-utils.ts`
  - `packages/api/.integration/*.test.ts`

Green gates

- `pnpm -r typecheck`
- Unit tests (whatever runner is still in place during this step)
- Integration tests (Docker) if they rely on DB.

Phase 3: Firecracker unix socket HTTP client (remove Bun-only fetch unix)
Goal: eliminate Bun-only `fetch({ unix })` without changing higher-level behavior.

Tasks

- Replace unix-socket fetch implementation:
  - `packages/api/src/services/firecracker/socket-client.ts`
- Preserve request/response shapes and error handling (explicit socket existence checks).

Green gates

- `pnpm -r typecheck`
- Unit tests for socket client/config generation (if present)
- Integration tests that touch VM lifecycle mocking.

Phase 4: Test runner migration (bun:test -> vitest)
Goal: move tests to Vitest while runtime may still be Bun (if needed). This is the hardest “always-green” phase; proceed package-by-package.

Strategy

- Migrate package tests incrementally:
  1. `packages/sdk`
  2. `packages/cli`
  3. `packages/api` (unit first)
  4. `packages/web` (happy-dom)
  5. `e2e/` (optional; can remain separate until Docker/runtime is done)

Tasks

- Add Vitest config(s):
  - Node env for api/cli/sdk
  - Happy-dom for web
- Replace `bun:test` imports and semantics.
- Update package scripts.

Green gates

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm run test:int` (if integration is tied into test runner)

Phase 5: API runtime migration (Bun server -> Node server + WS)
Goal: move server runtime off Bun and implement terminal WebSocket on Node.

Tasks

- Replace `Bun.serve` entrypoint in `packages/api/src/index.ts`:
  - Use `@hono/node-server` for HTTP.
  - Replace Bun-only main check (`import.meta.main`) with Node-safe entry.
- Terminal WS:
  - Replace `hono/bun` `upgradeWebSocket` approach.
  - Use `ws` bound to the same HTTP server.
  - Preserve protocol:
    - server -> client: JSON `{ready:true, vmId}` then terminal output; JSON `{error:"..."}` for failures.
    - client -> server: keystrokes; resize JSON is ignored (do not forward).
  - Preserve exclusivity: one active connection per VM.
  - Preserve cleanup semantics on close/error.
- Auth on WS:
  - Validate session using cookies from the WS upgrade request.
  - Keep `?cookie=` query fallback if needed.

Green gates

- `pnpm -r typecheck`
- `pnpm -r test`
- Smoke: start API and hit `/health`.
- Web terminal can connect and receive `{ready:true}`.

Phase 6: Web dev proxy cleanup (enable WS proxy)
Goal: remove Bun-era proxy workarounds so dev uses same-origin WS and cookies work naturally.

Tasks

- `packages/web/vite.config.ts`:
  - Remove `websocket-interceptor` plugin.
  - Enable `server.proxy["/api"].ws = true`.
- `packages/web/src/lib/api.ts`:
  - Prefer same-origin WS base by default.
  - Keep `VITE_WS_URL` override.

Green gates

- `pnpm -r typecheck`
- Web dev can load and terminal connects via proxied WS.

Phase 7: Docker + CI migration (Bun images -> Node images)
Goal: migrate container builds and CI without regressing the e2e harness.

Tasks

- Dockerfiles:
  - `docker/Dockerfile` -> Node 24 multi-stage build.
  - `docker/test.Dockerfile` -> Node 24 + pnpm run tests.
  - `packages/web/Dockerfile` -> Node 24 + pnpm.
- Ensure `better-sqlite3` builds reliably:
  - Prefer Debian-based Node images.
  - Install build tooling in builder stage (`python3`, `make`, `g++`) as fallback.
- Compose:
  - Update `docker/docker-compose*.yml` commands from `bun ...` to `pnpm ...`.
  - Remove `BUN_HOT_RELOAD` env.
- Scripts:
  - `docker/dev-entrypoint.sh` -> use pnpm scripts.
  - `scripts/run-e2e-combined.sh` -> use pnpm and Node-based test runner.
- CI:
  - `.github/workflows/test.yml`: use `actions/setup-node`, `corepack enable`, `pnpm install`, `pnpm test`.

Green gates

- `docker build -f docker/Dockerfile .`
- `pnpm run test:int`
- CI config is syntactically valid and matches new commands.

Phase 8: Docs sweep (remove Bun references)
Goal: eliminate Bun instructions and Bun-specific caveats.

Files to update (expected)

- `README.md`
- `AGENT.md`
- `CONTRIBUTING.md`
- `PLAN.md`
- `scripts/setup.sh` (replace bun commands)

Green gates

- Docs build not required, but ensure commands are consistent and correct.

Phase 9: Remove Bun completely
Goal: no Bun dependency or configuration remains.

Tasks

- Remove Bun configs (`bunfig.toml`) and lockfiles.
- Remove Bun-only TS types (`bun-types`) from:
  - `packages/api/tsconfig.json`
  - `packages/cli/tsconfig.json`
  - `packages/web/tsconfig.json`
  - `e2e/tsconfig.json`
- Ensure scripts no longer reference `bun`, `bunx`, `bun test`.

Green gates

- Full green gates.

Phase 10: History rewrite from merge-base (only after everything is green)
Goal: produce an agent-readable commit history with no Bun narrative.

Non-interactive method (no `git rebase -i`)

1. Create backup pointer:
   - `git branch backup/initial-plan-impl-pre-rewrite HEAD`
2. Compute base:
   - `BASE=$(git merge-base HEAD main)`
3. Soft reset:
   - `git reset --soft "$BASE"`
   - `git reset` (to unstage everything)
4. Recreate curated commits by staging paths and committing:
   - repo tooling (pnpm/node)
   - db driver (better-sqlite3)
   - firecracker uds client
   - api runtime + terminal ws
   - tests (vitest)
   - docker/ci
   - docs
5. Run green gates.
6. Force push:
   - `git push --force-with-lease origin <branch>`

Appendix: known Bun-era artifacts to remove/replace

- Bun runtime:
  - `Bun.serve` in `packages/api/src/index.ts`
  - `hono/bun` imports (`websocket`, `upgradeWebSocket`)
- Bun sqlite:
  - `bun:sqlite`
  - `drizzle-orm/bun-sqlite`
  - `BunSQLiteDatabase` types
- Bun test:
  - `bun:test` imports
- Bun commands:
  - `bun`, `bunx`, `bun install`, `bun test`, `bun run ...`
- Vite workaround (Bun WS proxy limitation):
  - `packages/web/vite.config.ts` websocket interceptor + `ws:false` proxy
