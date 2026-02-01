# Agent UI Plan (OpenCode Web via Bonfire)

Goal: provide a Claude Code-like web experience inside Bonfire quickly by embedding OpenCode's existing web UI inside a Bonfire-authenticated route, backed by a Bonfire VM.

This plan intentionally avoids rebuilding an agent runtime (LLM/tool orchestration). Bonfire orchestrates VMs + workspaces; OpenCode provides the agent runtime and UI.

## MVP

- From Bonfire Web UI, user creates an "Agent Session" with a `repoUrl` (+ optional `branch`).
- Bonfire provisions (or reuses) a VM for the session.
- Bonfire bootstraps the VM workspace (clone repo, optional install).
- Bonfire starts OpenCode web server inside the VM.
- Bonfire reverse-proxies OpenCode Web UI through Bonfire API so it is accessible via Bonfire UI and protected by Bonfire auth.

## Architecture

### Components

- Bonfire Web (React/Vite): adds an Agent Sessions page and an "Open OpenCode" entrypoint.
- Bonfire API (Hono):
  - manages Agent Sessions
  - bootstraps VM workspace and starts OpenCode
  - reverse-proxies OpenCode HTTP/SSE to the browser
- VM image (agent-ready): includes OpenCode + build tools + SSH server.
- OpenCode server (runs inside VM): serves the OpenCode Web UI and provides server APIs.

### Request flow

```
Browser
  -> Bonfire Web UI
    -> Bonfire API (auth)
      -> (server-to-server) OpenCode in VM
```

OpenCode is never exposed directly to the browser via VM IP/port.

## Data model (Bonfire)

Add DB tables (Drizzle SQLite) to persist sessions (minimal MVP fields):

### `agent_sessions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | text (pk) | nanoid |
| `userId` | text (fk -> user.id) | owner |
| `title` | text | nullable; auto-populated from first prompt later |
| `repoUrl` | text | required |
| `branch` | text | nullable |
| `vmId` | text (fk -> vms.id) | the backing VM |
| `workspacePath` | text | e.g. `/home/agent/workspaces/<id>` |
| `status` | text | enum: `creating` / `ready` / `error` / `archived` |
| `errorMessage` | text | nullable; set when status=error |
| `createdAt` | integer | timestamp |
| `updatedAt` | integer | timestamp |

### Design decisions

- **1:1 session:VM mapping (MVP)** - each session gets a dedicated VM. Simplifies lifecycle and security. Port field removed since we hardcode `4096`.
- **No conversation persistence in Bonfire** - OpenCode stores sessions internally at `~/.local/share/opencode/`. Bonfire only stores the mapping.
- **Error tracking** - `errorMessage` field captures bootstrap failures for user-facing display.

## API surface (Bonfire)

