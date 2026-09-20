# Self-hosting Bonfire

Bonfire boots Firecracker microVMs, so it needs `/dev/kvm`. That single
requirement decides where it can run, and it rules out most of the obvious
choices.

## Where it can run

Firecracker needs "either a bare-metal machine (with hardware virtualization),
or a virtual machine that supports nested virtualization"
([Firecracker docs](https://github.com/firecracker-microvm/firecracker/blob/main/docs/dev-machine-setup.md)).

**Recommended: a Hetzner dedicated server**, from the
[server auction](https://www.hetzner.com/sb) or the AX line, running Ubuntu
24.04 on x86_64. It is real bare metal, so `/dev/kvm` is simply there with no
flags to set; it is a flat monthly price rather than a metered hourly one; and
it has the disk for rootfs images, which are ~3GB each. Pick x86_64, not an ARM
box: the agent kernel and rootfs are built for x86_64.

Alternatives, in case that does not suit:

- **GCP with nested virtualization** — works on `N1` (Haswell or newer) and
  `N2` machine types, but **not** `E2` or `N2D`. Choose this if you want to
  start and stop the host. Nested VMs are slower than bare metal.
- **AWS** — only `.metal` instance types (`c5.metal` and friends). Correct, but
  expensive for a host that stays up.

These cannot run Bonfire at all, because they do not expose `/dev/kvm`:
Hetzner Cloud (CX/CPX), DigitalOcean, Linode, Vultr's cloud instances, ordinary
EC2 instances, and container platforms such as Railway, Render and Fly.io. Fly
runs Firecracker itself, so there is nothing left to nest inside.

## Bringing a host up

From a fresh Ubuntu 24.04 host, as root:

```bash
git clone https://github.com/cephalization/bonfire /opt/bonfire
cd /opt/bonfire
git checkout feat/conversations
sudo ./scripts/bootstrap-host.sh
```

The script checks the host can run Bonfire before installing anything, installs
Docker and Compose, writes a `.env` with a generated `BETTER_AUTH_SECRET`,
builds the agent VM image, and starts the stack. It is idempotent: to deploy a
new commit, `git pull` and run it again.

The first run takes a while — the agent image build is ~20 minutes and ~3GB.
`SKIP_AGENT_IMAGE=1` skips it, at the cost of not being able to boot a VM.

It prints the tunnel command and what to do next when it finishes.

## Nothing is exposed to the internet

`docker/docker-compose.host.yml` publishes both ports on `127.0.0.1` only, so
the host has no open Bonfire port at all. Reach it by forwarding a port over
SSH from your own machine:

```bash
ssh -N -L 8080:127.0.0.1:80 root@your-host
```

Then open <http://localhost:8080>. `BONFIRE_URL` in `.env` is set to that
address, which is what matters: Better Auth ties session cookies and its origin
check to it, so it must be the address in the browser's address bar.

**Do not reach for `ufw` instead.** Docker publishes ports by writing its own
DNAT rules, which `ufw` does not filter, so a `ufw deny` rule looks like it is
protecting the service while the port stays open to the internet. Binding to
loopback is what actually closes it.

When you do want it reachable by other people, the honest options are a VPN
(Tailscale or WireGuard) with the ports bound to that interface, or a real
domain with TLS in front — at which point `BONFIRE_URL` must change to that
URL. Sign-up stays invitation-only either way.

## The first account

Sign-ups are invitation-only after the first account, so whoever registers
first becomes the admin. Through the tunnel, sign up, create an organization,
and invite the others from **Settings → Members**. There is no email service,
so invitation links are shown to the inviter in the UI and written to the API
log:

```bash
docker compose -f docker/docker-compose.yml \
               -f docker/docker-compose.prod.yml \
               -f docker/docker-compose.host.yml logs -f api
```

Before anyone can talk to an agent, an org admin sets the organization's LLM
provider keys under **Settings → Providers**. They are encrypted with a key
derived from `BETTER_AUTH_SECRET`, which is why the bootstrap script never
replaces an existing secret: rotating it makes the stored keys unreadable.

## Troubleshooting

- **`/dev/kvm is missing`** — the host cannot run Bonfire; see the first
  section. Nothing was installed.
- **Creating a VM fails** — check the agent image is registered
  (`images/agent-kernel` and `images/agent-rootfs.ext4` must exist in the
  checkout, since Compose bind-mounts that directory into the container). Build
  it with `./scripts/build-agent-image-docker.sh` and restart the stack.
- **Sign-in succeeds but the next request is 401** — `BONFIRE_URL` does not
  match the browser's address. They must be identical, scheme and port
  included.
- **Agents never reply** — the VM image must contain opencode (see
  `docs/AGENT_IMAGE.md`) and the organization needs provider keys.
- **The database vanished** — it lives in the `bonfire-data` Docker volume.
  `docker compose down -v` deletes it, which also reopens first-user sign-up.
