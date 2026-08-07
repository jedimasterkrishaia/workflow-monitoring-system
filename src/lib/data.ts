import 'server-only'

import { STALL_HOURS, TERMINAL_STAGES } from '@/lib/journey'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { toIstNaive } from '@/lib/time'
import {
  DEFAULT_LEAD_PARAMS,
  type BatchIntegrityRow,
  type BucketRow,
  type CoachIntegrityRow,
  type GmSlotRow,
  type LeadEventRow,
  type LeadEventsPayload,
  type LeadListParams,
  type LeadRow,
  type LeadsPage,
  type MissedReminderRow,
  type MissedTranscriptRow,
  type MonitorPayload,
  type OverviewRow,
  type RedRow,
  type RedsPage,
} from '@/lib/types'

/** The lead tab pages like the flag log; every filter is resolved server-side. */
export const LEAD_PAGE_SIZE = 50

/** The flag log pages instead of loading in one shot (spec §Flag logs). */
export const REDS_PAGE_SIZE = 50

/** Pinned hard errors are a short list by nature; this is a sanity bound. */
export const HARD_ERROR_LIMIT = 50

/** Events for one expanded lead — a full journey, not a page of it. */
export const LEAD_EVENT_LIMIT = 300

/** Dead batches are rare by nature; this is a sanity bound, not a page size. */
export const DEAD_BATCH_LIMIT = 50

/**
 * Missed reminders are fetched as raw rows and grouped by lead in the browser,
 * so this bound has to sit well above the 20 *leads* the panel shows — one lead
 * can miss its whole four-rung ladder.
 */
export const MISSED_REMINDER_LIMIT = 200

/**
 * How far back the dead-batch panel looks.
 *
 * Matched as a prefix rather than an equality test: the verdict reads
 * "LOOP DIED — batch never completed", and pinning that exact string would make
 * the panel silently render nothing if the view's dash or trailing wording ever
 * drifted. Silence is the one failure mode a "broken batches" panel must not
 * have, and anything else starting "LOOP DIED" is a dead batch too.
 */
const DEAD_BATCH_VERDICT_PREFIX = 'LOOP DIED'
const DEAD_BATCH_HOURS = 48

/**
 * monitor_coach_integrity carries the same silent-failure shape as batch
 * integrity — a run that finished without stamping every required step —
 * matched as a prefix for the same reason (see DEAD_BATCH_VERDICT_PREFIX).
 */
const INCOMPLETE_VERDICT_PREFIX = 'INCOMPLETE'

/**
 * monitor_missed_transcripts carries other verdicts too (`outcome_unmarked`
 * and onward as the view grows) — the panel is specifically about a transcript
 * that never arrived, so it is an equality filter, not a catch-all.
 */
const MISSING_TRANSCRIPT_VERDICT = 'missing_transcript'

/** Leads shown in the missed-transcript panel; a cap on an already-narrow list. */
export const MISSED_TRANSCRIPT_LIMIT = 20

const DAY_MS = 24 * 60 * 60 * 1000

const EMPTY: Omit<MonitorPayload, 'generatedAt' | 'configured' | 'errors'> = {
  overview: [],
  buckets: [],
  reds: [],
  redsHasMore: false,
  hardErrors: [],
  redsLast24h: 0,
  deadBatches: [],
  missedReminders: [],
  brokenCoach: [],
  missedTranscripts: [],
  leads: [],
  leadsTotal: 0,
  leadsHasMore: false,
  leadPipelines: [],
  gmSlots: [],
}

type Fetched<T> = { rows: T[]; error: string | null }