### Agent Session CRUD

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent/sessions` | List user's sessions |
| `POST` | `/api/agent/sessions` | Create session (provisions VM, clones repo) |
| `GET` | `/api/agent/sessions/:id` | Get session details |
| `POST` | `/api/agent/sessions/:id/archive` | Archive session (stops OpenCode, optionally stops VM) |
| `POST` | `/api/agent/sessions/:id/retry` | Retry bootstrap on `error` status |

#### POST /api/agent/sessions request body

```typescript
{
  repoUrl: string;        // required
  branch?: string;        // optional, defaults to default branch
  title?: string;         // optional
  imageRef?: string;      // optional, defaults to agent-ready image
}
```

### OpenCode proxy

| Method | Path | Description |
|--------|------|-------------|
| `ANY` | `/api/agent/sessions/:id/opencode/*` | Proxies to `http://<vmIp>:4096/*` |

Requirements:
- Bonfire auth required
- Session must belong to user (or user is admin)
- Supports HTTP, SSE streaming (`/event`, `/global/event`)
- Injects `Authorization` header for OpenCode basic auth

### Path-handling strategy

OpenCode web uses Vite and likely has root-relative asset paths (`/assets/...`). Serving under `/api/agent/sessions/:id/opencode/` will break these.

**Solution**: Inject `<base href>` tag into HTML responses:

1. Proxy intercepts HTML responses (Content-Type: `text/html`)
2. Inject `<base href="/api/agent/sessions/:id/opencode/">` after `<head>`
3. All relative URLs resolve correctly

This is lighter than running a separate top-level route.

## VM bootstrap and OpenCode lifecycle

### SSH key injection

Bonfire needs to execute commands inside the VM. Options:

| Method | Pros | Cons |
|--------|------|------|
| **Baked key in image** | Simple | Less secure; same key for all VMs |
| **Firecracker MMDS** | Per-VM keys; no image rebuild | Requires MMDS setup |
| **Cloud-init** | Standard approach | Requires cloud-init in image |

**Recommendation for MVP**: Bake a known SSH keypair into the agent-ready image. Store the private key in Bonfire's config. This is acceptable because VMs are single-tenant and ephemeral.

**Post-MVP**: Generate per-session keypairs and inject via MMDS or cloud-init.

### Agent-ready VM image requirements

The agent-ready image must include:

```
System packages:
- openssh-server (running, accepting connections)
- git, curl, wget, ca-certificates
- build-essential, python3, pkg-config
- Common libs: libssl-dev, zlib1g-dev

User setup:
- User: `agent` (uid 1000)
- SSH authorized_keys: /home/agent/.ssh/authorized_keys (baked or injected)
- Passwordless sudo for `agent` user

Runtime:
- Node.js 22+ (via nvm or system package)
- pnpm (corepack enable && corepack prepare pnpm@latest --activate)
- OpenCode: curl -fsSL https://opencode.ai/install | bash
  - Installed globally: /home/agent/.local/bin/opencode

Process management:
- systemd user service template: opencode@.service
```

### systemd user service for OpenCode

Create `/home/agent/.config/systemd/user/opencode@.service`:

```ini
[Unit]
Description=OpenCode server for workspace %i
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/agent/workspaces/%i
Environment=OPENCODE_SERVER_PASSWORD=%i
Environment=OPENCODE_CONFIG_CONTENT={"share":"disabled","permission":"allow","server":{"port":4096,"hostname":"0.0.0.0"}}
ExecStart=/home/agent/.local/bin/opencode web --port 4096 --hostname 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

This allows Bonfire to run:
```bash
systemctl --user start opencode@<sessionId>
systemctl --user stop opencode@<sessionId>
systemctl --user status opencode@<sessionId>
```

### Boot sequence (on session creation)

```
1. Create agent_sessions record (status=creating)
2. Provision VM (or reuse existing running VM for user - post-MVP)
3. Wait for VM to be running + SSH available
4. SSH into VM and execute bootstrap:
   a. mkdir -p /home/agent/workspaces/<sessionId>
   b. git clone <repoUrl> /home/agent/workspaces/<sessionId>
   c. if branch: git -C /home/agent/workspaces/<sessionId> checkout <branch>
   d. Start OpenCode: systemctl --user start opencode@<sessionId>
5. Poll health endpoint: http://<vmIp>:4096/global/health
6. On success: update status=ready
7. On failure: update status=error, errorMessage=<details>
```

### Health checks and recovery

Bonfire API should:

1. **On proxy request**: Check `status=ready`. If not, return 503.
2. **On GET session**: Include health status from `/global/health` if available.
3. **Background (optional post-MVP)**: Periodic health poll, auto-restart on failure.

Recovery endpoint `POST /api/agent/sessions/:id/retry`:
- Only available when `status=error`
- Re-runs bootstrap sequence from step 3

## Credential and config strategy

### OpenCode authentication

OpenCode server supports HTTP basic auth via environment variables:
- `OPENCODE_SERVER_PASSWORD` - required password
- `OPENCODE_SERVER_USERNAME` - optional, defaults to `opencode`

**Strategy**: Use session ID as password. Bonfire proxy injects `Authorization: Basic <base64(opencode:sessionId)>` header.

### LLM provider credentials

OpenCode reads provider API keys from:
1. Environment variables (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
2. `~/.local/share/opencode/auth.json` (via `/connect` command)

**MVP approach**:

Option A (simpler): User configures provider via OpenCode's `/connect` command in the web UI. Credentials persist in VM at `~/.local/share/opencode/auth.json`.

Option B (Bonfire-managed): Bonfire stores encrypted provider keys per-user. Injects them as environment variables when starting OpenCode. Requires:
- New `user_secrets` table in Bonfire DB
- Encryption at rest (use `better-auth` encryption or libsodium)
- UI for users to add/manage provider keys

**Recommendation**: Start with Option A for MVP. Users manage their own credentials via OpenCode UI. Add Option B post-MVP for better UX.

### OpenCode config injection

Inject config via `OPENCODE_CONFIG_CONTENT` environment variable:

```json
{
  "share": "disabled",
  "permission": "allow",
  "autoupdate": false,
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  }
}
```

Key settings:
- `share: "disabled"` - prevent conversation uploads to opencode.ai
- `permission: "allow"` - allow all tool operations (MVP; harden post-MVP)
- `autoupdate: false` - prevent auto-updates in production VMs

### Post-MVP permission hardening

```json
{
  "permission": {
    "*": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "pnpm *": "allow",
      "rm -rf /*": "deny",
      "rm -rf /home/*": "deny"
    },
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny"
    },
    "external_directory": "deny"
  }
}
```

## Bonfire Web UI changes

### Navigation

Add "Agent" item to main navigation (after "VMs" or "Dashboard").

### Pages

#### AgentSessionsPage (`/agent/sessions`)

- **Header**: "Agent Sessions" + "New Session" button
- **Session list**: Table/cards showing:
  - Title (or repo name if no title)
  - Repository URL
  - Status badge (creating/ready/error/archived)
  - Last updated
  - Actions: Open, Archive
- **Empty state**: "No sessions yet. Create one to get started."

#### NewAgentSessionModal

- **Fields**:
  - Repository URL (required, text input with validation)
  - Branch (optional, text input)
  - Title (optional, text input)
- **Submit**: Creates session, shows loading state, redirects to session on ready

#### AgentSessionDetailPage (`/agent/sessions/:id`)

- **Header**: Session title + status badge
- **Info panel**: Repo URL, branch, created date, VM status
- **Main content**: Full-height iframe pointing to `/api/agent/sessions/:id/opencode/`
- **Error state**: Show error message + "Retry" button when status=error
- **Loading state**: Spinner while status=creating

### Rendering strategy

**MVP**: Iframe embedding

```tsx
<iframe
  src={`/api/agent/sessions/${sessionId}/opencode/`}
  className="w-full h-full border-0"
  allow="clipboard-read; clipboard-write"
/>
```

Pros:
- Fastest path to working UI
- OpenCode handles all its own state

Cons:
- Limited styling integration
- Iframe security restrictions

**Alternative (post-MVP)**: Build native Bonfire UI using OpenCode SDK

## Proxy implementation details

### Hono proxy route

```typescript
app.all('/api/agent/sessions/:id/opencode/*', async (c) => {
  const session = await getSession(c.req.param('id'));
  if (!session || session.userId !== c.get('user').id) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (session.status !== 'ready') {
    return c.json({ error: 'Session not ready' }, 503);
  }

  const vmIp = await getVmIp(session.vmId);
  const targetPath = c.req.path.replace(`/api/agent/sessions/${session.id}/opencode`, '');
  const targetUrl = `http://${vmIp}:4096${targetPath || '/'}`;

  // Proxy request with streaming support
  const response = await fetch(targetUrl, {
    method: c.req.method,
    headers: {
      ...filterHeaders(c.req.raw.headers),
      'Authorization': `Basic ${btoa(`opencode:${session.id}`)}`,
    },
    body: c.req.raw.body,
  });

  // Handle HTML responses - inject base href
  if (response.headers.get('content-type')?.includes('text/html')) {
    const html = await response.text();
    const baseHref = `/api/agent/sessions/${session.id}/opencode/`;
    const modifiedHtml = html.replace('<head>', `<head><base href="${baseHref}">`);
    return c.html(modifiedHtml, response.status);
  }

  // Stream other responses
  return new Response(response.body, {
    status: response.status,
    headers: filterResponseHeaders(response.headers),
  });
});
```

### SSE support

OpenCode uses SSE for real-time updates:
- `/event` - session events
- `/global/event` - global events

Ensure proxy:
- Sets `Content-Type: text/event-stream`
- Disables response buffering
- Keeps connection alive

### Headers to filter

Strip hop-by-hop headers:
- `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`
- `te`, `trailer`, `transfer-encoding`, `upgrade`

Add/override:
- `host` - set to VM IP
- `authorization` - inject basic auth

## Development workflow

### Local development

1. Start Bonfire in dev mode: `docker compose -f docker/... up -d`
2. Vite proxies `/api` to API server (already configured)
3. Test agent sessions via UI at `http://localhost:5173/agent/sessions`

### Testing without real VMs

Create mock mode for agent session bootstrap:
- Skip VM provisioning
- Return mock session with status=ready
- Proxy to a local OpenCode instance

## Error handling

### Git clone failures

- Private repo without credentials -> error with message "Authentication required"
- Invalid URL -> error with message "Invalid repository URL"
- Network failure -> error with retry option

### OpenCode startup failures

- Port already in use -> error (shouldn't happen with 1:1 session:VM)
- Missing dependencies -> error with detailed message

### VM failures

- VM stops unexpectedly -> session status=error, offer retry
- VM unreachable -> health check fails, mark session unhealthy

## Security considerations

### MVP security posture

- VMs are single-tenant (one user per VM)
- OpenCode has full access within VM
- Provider credentials stored in VM (user-managed)
- Environment variables visible to processes in VM

### Hardening roadmap (post-MVP)

1. **Network isolation**: Block VM egress except to allowed hosts
2. **Credential encryption**: Store provider keys encrypted in Bonfire DB
3. **Permission policies**: Default to restrictive OpenCode permissions
4. **Audit logging**: Log tool calls via OpenCode events API
5. **Session isolation**: Ensure OpenCode sessions don't leak between Bonfire sessions

## Milestones

### Phase 1: Data model and CRUD

- [ ] 1.1 Add `agent_sessions` table schema (Drizzle migration)
- [ ] 1.2 Implement CRUD routes without VM integration
  - [ ] GET /api/agent/sessions
  - [ ] POST /api/agent/sessions (creates record, status=creating)
  - [ ] GET /api/agent/sessions/:id
  - [ ] POST /api/agent/sessions/:id/archive
- [ ] 1.3 Add unit tests for CRUD routes

### Phase 2: Agent-ready VM image

- [ ] 2.1 Create Dockerfile/build script for agent-ready image
  - [ ] Base: existing Bonfire VM image
  - [ ] Add: openssh-server, git, build-essential, Node.js, pnpm
  - [ ] Add: OpenCode installation
  - [ ] Add: `agent` user with SSH key
  - [ ] Add: systemd user service template
- [ ] 2.2 Test image boots and SSH works
- [ ] 2.3 Test OpenCode starts and serves web UI
- [ ] 2.4 Document image build process

### Phase 3: SSH bootstrap service

- [ ] 3.1 Add SSH client to API (e.g., `ssh2` npm package)
- [ ] 3.2 Implement bootstrap sequence:
  - [ ] Wait for VM SSH ready
  - [ ] Clone repository
  - [ ] Start OpenCode via systemctl
- [ ] 3.3 Implement health polling
- [ ] 3.4 Wire up POST /api/agent/sessions to trigger bootstrap
- [ ] 3.5 Implement retry endpoint
- [ ] 3.6 Add integration tests with mock SSH

### Phase 4: OpenCode proxy

- [ ] 4.1 Implement proxy route `/api/agent/sessions/:id/opencode/*`
- [ ] 4.2 Add basic auth injection
- [ ] 4.3 Add HTML `<base href>` rewriting
- [ ] 4.4 Verify SSE streaming works
- [ ] 4.5 Add proxy integration tests

### Phase 5: Web UI

- [ ] 5.1 Add "Agent" navigation item
- [ ] 5.2 Implement AgentSessionsPage (list + create)
- [ ] 5.3 Implement AgentSessionDetailPage (iframe + status)
- [ ] 5.4 Add loading/error states
- [ ] 5.5 Add responsive styling
- [ ] 5.6 Manual E2E testing

### Phase 6: Polish and hardening

- [ ] 6.1 Add OpenCode config injection via env var
- [ ] 6.2 Add session archiving (stop OpenCode, optionally stop VM)
- [ ] 6.3 Add basic error recovery (retry button)
- [ ] 6.4 Documentation: user guide for agent sessions
- [ ] 6.5 Documentation: VM image customization

### Post-MVP backlog

- [ ] Per-session SSH keypair generation (MMDS injection)
- [ ] Bonfire-managed provider credentials (encrypted storage)
- [ ] Background health monitoring
- [ ] Restrictive default permissions
- [ ] VM resource limits configuration
- [ ] Session sharing (read-only access for teammates)
- [ ] Native UI using OpenCode SDK (replace iframe)

## Open questions

1. **VM reuse**: Should we reuse VMs across sessions for the same user? Pros: faster startup. Cons: isolation concerns, port conflicts.
   - **Current answer**: No, 1:1 mapping for MVP.

2. **Concurrent sessions**: Limit to N sessions per user? VMs are resource-intensive.
   - **Suggestion**: Limit to 3 concurrent non-archived sessions per user for MVP.

3. **Session persistence**: How long to keep archived sessions? Auto-delete after N days?
   - **Suggestion**: Keep records indefinitely, VM data deleted on archive.

4. **Provider credentials flow**: Should Bonfire show a "Connect Provider" UI before OpenCode, or let users do it in OpenCode?
   - **Current answer**: Let users manage in OpenCode for MVP.
