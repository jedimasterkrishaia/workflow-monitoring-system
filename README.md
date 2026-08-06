# KoreFi Workflow Monitor

Read-only ops dashboard for the KoreFi n8n automation pipeline. Single page, four sections,
auto-refreshing every 60 seconds, backed entirely by read-only Supabase views.

Built per [`MONITOR_DASHBOARD_SPEC.md`](./MONITOR_DASHBOARD_SPEC.md).

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS v4
- `@supabase/supabase-js`, **server-side only** — the service role key never reaches the browser

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

The app boots and renders even with no credentials — you'll see a warning banner and empty
sections until Supabase is configured.

## Supabase credentials — you need to fill these in

`.env.local` already exists with the project URL from the spec and a placeholder key:

```
SUPABASE_URL=https://qmaphtslnvvifkzmbrvh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_ME_service_role_key
```

Replace `REPLACE_ME_service_role_key` with the **service_role** key from
Supabase dashboard → Project Settings → API → Project API keys, then restart `npm run dev`
(Next.js reads env files at startup).

The banner at the top of the page disappears once both values are real.

> The service role key bypasses row-level security. It is only ever read in server code
> (`src/lib/supabase.ts` is marked `server-only`), and `.env.local` is gitignored.

## What it shows

| Section | Source view | Notes |
| --- | --- | --- |
| Workflow tiles | `monitor_overview` (+ `monitor_gm_slots`) | Aggregated per workflow, worst-case coloured: any red today → red tile. Tiles are derived from `DISTINCT workflow`, so new workflows appear automatically. GM strip: stale >5 min = red, `all_free_warn` = amber. |
| Checkpoint chips | `monitor_overview` + `monitor_bucket_overview` | One chip per workflow×checkpoint. Chips whose checkpoint spans multiple buckets are clickable and expand to per-bucket counts and freshness. |
| Needs attention | `monitor_reds_feed` | Top 20 failures; `hard_error` rows from the last 24 h are pinned on top with a distinct style. Each row links to the n8n execution. |
| Lead journeys | `monitor_lead_journey` | ~50 most recent leads, dots grouped under Booking / First touch / AI SDR / Scheduler. Hover a red dot for the matching `red_details` snippet; click a row for the full detail. |

### Chip colour rules

- **Red** — the checkpoint has reds today, or reds dominate its buckets (≥ half).
- **Amber** — a minority of buckets are red or stale while the rest are green (partial failure —
  this is the case an all-green aggregate would otherwise hide).
- **Green** — greens today, nothing red or stale.
- **Grey** — no data yet.

"Stale" for checkpoints/buckets is `mins_since_green > 120`, defined as `STALE_MINUTES` in
`src/lib/aggregate.ts` — the spec pins a threshold only for GM slots (5 min), so tune this one
against real traffic.

### Phone search

The search box queries Supabase server-side (`ilike` on digits), so it finds leads beyond the 50
rows currently displayed.

## Project layout

```
src/
  app/
    api/monitor/route.ts   # single JSON snapshot endpoint, polled every 60s
    page.tsx               # server component: first snapshot, then hands off to the client
    layout.tsx, globals.css
  components/
    Dashboard.tsx          # client shell: polling, search, refresh clock
    WorkflowTiles.tsx  GmStrip.tsx  CheckpointChips.tsx  RedsFeed.tsx  LeadJourneys.tsx
    ui.tsx                 # StatusDot, status colour helpers, section chrome
  lib/
    supabase.ts            # server-only client (returns null on placeholder creds)
    data.ts                # reads all five views; per-view error isolation
    aggregate.ts           # tile + chip roll-ups (pure, shared with the client)
    journey.ts             # phase/column map, red_details parsing
    gm.ts                  # normalises monitor_gm_slots by shape, not a fixed schema
    time.ts                # IST formatting, relative times
```

`monitor_gm_slots` column names weren't pinned down in the spec, so `gm.ts` detects the name,
freshness, and count columns by shape. Once you can run `select * from monitor_gm_slots limit 1`,
swap the heuristics for the real column names.

## Scripts

```bash
npm run dev        # dev server on :3000
npm run build      # production build
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
```

## Access control

**There is none.** Every page and every `/api` route reads Supabase with the service_role key
(bypasses RLS), and nothing sits in front of them — anyone with the URL gets a full read of the
monitor views. This was a deliberate choice for this deployment; there is no Basic Auth, no
IP allowlist, nothing. Don't link to it from anywhere public, and treat the URL itself as the
only thing keeping it private.

## Deploy — VPS + Docker

Serves `monitor.187.127.173.25.sslip.io` from a container behind the VPS's existing Traefik.
The container publishes **no host port** — Traefik reaches it on port 3000 over a shared
Docker network and terminates TLS.

### Hostname: sslip.io, no DNS setup

