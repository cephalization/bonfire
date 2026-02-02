# Serial Console Bootstrap (No SSH)

Goal: bootstrapping Agent Sessions without relying on SSH. All provisioning happens via the Firecracker serial console (ttyS0) using the existing named pipe plumbing.

This document is an implementation plan for future work.

## Why

Today, Agent Sessions use SSH (`packages/api/src/services/bootstrap.ts`) to:

- create a workspace directory
- clone a repo
- start OpenCode (systemd user unit)
- poll `http://<vm-ip>:4096/global/health`

In practice, VMs started by Bonfire are assigned an IP in the DB, but the guest is not configured to bring up networking. That makes SSH (and OpenCode health checks) unreachable.

Serial console bootstrap solves this by configuring the guest from the host side via ttyS0.

## Preconditions (required)

Serial-only bootstrap requires a non-interactive way to obtain a shell prompt on ttyS0.

Decision: enable autologin on `ttyS0` for user `agent` in the agent-ready image.

### Agent image change (autologin)

Update `docker/Dockerfile.agent` (or equivalent image build pipeline) to enable systemd serial getty autologin:

- Add a systemd drop-in for `serial-getty@ttyS0.service` that uses `agetty --autologin agent ...`.
- Ensure `agent` exists (already true) and has passwordless sudo (already true).

Without this, the serial runner will block on `login:` / `Password:` and bootstrap cannot be automated.

## Phase 1: Serial command runner

Create a small abstraction around `createSerialConsole()` (`packages/api/src/services/firecracker/serial.ts`) that can run commands deterministically.

### Requirements

- Connect to a VM serial console by `vmId` (pipes already created by Firecracker process spawn).
- Detect readiness:
  - send `\n`
  - succeed when a shell prompt is observed
  - fail fast if `login:` is observed (actionable error: "enable ttyS0 autologin")
- Run commands with marker framing:
  - Write:
    - `echo __BF_BEGIN__<nonce>`
    - `<cmd>; echo __BF_END__<nonce>:$?`
  - Read until the end marker appears
  - Parse exit code
- Support timeouts and max output size (avoid unbounded buffers)

### Concurrency

Terminal WebSocket currently enforces exclusivity per VM.

Options:

1. Minimal: per-VM lock for bootstrap; if terminal is attached, mark session error (`"VM terminal in use"`).
2. Better: implement a `SerialConsoleManager` that owns a single console per VM and multiplexes output to multiple subscribers (bootstrap + terminal).

## Phase 2: Serial bootstrap service

Refactor `RealBootstrapService` (`packages/api/src/services/bootstrap.ts`) to use serial instead of SSH.

### Bootstrap flow

1. Persist initial session fields:
   - `workspacePath=/home/agent/workspaces/<sessionId>`
   - keep `status=creating`

2. Connect serial and confirm shell.

3. Configure guest networking from serial (fixes current root cause):

- Bring up interface:
  - `sudo ip link set dev eth0 up`
- Assign IP (from DB) and route:
  - `sudo ip addr add <vmIp>/24 dev eth0 || true`
  - `sudo ip route replace default via 10.0.100.1`
- DNS:
  - `echo 'nameserver 1.1.1.1' | sudo tee /etc/resolv.conf`
- Validate:
  - `ping -c 1 -W 1 10.0.100.1`
  - optional: `curl -fsSL https://github.com >/dev/null`

If this fails: set session `status=error` with a clear `errorMessage`.

4. Workspace + repo:

- `mkdir -p <workspacePath>`
- `git clone <repoUrl> <workspacePath>`
- optional: `git -C <workspacePath> checkout <branch>`

If clone fails (private repo): set session error with a message about credentials.

5. Start OpenCode:

- Preferred (agent image provides systemd user service):
  - `systemctl --user start opencode@<sessionId>`
- Fallback if `systemctl --user` fails:
  - run OpenCode directly with `nohup` + env vars (`OPENCODE_SERVER_PASSWORD`, `OPENCODE_CONFIG_CONTENT`) and write logs to `/tmp/opencode.log`.

6. Host-side readiness:

- Poll `http://<vmIp>:4096/global/health` from the API container (same behavior as today).
- If successful: set `status=ready`.
- If timed out: set `status=error` with message.

### Progress reporting (optional)

To avoid "creating forever" and to aid debugging:

- update `agent_sessions.error_message` while still `creating` with messages like:
  - `Bootstrapping: configuring network`
  - `Bootstrapping: cloning repo`
  - `Bootstrapping: starting OpenCode`

Or add a dedicated column (e.g. `bootstrap_step`).

## Phase 3: Route & UX adjustments

### API

- Ensure bootstrap triggers even if VM IP assignment lags:
  - poll briefly for `vms.ipAddress`
  - if missing after timeout, set session `error`.

### Web UI

- Disable selecting running VMs with `no IP` for agent sessions.
- Show `errorMessage` prominently and expose a retry action.

## Testing

- Unit: serial command runner framing/timeout behavior.
- Unit: bootstrap service updates DB correctly on success/failure.
- E2E (ideal): boot agent-ready VM, create session, wait for `ready`, verify OpenCode proxy routes.
