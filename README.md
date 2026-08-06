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
  middleware.ts            # Basic Auth in front of every page and API route
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

`src/middleware.ts` puts HTTP Basic Auth in front of **every** page and `/api` route (only
`/_next/static`, `/_next/image`, and `/favicon.ico` are exempt). This is the app's sole
access control — every
route reads Supabase with the service_role key, so an unauthenticated request is a full read of
the monitor views.

Credentials come from `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`:

| `NODE_ENV` | Both set | Either unset |
| --- | --- | --- |
| `development` (`npm run dev`) | enforced | **open** — no setup needed locally |
| `production` (Docker, `npm start`) | enforced | **503 on every request** |

A production deploy that forgets the credentials refuses to serve rather than serving the
dashboard to the internet. If you get a blank 503 after `docker compose up`, that's this.

## Deploy — VPS + Docker

Serves `monitor.aiaccountant.com` from a container on `127.0.0.1:3000` behind nginx.

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
nano .env          # SUPABASE_SERVICE_ROLE_KEY + BASIC_AUTH_USER/PASS — all four required
chmod 600 .env

docker compose up -d --build
docker compose logs -f          # Ctrl-C once you see "Ready in ..."

# 401 = the app is up and Basic Auth is working
curl -i http://127.0.0.1:3000/
# 200 = credentials accepted
curl -i -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" http://127.0.0.1:3000/api/monitor
```

### Redeploy after a code change

```bash
git pull
docker compose up -d --build
docker image prune -f
```

### Change credentials or the Supabase key

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

### nginx

`/etc/nginx/sites-available/monitor.aiaccountant.com`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name monitor.aiaccountant.com;

    # Certbot rewrites this block to redirect to 443 and adds the TLS lines below.
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # The dashboard polls /api/monitor every 60s; a snapshot can be slow when
        # Supabase is cold.
        proxy_read_timeout 75s;

        # Upgrade/Connection are here for Next.js dev HMR; harmless in production.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable it and add TLS:

```bash
sudo ln -s /etc/nginx/sites-available/monitor.aiaccountant.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d monitor.aiaccountant.com
```

Point an A record for `monitor.aiaccountant.com` at the VPS before running certbot.

Firewall: only 80/443 need to be open. The container publishes to `127.0.0.1:3000`, not
`0.0.0.0` — publishing `"3000:3000"` instead would expose it on the public IP *and* bypass
ufw, since Docker writes its own iptables rules.

> nginx forwards the `Authorization` header upstream by default, so Basic Auth works through
> the proxy with no extra config. Don't add a second `auth_basic` in nginx — one prompt is enough.

## Not built yet (deliberately)

- Writes, alerting, user management, historical charts — all v2 per the spec.
