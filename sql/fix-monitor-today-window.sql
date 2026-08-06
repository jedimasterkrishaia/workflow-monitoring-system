-- Fix: green_today / red_today were always 0 in monitor_overview and
-- monitor_bucket_overview, which rendered every Overview tile as "quiet today".
--
-- The "start of today in IST" boundary was written as:
--
--     (now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata'
--
-- The intent is right, but the middle `::date` breaks it. `AT TIME ZONE` has no
-- `date` overload, so Postgres implicitly casts the date to *timestamptz*
-- (midnight in the session zone, UTC here) and then applies the
-- `timestamptz AT TIME ZONE text -> timestamp` overload — which converts that
-- instant *into* IST wall-clock rather than converting IST midnight *out* to an
-- instant. The result is a naive `timestamp` of 05:30:00 on today's date:
--
--     broken -> 2026-08-06 05:30:00   (timestamp without time zone)
--     wanted -> 2026-08-05 18:30:00+00 (timestamp with time zone)
--
-- Compared against a timestamptz column, that naive value is read as 05:30 UTC
-- = 11:00 IST. So "today" counted nothing at all before 11:00 IST, and after
-- 11:00 IST silently dropped every event from the first five and a half hours
-- of the day.
--
-- date_trunc('day', ...) returns a `timestamp`, so `AT TIME ZONE` picks the
-- `timestamp AT TIME ZONE text -> timestamptz` overload and the round trip is
-- correct. Everything else in both views is unchanged.

CREATE OR REPLACE VIEW public.monitor_overview AS
SELECT monitor_normalize_workflow(workflow) AS workflow,
    checkpoint,
    count(*) FILTER (WHERE status = 'green'::text AND created_at >= (date_trunc('day'::text, now() AT TIME ZONE 'Asia/Kolkata'::text) AT TIME ZONE 'Asia/Kolkata'::text)) AS green_today,
    count(*) FILTER (WHERE status = 'red'::text AND created_at >= (date_trunc('day'::text, now() AT TIME ZONE 'Asia/Kolkata'::text) AT TIME ZONE 'Asia/Kolkata'::text)) AS red_today,
    count(*) FILTER (WHERE status = 'green'::text AND created_at > (now() - '7 days'::interval)) AS green_7d,
    count(*) FILTER (WHERE status = 'red'::text AND created_at > (now() - '7 days'::interval)) AS red_7d,
    max(created_at) FILTER (WHERE status = 'green'::text) AS last_green,
    max(created_at) FILTER (WHERE status = 'red'::text) AS last_red,
    round(EXTRACT(epoch FROM now() - max(created_at) FILTER (WHERE status = 'green'::text)) / 60::numeric) AS mins_since_green
   FROM monitor_checkpoints
  WHERE (phone <> ALL (ARRAY['9999999991'::text, '9999999992'::text])) AND checkpoint <> 'msg_status_update'::text
  GROUP BY (monitor_normalize_workflow(workflow)), checkpoint;

CREATE OR REPLACE VIEW public.monitor_bucket_overview AS
SELECT monitor_normalize_workflow(workflow) AS workflow,
    checkpoint,
    COALESCE(NULLIF(bucket, ''::text), '(none)'::text) AS bucket,
    count(*) FILTER (WHERE status = 'green'::text AND created_at >= (date_trunc('day'::text, now() AT TIME ZONE 'Asia/Kolkata'::text) AT TIME ZONE 'Asia/Kolkata'::text)) AS green_today,
    count(*) FILTER (WHERE status = 'red'::text AND created_at >= (date_trunc('day'::text, now() AT TIME ZONE 'Asia/Kolkata'::text) AT TIME ZONE 'Asia/Kolkata'::text)) AS red_today,
    count(*) FILTER (WHERE status = 'green'::text AND created_at > (now() - '7 days'::interval)) AS green_7d,
    count(*) FILTER (WHERE status = 'red'::text AND created_at > (now() - '7 days'::interval)) AS red_7d,
    max(created_at) FILTER (WHERE status = 'green'::text) AS last_green,
    round(EXTRACT(epoch FROM now() - max(created_at) FILTER (WHERE status = 'green'::text)) / 60::numeric) AS mins_since_green
   FROM monitor_checkpoints
  WHERE (phone <> ALL (ARRAY['9999999991'::text, '9999999992'::text])) AND checkpoint <> 'msg_status_update'::text
  GROUP BY (monitor_normalize_workflow(workflow)), checkpoint, (COALESCE(NULLIF(bucket, ''::text), '(none)'::text));

-- Sanity check after applying — both should be non-zero during an active day:
--   SELECT sum(green_today) AS g, sum(red_today) AS r FROM monitor_overview;
