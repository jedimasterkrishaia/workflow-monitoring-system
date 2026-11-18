# AiA System Monitor

Read-only ops dashboard for the AiA lead pipeline. One page behind HTTP Basic Auth, backed by
three Postgres functions in Supabase project `qmaphtslnvvifkzmbrvh`.

Built per [`MONITOR_V1_SPEC.md`](./MONITOR_V1_SPEC.md).

## What it shows

1. **Header** — a one-line summary of the health rows ("4 red, 4 amber, 17 OK. Needs attention:
   …") and the last refresh time in IST. Health re-fetches every 60s.
2. **Tiles** — Red / Amber / OK / Broken counts.
3. **Health board** — ~25 checks across Round robin, Popup, Enrichment, First touch, WhatsApp,
   Agent, Scheduling, Instant demo, Calls and Nurture. Red and broken sort first, then amber,
   then ok. The `detail` sentence comes from the database as-is.
4. **Lead journey** — search a phone (any format) or an email for that lead's timeline across
   router, HubSpot, popup, instant demo, enrichment, every WhatsApp message, agent decisions,
   auto-schedule checks, meetings, call recordings and nurture. Failed steps render red.
5. **Funnels** — Round robin, Popup, Instant demo, WhatsApp agent and Follow-ups, one card per
   funnel × segment, over a Today / Yesterday+today / 7 / 14 / 30-day window (default 7), with
   an optional day-by-day table per card.
6. **"What the statuses mean"** — collapsed legend.

## Where the data comes from

Three functions, nothing else — all the check logic lives in Supabase, so a workflow changing
shape cannot break this app:

| Function | Used by |
| --- | --- |
| `mon_health()` | health board, tiles, header summary |
| `mon_journey(q text)` | lead journey search |
| `mon_funnels(d_from date, d_to date)` | funnels |

Reads go through `src/lib/data.ts` (server-only) via `supabase.rpc()`. The service role key
never reaches the browser. API routes:

- `GET /api/health`
- `GET /api/journey?q=` — `q` is sanitised to `[0-9A-Za-z@._+ -]`, max 80 chars
- `GET /api/funnels?days=7` — `days` clamped to 0..60

PostgREST truncates any single response at 1000 rows silently, so `getFunnels` fetches wide
windows in 10-day chunks and sums them (a single 30-day call came back cut to 25 days). The
payload carries `truncated: true` if a request ever lands on that ceiling again.

The old `monitor_*` views are no longer read by anything here. They are deliberately **not
dropped** — check nothing else depends on them first.

## Environment

Copy `.env.example` to `.env.local` (dev) or `.env` (Docker). All five are required:

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | `https://qmaphtslnvvifkzmbrvh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key for that project; server-side only |
| `BASIC_AUTH_USER` | login for the whole app |
| `BASIC_AUTH_PASS` | `openssl rand -base64 24` |
| `MONITOR_DOMAIN`, `TRAEFIK_*` | routing only — see the comments in `.env.example` |

`src/middleware.ts` puts Basic Auth in front of the page *and* the API routes, because the lead
journey shows names, phone numbers and WhatsApp message text. With either `BASIC_AUTH_*` value
missing the app answers **503** rather than serving lead data unauthenticated.

## Stack and layout

Next.js 15 (App Router) + TypeScript + Tailwind v4, `@supabase/supabase-js` server-side only.

```
src/middleware.ts        HTTP Basic Auth over everything
src/app/page.tsx         server-renders health + the 7-day funnels
src/app/api/*/route.ts   health, journey, funnels
src/lib/data.ts          the three rpc() calls — the only Supabase access
src/lib/monitor.ts       types + pure helpers: ordering, summary, percent rules, IST windows
src/lib/time.ts          the IST refresh stamp
src/components/          Monitor (poll + layout), HealthBoard, LeadJourney, Funnels, ui
```

Percentages are computed in `src/lib/monitor.ts`, not in the UI: each step is a share of the
step before it plus a share of step 1, except Follow-ups (step 1 is a plain count, replies are a
share of the send above them, sends carry none) and Popup's "Tapped self setup" (a share of
"Saw popup", since it is the other branch out of the popup).

## Scripts

```bash
npm install
npm run dev         # http://localhost:3000
npm run typecheck
npm run build
npm run start
```

## Deploy — VPS + Docker

Serves `MONITOR_DOMAIN` from a container behind the VPS's existing Traefik, which terminates
TLS and reaches the app on port 3000 over the Docker bridge network. The container publishes no
host port; routing lives entirely in the `labels:` block of `docker-compose.yml`. The default
`MONITOR_DOMAIN` uses `sslip.io` (`<anything>.<ip>.sslip.io` resolves to `<ip>`), so a fresh VPS
needs no DNS records for the ACME HTTP-01 challenge to pass — swap in a real domain (A record
first) when there is one.

### First deploy

```bash
# on the VPS
git clone <repo-url> workflow-monitoring
cd workflow-monitoring

cp .env.example .env
nano .env          # SUPABASE_SERVICE_ROLE_KEY, BASIC_AUTH_USER, BASIC_AUTH_PASS required;
                   # check MONITOR_DOMAIN and the three TRAEFIK_* values
chmod 600 .env

docker compose up -d --build
docker compose logs -f          # Ctrl-C once you see "Ready in ..."

# 401 without credentials is correct; 200 with them means the app and Traefik are both fine
curl -i https://$MONITOR_DOMAIN/
curl -i -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" https://$MONITOR_DOMAIN/api/health

# Bypass Traefik to isolate app-vs-proxy problems
docker compose exec monitor node -e "fetch('http://127.0.0.1:3000/').then(r=>console.log(r.status))"
```

### Redeploy after a code change

```bash
git pull && docker compose up -d --build
docker image prune -f
```

### Change a credential

```bash
nano .env
docker compose up -d           # recreates the container; no rebuild needed
```

`env_file` values are read at container start, so editing `.env` alone changes nothing.

### Useful

```bash
docker compose ps              # STATUS shows the healthcheck result
docker compose logs --tail=100
docker compose down
```

The healthcheck fetches `/` and only fails on 5xx, so the 401 an unauthenticated request gets
still counts as healthy — a 503 (missing `BASIC_AUTH_*`) does not.

## Not built yet (deliberately)

- **Alerts.** v1 only displays. Alerting is planned as a separate n8n workflow reading the same
  `mon_health()` rows.
- **Writes.** Every path here is read-only; nothing in the app mutates the database.
