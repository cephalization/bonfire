# Agent Task Prompt

You are a coding agent implementing tasks one at a time.

## Your Mission

Implement ONE task from dex, test it, commit it, log your learnings, then EXIT.

## NOTE (Post-Migration)

This file was written for the Bun-based implementation. Bonfire has migrated to Node 24+ and pnpm.
If any commands below mention Bun, treat them as historical.

## The Loop

1. **Find work** - Run `dex list --ready` to see tasks with all dependencies complete
2. **Start task** - Run `dex start <id>` to mark the task in-progress
3. **Get context** - Run `dex show <id>` for full task details and context
4. **Implement** - Write the code following the project's patterns. Use prior learnings to your advantage.
5. **Write tests** - For behavioral code changes, create unit tests in the appropriate directory. Skip for documentation-only tasks.
6. **Run tests** - Execute tests from the package directory (ensures existing tests still pass)
7. **Fix failures** - If tests fail, debug and fix. DO NOT PROCEED WITH FAILING TESTS.
8. **Complete task** - Run `dex complete <id> --result "Brief summary of what was done"`
9. **Log learnings** - Append insights to LEARNINGS.md
10. **Commit** - Stage and commit: `git add -A && git commit -m "feat: <task-id> - <description>"`
11. **EXIT** - Stop. The loop will reinvoke you for the next task.

---

## Dex Commands

| Command | Purpose |
|---------|---------|
| `dex list --ready` | Show tasks ready to work on (deps complete) |
| `dex start <id>` | Mark task as in-progress |
| `dex show <id>` | Get full task details |
| `dex complete <id> --result "..."` | Mark task complete with summary |
| `dex status` | Show overall progress |

---

## Signs

READ THESE CAREFULLY. They are guardrails that prevent common mistakes.

---

### SIGN: One Task Only

- You implement **EXACTLY ONE** task per invocation
- After your commit, you **STOP**
- Do NOT continue to the next task
- Do NOT "while you're here" other improvements
- The loop will reinvoke you for the next task

---

### SIGN: Dependencies Matter

Only work on tasks returned by `dex list --ready`.
These are tasks with all dependencies already complete.

```
❌ WRONG: Start task with pending dependencies
✅ RIGHT: Use `dex list --ready` to find eligible tasks
✅ RIGHT: If no ready tasks, EXIT with clear message
```

Do NOT skip ahead. Do NOT work on tasks out of order.

---

### SIGN: Learnings are Required

Before exiting, append to `LEARNINGS.md`:

```markdown
## <task-id>

- Key insight or decision made
- Gotcha or pitfall discovered
- Pattern that worked well
- Anything the next agent should know
```

Be specific. Be helpful. Future agents will thank you.

---

### SIGN: Commit Format

One commit per task. Format:

```
feat: <task-id> - <short description>
```

Only commit AFTER tests pass.

---

### SIGN: Don't Over-Engineer

- Implement what the task specifies, nothing more
- Don't add features "while you're here"
- Don't refactor unrelated code
- Don't add abstractions for "future flexibility"
- Don't make perfect mocks in tests - use simple stubs instead
- Don't use complex test setups - keep tests simple and focused
- YAGNI: You Ain't Gonna Need It

---

## Quick Reference

| Action | Command |
|--------|---------|
| Install deps | `corepack enable && pnpm install` |
| Run unit tests | `pnpm -r test` |
| Run integration tests | `pnpm run test:int` (via Docker) |
| Run E2E tests | `pnpm run test:e2e` (requires KVM) |
| Build all packages | `pnpm run build` |
| Dev (API + Web) | `pnpm run dev` (mprocs) |
| Dev (API only) | `pnpm --filter @bonfire/api dev` |
| Dev (Web only) | `pnpm --filter @bonfire/web dev` |
| Lint | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Generate SDK | `pnpm --filter @bonfire/sdk generate` |
| DB migrations | `pnpm --filter @bonfire/api migrate` |
| Stage all | `git add -A` |
| Commit | `git commit -m "feat: ..."` |

**Monorepo Packages:**
- `packages/api` - Hono API server
- `packages/web` - React + Vite frontend
- `packages/sdk` - TypeScript SDK (auto-generated)
- `packages/cli` - CLI with Clack

**Key Files:**
- `PLAN.md` - Root implementation plan (reference for all tasks)
- `.math/todo/LEARNINGS.md` - Accumulated project learnings
- `turbo.json` - Turborepo task configuration

**Directory Structure:**
- `.math/todo/` - Active sprint files (PROMPT.md, LEARNINGS.md)
- `.math/backups/<summary>/` - Archived sprints from `math iterate`
- `packages/*/src/**/*.test.ts` - Unit tests (run anywhere)
- `packages/*/src/**/*.integration.test.ts` - Integration tests (Docker)
- `e2e/*.test.ts` - End-to-end tests (require KVM)

---

## Remember

You do one thing. You do it well. You learn. You exit.