`sslip.io` is a public wildcard resolver: `<anything>.<ip>.sslip.io` resolves to `<ip>`. So
`monitor.187.127.173.25.sslip.io` already points at the VPS with nothing to configure, and
Let's Encrypt's HTTP-01 challenge validates against it like any other public name — you get a
real cert, not a self-signed one.

Trade-off: the hostname carries the server's IP, so it changes if the VPS moves, and the name
isn't yours. Swap `MONITOR_DOMAIN` in `.env` for a real domain (A record first) when one is
available — nothing else needs to change.

### What's in the image

Multi-stage `Dockerfile` on `node:20-alpine`: `deps` (`npm ci`) → `builder` (`npm run build`,
which emits `.next/standalone` thanks to `output: 'standalone'` in `next.config.ts`) → `runner`,
which carries only `standalone/` + `.next/static` and runs `node server.js` as a non-root user.
`.dockerignore` keeps `node_modules`, `.next`, and **all `.env*` files** out of the build
context — secrets reach the container only through `env_file`, never through a layer.

### First deploy

```bash
# on the VPS
git clone <repo-url> workflow-monitoring
cd workflow-monitoring

cp .env.example .env
nano .env          # SUPABASE_SERVICE_ROLE_KEY required
                   # MONITOR_DOMAIN already defaults to this VPS's sslip.io name;
                   # check the three TRAEFIK_* values against the running Traefik
chmod 600 .env

docker compose up -d --build
docker compose logs -f          # Ctrl-C once you see "Ready in ..."

# 200 = the app is up and Traefik is routing (no auth in front of it — see
# "Access control" above)
curl -i https://monitor.187.127.173.25.sslip.io/
curl -i https://monitor.187.127.173.25.sslip.io/api/monitor

# Bypass Traefik to isolate app-vs-proxy problems
docker compose exec monitor node -e "fetch('http://127.0.0.1:3000/').then(r=>console.log(r.status))"
```

### Redeploy after a code change

```bash
git pull
docker compose up -d --build
docker image prune -f
```

### Change the Supabase key

```bash
nano .env
docker compose up -d           # recreates the container; no rebuild needed
```

`env_file` values are read at container start, so editing `.env` alone changes nothing —
`docker compose restart` also re-reads it, but `up -d` is the safe habit.

### Useful

```bash
docker compose ps              # STATUS shows the healthcheck result
docker compose logs --tail=100
docker compose down            # stop and remove
```

### Traefik

Routing lives entirely in the `labels:` block of `docker-compose.yml` — nothing to add on the
Traefik side, as long as its Docker provider is watching the daemon (`providers.docker` in the
static config). Two routers are declared: `monitor` on the HTTPS entrypoint with a cert
resolver, and `monitor-http` on the HTTP entrypoint redirecting to it.

This VPS's Traefik (`/docker/traefik/docker-compose.yml`) runs with `network_mode: host` and
the Docker-socket provider (`--providers.docker`, `exposedbydefault=false`) — it binds 80/443
directly on the host and reaches every container's IP over the Docker bridge network itself.
That means **no shared docker network between this compose file and Traefik is needed at all**
— unlike the common pattern of joining an `external: true` network, which this install doesn't
use. (If the monitor container ever gets attached to a second network, add a
`traefik.docker.network=<name>` label to disambiguate — see the comment above the labels block
in `docker-compose.yml`.)

The three values that must match your Traefik install, all set in `.env`:

| Variable | Default | Where to check |
| --- | --- | --- |
| `TRAEFIK_HTTP_ENTRYPOINT` | `web` | Traefik's `--entrypoints.*.address` flags / `entryPoints:` in static config |
| `TRAEFIK_HTTPS_ENTRYPOINT` | `websecure` | same |
| `TRAEFIK_CERTRESOLVER` | `letsencrypt` | `--certificatesresolvers.*` flags / `certificatesResolvers:` in static config |

Get one wrong and the symptom is a Traefik 404 (or its self-signed default cert) rather than an
error at `up` time — the labels are just strings to Docker. Check with:

```bash
docker compose ps                          # confirm the monitor container is actually up
docker logs traefik-traefik-1 --tail 50    # Traefik's own logs
curl -sk -D - -o /dev/null https://<MONITOR_DOMAIN>/   # 404 + "TRAEFIK DEFAULT CERT" = no router matched
```

With the sslip.io default there is no DNS step — the name already resolves to the VPS, so the
ACME challenge can succeed on the first `up`. (If you switch `MONITOR_DOMAIN` to a real domain,
point its A record at the VPS **before** the first `up`, or the challenge fails and Traefik
serves its default self-signed cert until the next retry.)

Firewall: only 80/443 need to be open, and only Traefik binds them. This compose file publishes
no host port at all — adding `"3000:3000"` would expose the app on the public IP *and* bypass
ufw, since Docker writes its own iptables rules.

## Not built yet (deliberately)

- Writes, alerting, user management, historical charts — all v2 per the spec.
