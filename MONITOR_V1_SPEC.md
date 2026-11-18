# AiA System Monitor v1: build brief

Rebuild this app's data layer on the new monitor functions in Supabase. Keep the stack, Docker and Traefik setup as they are.

## Decisions

| What | Why |
| --- | --- |
| Read only 3 Postgres functions via `supabase.rpc()`: `mon_health()`, `mon_journey(q)`, `mon_funnels(d_from, d_to)` | All check logic lives in Supabase, so the app never breaks when a workflow changes. One check failing shows as `broken` instead of crashing the page |
| Stop reading the old `monitor_*` views | They were built for RevenueHero, AI SDR 2.0 and the old first touch, and most stopped receiving data in Sept to early Nov |
| Bring back HTTP Basic Auth (Next.js middleware, `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` from env) | The lead journey shows names, phones and WhatsApp message text |
| No alerts, no writes in v1 | Alerts come later as a separate n8n workflow |
| Do not drop the old `monitor_*` views until this version is deployed | The current deployed app still reads them |

> **Update, 18 Nov 2026:** the Basic Auth row above no longer reflects the deployment. It was
> built, deployed, and then removed again on request the same day — the dashboard is now open to
> anyone with the URL. See "Access control" in the README.

## Data sources (all exist in project `qmaphtslnvvifkzmbrvh`, read-only)

### 1. `mon_health()` → health board
```
select * from mon_health();
-- columns: system text, check_name text, status text ('ok'|'amber'|'red'|'broken'), detail text, n numeric
```
About 25 rows, about 0.4s. Systems: Round robin, Popup, Enrichment, First touch, WhatsApp, Agent, Scheduling, Instant demo, Calls, Nurture.
Show red and broken first, then amber, then ok. `detail` is a ready-to-show sentence.

### 2. `mon_journey(q text)` → lead journey search
```
select * from mon_journey('9876543210');   -- any phone format, or an email
-- columns: at timestamptz, at_ist text, system text, step text, detail text, status text ('ok'|'fail')
```
Time-ordered timeline for one lead across router, HubSpot, popup, instant demo page events, enrichment, every WhatsApp message (with GM name), agent decisions, auto schedule checks, meetings, call recordings and nurture. About 0.3s. Empty input returns no rows.
Sanitise input before calling: keep only `[0-9A-Za-z@._+ -]`, max 80 characters.
Show `fail` rows in red.

### 3. `mon_funnels(d_from date, d_to date)` → funnels
```
select * from mon_funnels(current_date - 7, current_date);
-- columns: cohort_day date, funnel text, segment text, step_no int, step text, n bigint
```
One row per lead-created day (IST) × funnel × segment × step. About 0.5s for 30 days.
- Funnels: `Round robin`, `Popup`, `Instant demo`, `WhatsApp agent`, `Follow-ups`
- Segment: `all`, or for the agent funnels `we texted first` / `they texted first`
- Sum `n` over the selected days per funnel × segment × step_no
- Percent: share of step 1 for every funnel except `Follow-ups`, where each "Replied after X" is shown against the "X sent" step before it
- Window picker: Today, Yesterday and today, 7, 14, 30 days (default 7)
- Optional: a day-by-day table under each funnel, since rows are already per day

## Page (single `/`)
1. Header: title, one-line summary from the health rows ("2 red, 3 amber, 19 OK. Needs attention: ..."), refresh time in IST, auto-refresh every 60s for health only
2. Tiles: Red / Amber / OK / Broken counts
3. Health board table: System, Check, Status pill, Detail
4. Lead journey: search box (phone or email) + timeline table (Time IST, System, Step, Detail)
5. Funnels: window picker + one card per funnel × segment with bars, counts and %
6. Collapsed "What the statuses mean" section

Keep the existing visual style (flat, hairline borders, green/red/amber).

## API routes (server-side, service key never reaches the browser)
- `GET /api/health` → `mon_health()`
- `GET /api/journey?q=` → `mon_journey(q)`
- `GET /api/funnels?days=7` → `mon_funnels(today - days, today)` with days limited to 0..60

## Remove
Components and lib code for the old views: workflow tiles from `monitor_overview`, bucket pipelines, reds feed, batch integrity, missed reminders, coach integrity, missed transcripts, the old lead journeys. Keep `ui.tsx` helpers and `time.ts` if useful.

## Deploy
Same as today: `git pull && docker compose up -d --build` on the VPS. Add `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` to `.env`.

## Check before deploying
- Health board rows match `select * from mon_health()` run in the Supabase SQL editor
- Search `7292006771` shows about 26 steps across 8 systems
- 7-day funnel totals match `select funnel, segment, step, sum(n) from mon_funnels(current_date-7, current_date) group by 1,2,3`
- The page asks for a password