async function safeSelect<T>(
  label: string,
  run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Fetched<T>> {
  try {
    const { data, error } = await run()
    if (error) return { rows: [], error: `${label}: ${error.message}` }
    return { rows: (data ?? []) as T[], error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { rows: [], error: `${label}: ${message}` }
  }
}

/**
 * PostgREST parses `or=(...)` as a comma/paren separated list, so those
 * characters have to leave the needle before it is interpolated.
 */
function sanitizeNeedle(value: string): string {
  return value.replace(/[,()"'\\%]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * One page of the flag log.
 *
 * monitor_reds_feed is the source rather than the monitor_checkpoints base
 * table on purpose: the view is the base reds minus `msg_status_update`, which
 * outnumbers real failures ~40:1 and would bury the feed. The view itself is
 * not capped, so plain range paging over it is complete.
 *
 * Asks for one row past the page to learn whether more exist, which is far
 * cheaper than an exact count on every poll.
 */
export async function getRedsPage(offset = 0, limit = REDS_PAGE_SIZE): Promise<RedsPage> {
  if (!isSupabaseConfigured()) return { reds: [], hasMore: false, error: null }
  const supabase = getSupabase()
  if (!supabase) return { reds: [], hasMore: false, error: null }

  const from = Math.max(0, offset)
  const { rows, error } = await safeSelect<RedRow>('monitor_reds_feed', () =>
    supabase
      .from('monitor_reds_feed')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + limit),
  )

  return { reds: rows.slice(0, limit), hasMore: rows.length > limit, error }
}

/**
 * A PostgREST filter as (method, arguments), so one list can be replayed onto
 * both the row query and the count query. If those two ever drifted, "50 of N"
 * would be quoting a number the list does not actually contain.
 */
type LeadFilter =
  | { kind: 'or'; expr: string }
  | { kind: 'gte' | 'lt' | 'eq'; column: string; value: string }
  | { kind: 'isNull'; column: string }

const RANGE_DAYS: Record<LeadListParams['range'], number | null> = { '7d': 7, '30d': 30, all: null }

/**
 * `current_stage NOT IN (terminal)` is wrong twice over in SQL: the CRM cases
 * its stages however it likes, and a NULL stage makes the comparison NULL,
 * which silently drops those rows. Hence ilike, and hence the explicit null arm.
 */
const NOT_TERMINAL_STAGE = [
  'current_stage.is.null',
  `and(${TERMINAL_STAGES.map((stage) => `current_stage.not.ilike."${stage}"`).join(',')})`,
].join(',')

/** A lead is an issue when either signal is present; '{}' noise is filtered client-side. */
const IS_ISSUE = 'hard_error.not.is.null,red_details.not.is.null'

/**
 * The filters behind one lead query. Pure and exported so the predicates can be
 * checked without a database.
 */
export function leadFilters(params: LeadListParams, nowMs = Date.now()): LeadFilter[] {
  const filters: LeadFilter[] = []

  const needle = sanitizeNeedle(params.q ?? '')
  if (needle) {
    // Phones are stored bare, so a typed "+91 98…" has to lose its formatting.
    const digits = needle.replace(/\D/g, '')
    const clauses = [`lead_name.ilike.%${needle}%`]
    if (digits) clauses.push(`phone.ilike.%${digits}%`)
    filters.push({ kind: 'or', expr: clauses.join(',') })
  }

  const days = RANGE_DAYS[params.range] ?? null
  if (days !== null) {
    filters.push({
      kind: 'gte',
      column: 'last_activity',
      value: new Date(nowMs - days * DAY_MS).toISOString(),
    })
  }

  if (params.pipeline) filters.push({ kind: 'eq', column: 'pipeline', value: params.pipeline })

  // These mirror leadHealth() in lib/journey.ts — see the note on getLeadsPage.
  if (params.health === 'issue') {
    filters.push({ kind: 'or', expr: IS_ISSUE })
  } else if (params.health === 'stalled') {
    filters.push({
      kind: 'lt',
      column: 'last_activity',
      value: new Date(nowMs - STALL_HOURS * 60 * 60 * 1000).toISOString(),
    })
    filters.push({ kind: 'or', expr: NOT_TERMINAL_STAGE })
    // leadHealth checks for an issue first, so an issue is never also stalled.
    filters.push({ kind: 'isNull', column: 'hard_error' })
    filters.push({ kind: 'isNull', column: 'red_details' })
  }

  return filters
}

/** The slice of the PostgREST builder these filters need. Every method chains. */
type LeadQueryBuilder = {
  or(expr: string): LeadQueryBuilder
  is(column: string, value: null): LeadQueryBuilder
  gte(column: string, value: string): LeadQueryBuilder
  lt(column: string, value: string): LeadQueryBuilder
  eq(column: string, value: string): LeadQueryBuilder
}

/**
 * Replays a filter list onto a query builder — rows and count alike.
 *
 * Q is deliberately unconstrained. Every method here returns `this` at runtime,
 * but expressing that against PostgrestFilterBuilder's seven generics makes tsc
 * give up with "type instantiation is excessively deep". The builder shape is
 * pinned by LeadQueryBuilder instead, and Q passes through untouched, so the
 * call sites keep their real types.
 */
function applyLeadFilters<Q>(query: Q, filters: LeadFilter[]): Q {
  let q = query as unknown as LeadQueryBuilder
  for (const filter of filters) {
    switch (filter.kind) {
      case 'or':
        q = q.or(filter.expr)
        break
      case 'isNull':
        q = q.is(filter.column, null)
        break
      case 'gte':
        q = q.gte(filter.column, filter.value)
        break
      case 'lt':
        q = q.lt(filter.column, filter.value)
        break
      case 'eq':
        q = q.eq(filter.column, filter.value)
        break
    }
  }
  return q as unknown as Q
}

const LEAD_VIEW = 'monitor_lead_journey_enriched'

/**
 * The N in "50 of N" — an exact count over the same filters, taken with
 * head:true so PostgREST counts without shipping a single row back.
 */
async function leadCount(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  filters: LeadFilter[],
): Promise<{ total: number | null; error: string | null }> {
  const label = `${LEAD_VIEW} (count)`
  try {
    const { count, error } = await applyLeadFilters(
      supabase.from(LEAD_VIEW).select('phone', { count: 'exact', head: true }),
      filters,
    )
    if (error) return { total: null, error: `${label}: ${error.message}` }
    return { total: count ?? null, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { total: null, error: `${label}: ${message}` }
  }
}

/**
 * One page of the lead list, plus the total behind it.
 *
 * Every filter runs here rather than in the browser. Health is the reason why:
 * "stalled" means no activity for 24h, so stalled leads sort to the *bottom* of
 * a last_activity ordering — filtering the loaded page would have shown an
 * empty list while hundreds of stalled leads sat on later pages.
 *
 * The health predicates restate leadHealth() in PostgREST terms. They are
 * verified against it rather than assumed: see the note in getMonitorPayload.
 */
export async function getLeadsPage(
  params: Partial<LeadListParams> = {},
  offset = 0,
  limit = LEAD_PAGE_SIZE,
): Promise<LeadsPage> {
  const empty: LeadsPage = { leads: [], total: 0, hasMore: false, error: null }
  if (!isSupabaseConfigured()) return empty
  const supabase = getSupabase()
  if (!supabase) return empty

  const resolved: LeadListParams = { ...DEFAULT_LEAD_PARAMS, ...params }
  const filters = leadFilters(resolved)
  const from = Math.max(0, offset)

  const [page, count] = await Promise.all([
    safeSelect<LeadRow>(LEAD_VIEW, () =>
      applyLeadFilters(supabase.from(LEAD_VIEW).select('*'), filters)
        .order('last_activity', { ascending: false, nullsFirst: false })
        // Ties would otherwise let a row slip between pages as offsets advance.
        .order('phone', { ascending: true })
        .range(from, from + limit),
    ),
    leadCount(supabase, filters),
  ])

  return {
    leads: page.rows.slice(0, limit),
    total: count.total,
    // One row past the page, like the flag log — reliable even if the count failed.
    hasMore: page.rows.length > limit,
    error: page.error ?? count.error,
  }
}

/**
 * Reads every view the dashboard needs in one pass. Views are queried
 * independently so a single broken/renamed view degrades one tab instead of
 * blanking the page.
 *
 * @param leadParams the lead tab's filters. All of them resolve server-side, so
 *                   searching or filtering reaches the whole view rather than
 *                   the rows currently on screen.
 */
export async function getMonitorPayload(
  leadParams: Partial<LeadListParams> = {},
): Promise<MonitorPayload> {
  const generatedAt = new Date().toISOString()

  if (!isSupabaseConfigured()) {
    return { generatedAt, configured: false, errors: [], ...EMPTY }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return { generatedAt, configured: false, errors: [], ...EMPTY }
  }

  const since24h = new Date(Date.now() - DAY_MS).toISOString()

  const [
    overview,
    buckets,
    reds,
    hardErrors,
    recent24h,
    deadBatches,
    missedReminders,
    brokenCoach,
    missedTranscripts,
    leads,
    pipelines,
    gmSlots,
  ] = await Promise.all([
    safeSelect<OverviewRow>('monitor_overview', () =>
      supabase.from('monitor_overview').select('*'),
    ),
    safeSelect<BucketRow>('monitor_bucket_overview', () =>
      supabase.from('monitor_bucket_overview').select('*'),
    ),
    getRedsPage(0),
    // Pinned separately so a burst of ordinary reds can never push them off page 1.
    safeSelect<RedRow>('monitor_reds_feed (hard errors)', () =>
      supabase
        .from('monitor_reds_feed')
        .select('*')
        .eq('checkpoint', 'hard_error')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(HARD_ERROR_LIMIT),
    ),
    // Only the id, so the tab badge costs one narrow scan rather than a page of rows.
    safeSelect<{ id: string | number }>('monitor_reds_feed (24h)', () =>
      supabase.from('monitor_reds_feed').select('id').gte('created_at', since24h).limit(1000),
    ),
    // batch_started_ist has no zone, so the cutoff is expressed in IST wall
    // clock too — an ISO/UTC bound would be off by 5h30m in the wrong direction.
    safeSelect<BatchIntegrityRow>('monitor_batch_integrity', () =>
      supabase
        .from('monitor_batch_integrity')
        .select('*')
        .ilike('verdict', `${DEAD_BATCH_VERDICT_PREFIX}%`)
        .gte('batch_started_ist', toIstNaive(Date.now() - DEAD_BATCH_HOURS * 60 * 60 * 1000))
        .order('batch_started_ist', { ascending: false, nullsFirst: false })
        .limit(DEAD_BATCH_LIMIT),
    ),
    safeSelect<MissedReminderRow>('monitor_missed_reminders', () =>
      supabase
        .from('monitor_missed_reminders')
        .select('*')
        .order('due_ist', { ascending: false, nullsFirst: false })
        .limit(MISSED_REMINDER_LIMIT),
    ),
    // started_ist is naive IST too — same cutoff shape as deadBatches above.
    safeSelect<CoachIntegrityRow>('monitor_coach_integrity', () =>
      supabase
        .from('monitor_coach_integrity')
        .select('*')
        .ilike('verdict', `${INCOMPLETE_VERDICT_PREFIX}%`)
        .gte('started_ist', toIstNaive(Date.now() - DEAD_BATCH_HOURS * 60 * 60 * 1000))
        .order('started_ist', { ascending: false, nullsFirst: false })
        .limit(DEAD_BATCH_LIMIT),
    ),
    safeSelect<MissedTranscriptRow>('monitor_missed_transcripts', () =>
      supabase
        .from('monitor_missed_transcripts')
        .select('*')
        .eq('verdict', MISSING_TRANSCRIPT_VERDICT)
        .order('hours_since_demo', { ascending: false, nullsFirst: false })
        .limit(MISSED_TRANSCRIPT_LIMIT),
    ),
    getLeadsPage(leadParams, 0),
    // Unfiltered, so the dropdown still offers every pipeline once one is picked.
    safeSelect<{ pipeline: string | null }>(`${LEAD_VIEW} (pipelines)`, () =>
      supabase.from(LEAD_VIEW).select('pipeline').limit(2000),
    ),
    safeSelect<GmSlotRow>('monitor_gm_slots', () =>
      supabase.from('monitor_gm_slots').select('*').limit(100),
    ),
  ])

  return {
    generatedAt,
    configured: true,
    errors: [
      overview.error,
      buckets.error,
      reds.error,
      hardErrors.error,
      recent24h.error,
      deadBatches.error,
      missedReminders.error,
      brokenCoach.error,
      missedTranscripts.error,
      leads.error,
      pipelines.error,
      gmSlots.error,
    ].filter((e): e is string => Boolean(e)),
    overview: overview.rows,
    buckets: buckets.rows,
    reds: reds.reds,
    redsHasMore: reds.hasMore,
    hardErrors: hardErrors.rows,
    redsLast24h: recent24h.rows.length,
    deadBatches: deadBatches.rows,
    missedReminders: missedReminders.rows,
    brokenCoach: brokenCoach.rows,
    missedTranscripts: missedTranscripts.rows,
    leads: leads.leads,
    leadsTotal: leads.total,
    leadsHasMore: leads.hasMore,
    leadPipelines: [
      ...new Set(
        pipelines.rows
          .map((row) => (typeof row.pipeline === 'string' ? row.pipeline.trim() : ''))
          .filter((name) => name !== '' && name.toLowerCase() !== 'null'),
      ),
    ].sort(),
    gmSlots: gmSlots.rows,
  }
}

/**
 * The event timeline behind one lead row, oldest first so it reads top-down.
 *
 * Kept out of getMonitorPayload deliberately: 300 leads' worth of events is far
 * more than the snapshot needs, and only the expanded row ever wants them.
 */
export async function getLeadEvents(phone: string): Promise<LeadEventsPayload> {
  const trimmed = phone.trim()
  if (!trimmed) return { events: [], configured: true, error: null }

  if (!isSupabaseConfigured()) return { events: [], configured: false, error: null }
  const supabase = getSupabase()
  if (!supabase) return { events: [], configured: false, error: null }

  const { rows, error } = await safeSelect<LeadEventRow>('monitor_lead_events', () =>
    supabase
      .from('monitor_lead_events')
      .select('workflow,checkpoint,bucket,status,detail,execution_url,created_at')
      .eq('phone', trimmed)
      .order('created_at', { ascending: true })
      .limit(LEAD_EVENT_LIMIT),
  )

  return { events: rows, configured: true, error }
}
