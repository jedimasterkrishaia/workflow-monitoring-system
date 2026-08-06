# KoreFi Workflow Monitor — Build Spec (v1)

Build a read-only monitoring dashboard for our n8n automation pipeline. Single-page Next.js app querying Supabase views, deployed via Docker on a Hostinger VPS.

## Stack
- Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- Supabase JS client — **server-side only** (route handlers / server components). Never expose the service key to the browser.
- No auth provider — protect the whole app with HTTP Basic Auth via Next.js middleware (user/pass from env).
- Docker + docker-compose for deployment. GitHub repo, deploy by `git pull && docker compose up -d --build` on the VPS.

## Env vars (.env, never committed)
```
SUPABASE_URL=https://qmaphtslnvvifkzmbrvh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
BASIC_AUTH_USER=korefi
BASIC_AUTH_PASS=<choose>
```

## Data sources (Supabase views — all read-only, already exist)

1. **monitor_overview** — one row per workflow×checkpoint:
   `workflow, checkpoint, green_today, red_today, green_7d, red_7d, last_green, last_red, mins_since_green`
2. **monitor_reds_feed** — latest 100 failures:
   `id, workflow, checkpoint, bucket, phone, hubspot_deal_id, detail, execution_url, created_at`
3. **monitor_lead_journey** — one row per lead phone, ~30 status columns:
   - identity: `phone`, `last_activity`, `red_details`, `hard_error`
   - booking: `rh_received, rh_insert`
   - first touch: `ft_rh_lookup, ft_um_insert, ft_wa_send, ft_template_stamp, ft_conv_log, ft_deal_stage`
   - ai sdr: `sdr_inbound, sdr_deal_lookup, sdr_parse, sdr_outbound, sdr_out_logged, sdr_stage, sdr_confirmed, sdr_cancelled, sdr_resched_link, sdr_sched_called, sdr_noshow_fwd, sdr_noshow_marked, sdr_gm_notified`
   - scheduler: `sch_payload, sch_calendar, sch_supa, sch_wa_confirm, sch_conv_log, sch_gm_notified, sch_deal_stage`
   - Column values: `'green'`, `'red'`, or `null` (= never reached).
4. **monitor_bucket_overview** — same shape as monitor_overview plus a `bucket` column (checkpoint sub-paths: for ai_sdr the lead buckets DB/TNB/P1/Cold; for confirm_dispatch/reminder_dispatch touchpoint names like wa_first_check, wa_second_check, call_first, reminder_t30, reminder_t10_wa, reminder_morning_928; for welcome_email the brand aia/va; `(none)` where not applicable). The same checkpoint can span several buckets — a checkpoint is only fully healthy if all its buckets are.
5. **monitor_gm_slots** — per-GM calendar-slot freshness:
   `gm_name (or similar), freshness fields, slot counts, all_free_warn` — introspect columns with a `select * limit 1` before building; treat `all_free_warn=true` as a warning state.

Workflows currently reporting: `rh_meetings`, `first_touch`, `ai_sdr`, `scheduler`, `confirm_dispatch`, `reminder_dispatch`, `welcome_email` (newer ones may have zero rows at first — render tiles anyway, show "no data yet"). Don't hardcode this list as exhaustive: derive tiles from DISTINCT workflow values in monitor_overview so future workflows appear automatically, using the order above for known ones. `hard_error` checkpoint rows can appear under any workflow name (e.g. "AI SDR 2.0").

## Page layout (single page `/`)

Header: "Pipeline health" + last-refreshed timestamp (IST) + auto-refresh every 60s (server data revalidate or client polling — keep it simple).

**Section 1 — Workflow tiles.** One tile per workflow: aggregate green_today/red_today across its checkpoints, worst-case coloring (any red_today>0 → red tile; else all green). Show `X/Y` (greens/total today) + mins since most recent green across the workflow ("33m ago"). Order: rh_meetings, first_touch, ai_sdr, scheduler, confirm_dispatch, reminder_dispatch. Append GM-slot tiles or a compact GM strip from monitor_gm_slots (stale >5min = red, all_free_warn = amber).

**Section 2 — Checkpoint chips.** Grid of small chips, one per workflow×checkpoint from monitor_overview: name + `N ✓` (+ `M ✗` red-styled when red_today>0). Group by workflow. Each chip whose checkpoint has more than one bucket in monitor_bucket_overview is expandable (click) to show the per-bucket rows — e.g. confirm_send → wa_first_check 63 ✓ / wa_second_check 49 ✓ / wa_third_check 25 ✓ / wa_sameday_first 5 ✓ — each with its own green/red counts and freshness. If any single bucket has reds or is stale while others are green, tint the parent chip amber (partial failure), red only when reds dominate. This matters because different lead paths hit different buckets: an all-green aggregate can hide one dead bucket.

**Section 3 — Needs attention.** List from monitor_reds_feed (top 20): red dot, `workflow · checkpoint — detail`, relative time, phone if present, and an "execution ↗" link to `execution_url` (opens n8n). If hard_error rows exist in the last 24h, pin them at top with a distinct style.

**Section 4 — Lead journeys.** Table from monitor_lead_journey ordered by last_activity desc, ~50 rows, with a phone search box. One row per lead: phone (mono font), then status dots grouped under phase headers (Booking | First touch | AI SDR | Scheduler). Dot = 9px circle: green fill, red fill, faint gray outline for null. Hovering a red dot shows the matching snippet from red_details (title attr is fine for v1). Row click → expandable detail showing full red_details + last_activity.

## Visual style
Clean, flat, minimal — white/neutral surfaces, hairline borders, no gradients or shadows. Dark-mode friendly if cheap (Tailwind dark: classes), otherwise light-only is fine for v1. Green `#1D9E75`-ish, red `#E24B4A`-ish, amber for warnings. Compact density — this is an ops screen.

## Docker / deploy
- Multi-stage Dockerfile (node:20-alpine build → standalone output → runner). `output: 'standalone'` in next.config.
- docker-compose.yml: app on port 3000, `restart: unless-stopped`, env_file `.env`.
- On VPS: reverse-proxied by existing nginx/caddy or exposed on a port; assume nginx may already exist for n8n — provide a sample nginx server block for `monitor.aiaccountant.com` → localhost:3000 with the app's Basic Auth handling access (no nginx auth needed).
- README with: local dev, build, deploy steps.

## Non-goals for v1
No writes, no alerting, no user management, no historical charts (v2). Don't query monitor_checkpoints directly — views only.