# Deploying Bonfire to Railway

This is the runbook for the hosted instance of the `feat/conversations` branch.
It exists because Bonfire cannot run in full on macOS: Firecracker needs
`/dev/kvm`, which a Mac does not have. Railway gives us a Linux host the whole
team can reach.

## What works on Railway, and what does not

Railway runs containers without `/dev/kvm`, so **microVMs do not work there**.
That is a property of the platform, not something configuration can fix. On the
deployed instance you get:

- **Works:** accounts, organizations, invitations, API keys, conversations, and
  per-organization provider keys — everything that is API plus database.
- **Does not work:** creating a VM, the browser terminal, and therefore agent
  turns, which run opencode inside a VM. Creating a VM fails when Firecracker
  cannot open `/dev/kvm`.

Use the Railway instance to exercise auth, the org model and the chat UI. VM and
agent work still needs a Linux box with KVM (see `docs/AGENT_IMAGE.md`).

## How it is built

`docker/Dockerfile.railway` builds **one** image that serves both the API and
the web app from a single process on `$PORT`:

- No Firecracker binary and no container networking, unlike
  `docker/Dockerfile.api` — they are dead weight without `/dev/kvm`, and
  dropping them makes the build much faster.
- The web build is copied to `/app/public` and served by the API
  (`BONFIRE_WEB_ROOT=./public`), so there is no nginx and no second service.
  One origin means session cookies and Better Auth's origin check work with
  nothing to configure.
- The server creates the database file and applies pending migrations on start,
  so there is no separate migrate step.

`railway.json` points Railway at that Dockerfile and sets `/health` as the
healthcheck.

## Keeping it off the public internet

Railway routes public traffic to a service **only if that service has a
domain**. So the rule is simply: never run `railway domain` on this service. A
service with no domain has no public address at all.

To reach it from your own machine, use Railway SSH's local port forwarding,
which tunnels from your laptop into the container's loopback. Forwarding is
limited to the container's loopback and Railway's private network — it cannot
be used to reach the public internet.

```bash
ssh -N -L 8080:127.0.0.1:3000 bonfire-railway
```

Then open <http://localhost:8080>. `BONFIRE_URL` is set to that address, so
cookies, the origin check and invitation links all match.

When you do want it public later: run `railway domain`, then change
`BONFIRE_URL` to the generated `https://` URL. Leaving `BONFIRE_URL` pointing at
localhost while serving a public domain will break sign-in.

## First-time setup

Run these from a checkout of the branch, with the Railway CLI logged in.

```bash
git checkout feat/conversations && git pull

# 1. Create the project and link this directory to it.
railway init --name bonfire

# 2. Create the service from the GitHub repo, so pushes deploy it.
railway add --service bonfire --repo cephalization/bonfire

# 3. Persist the SQLite database. Without a volume the database is lost on
#    every deploy, including the admin account.
railway volume add --service bonfire --mount-path /var/lib/bonfire

# 4. Variables. PORT is pinned so the tunnel below has a fixed target.
railway variable set --service bonfire \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BONFIRE_URL=http://localhost:8080 \
  PORT=3000
```

`DATABASE_URL` defaults to `/var/lib/bonfire/bonfire.db` in the image, which is
the volume mount path, so it does not need setting.

Then set the deploy branch, which the CLI cannot do: in the Railway dashboard,
**service → Settings → Source → Branch**, change it from `main` to
`feat/conversations`. Until that is set, Railway builds `main`, which has none
of this.

Finally, set up SSH access:

```bash
railway ssh keys add          # pick a key from ~/.ssh interactively
railway ssh config --service bonfire --alias bonfire-railway
```

## Everyday use

```bash
ssh -N -L 8080:127.0.0.1:3000 bonfire-railway   # tunnel, leave running
railway logs --service bonfire                  # follow logs
railway redeploy --service bonfire              # rebuild without a new commit
railway ssh --service bonfire                   # shell in the container
```

Pushing to `feat/conversations` deploys automatically once the branch is set.

## Seeding the first account

Sign-up is invitation-only after the first account, so the first person to
register becomes the admin. Through the tunnel, open <http://localhost:8080>,
sign up, create an organization, and invite everyone else from
**Settings → Members**. Invitation links are written to the API log
(`railway logs`) because there is no email service.

If someone beats you to it, or you want to start over, delete the volume and
redeploy — that discards the database and reopens first-user sign-up.

## Troubleshooting

- **Deploy crashes immediately with a message about `BETTER_AUTH_SECRET`** —
  the variable is missing or still the development default. Set a real one.
- **Sign-in succeeds but the next request is 401** — `BONFIRE_URL` does not
  match the address in the browser's address bar. They must be identical,
  scheme and port included.
- **Healthcheck fails** — check `railway logs`. The server logs
  `✅ Server running` once it is listening; a migration failure appears above
  it.
- **`railway ssh` says unauthorized** — the SSH key is not registered; run
  `railway ssh keys add`.
- **Creating a VM fails** — expected, see the top of this document.
- **The account disappeared after a deploy** — the volume is not mounted at
  `/var/lib/bonfire`; check `railway volume list`.
