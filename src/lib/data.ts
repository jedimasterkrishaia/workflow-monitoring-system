import 'server-only'

import {
  buildFunnelCards,
  clampDays,
  funnelChunks,
  funnelWindow,
  normalizeStatus,
  FUNNEL_CHUNK_DAYS,
  POSTGREST_MAX_ROWS,
  sanitizeJourneyQuery,
  sortHealthRows,
  summarizeHealth,
  type FunnelRow,
  type FunnelsPayload,
  type HealthPayload,
  type HealthRow,
  type JourneyPayload,
  type JourneyRow,
} from '@/lib/monitor'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * Every read the app makes, and the only place Supabase is touched.
 *
 * Three Postgres functions, nothing else: all the check logic lives in the
 * database, so a workflow changing shape can no longer break this app (spec
 * §Decisions). The service key stays in this process — lib/supabase.ts is
 * `server-only`, so importing it from a client component is a build error.
 */

type Rpc<T> = { rows: T[]; error: string | null }

/**
 * Runs one rpc() and turns any failure into an error string instead of a
 * throw, so one broken check renders as a message on the page rather than a
 * 500 (spec §Decisions).
 */
async function safeRpc<T>(
  fn: string,
  args?: Record<string, unknown>,
): Promise<Rpc<T>> {
  const supabase = getSupabase()
  if (!supabase) return { rows: [], error: `${fn}: Supabase is not configured` }

  try {
    const { data, error } = args ? await supabase.rpc(fn, args) : await supabase.rpc(fn)
    if (error) return { rows: [], error: `${fn}: ${error.message}` }
    return { rows: (data ?? []) as T[], error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { rows: [], error: `${fn}: ${message}` }
  }
}

/* ------------------------------------------------------------------ health */

/**
 * The health board: `select * from mon_health()`.
 *
 * ~25 rows. `detail` is a ready-to-show sentence, so nothing is re-derived
 * here — only the status normalised, the rows ordered (red and broken first)
 * and the one-line summary built.
 */
export async function getHealth(): Promise<HealthPayload> {
  const generatedAt = new Date().toISOString()

  if (!isSupabaseConfigured()) {
    return {
      rows: [],
      summary: summarizeHealth([]),
      generatedAt,
      configured: false,
      error: null,
    }
  }

  const { rows, error } = await safeRpc<HealthRow>('mon_health')
  const normalized = rows.map((row) => ({ ...row, status: normalizeStatus(row.status) }))

  return {
    rows: sortHealthRows(normalized),
    summary: summarizeHealth(normalized),
    generatedAt,
    configured: true,
    error,
  }
}

/* ----------------------------------------------------------------- journey */

/**
 * One lead's timeline: `select * from mon_journey(q)`.
 *
 * The needle is sanitised to `[0-9A-Za-z@._+ -]` / 80 chars before it reaches
 * the function (spec §mon_journey). An empty needle returns no rows, so it
 * short-circuits without a round trip.
 */
export async function getJourney(raw: string | null | undefined): Promise<JourneyPayload> {
  const q = sanitizeJourneyQuery(raw)

  const empty: JourneyPayload = {
    q,
    rows: [],
    systems: [],
    fails: 0,
    configured: true,
    error: null,
  }

  if (!q) return empty
  if (!isSupabaseConfigured()) return { ...empty, configured: false }

  const { rows, error } = await safeRpc<JourneyRow>('mon_journey', { q })

  return {
    q,
    rows,
    systems: [...new Set(rows.map((row) => row.system))],
    fails: rows.filter((row) => row.status === 'fail').length,
    configured: true,
    error,
  }
}

/* ----------------------------------------------------------------- funnels */

/**
 * The funnels: `select * from mon_funnels(d_from, d_to)` over an IST window.
 *
 * The window is fetched in sub-windows and concatenated, because PostgREST caps
 * one response at 1000 rows without saying so — a single 30-day call came back
 * cut to 25 cohort days with totals quietly short (see FUNNEL_CHUNK_DAYS). The
 * chunks are disjoint day ranges and `n` is summed per funnel × segment × step
 * afterwards, so the result is identical to one unbounded call.
 *
 * Summing and the percent rules live in lib/monitor.ts — the UI renders what
 * this returns and computes nothing itself.
 */
export async function getFunnels(
  rawDays: string | number | null | undefined,
  nowMs = Date.now(),
): Promise<FunnelsPayload> {
  const days = clampDays(rawDays)
  const { dFrom, dTo } = funnelWindow(days, nowMs)

  const empty: FunnelsPayload = {
    days,
    dFrom,
    dTo,
    cards: [],
    cohortDays: [],
    rowCount: 0,
    truncated: false,
    configured: true,
    error: null,
  }

  if (!isSupabaseConfigured()) return { ...empty, configured: false }

  const chunks = funnelChunks(days, FUNNEL_CHUNK_DAYS, nowMs)
  const results = await Promise.all(
    chunks.map((chunk) =>
      safeRpc<FunnelRow>('mon_funnels', { d_from: chunk.dFrom, d_to: chunk.dTo }),
    ),
  )

  const rows = results.flatMap((result) => result.rows)
  const errors = results.map((result) => result.error).filter((e): e is string => Boolean(e))

  return {
    days,
    dFrom,
    dTo,
    cards: buildFunnelCards(rows),
    cohortDays: [...new Set(rows.map((row) => row.cohort_day))].sort(),
    rowCount: rows.length,
    truncated: results.some((result) => result.rows.length >= POSTGREST_MAX_ROWS),
    configured: true,
    // One message, de-duplicated: all the chunks are the same call shape, so a
    // failing window usually fails them all with the same text.
    error: errors.length ? [...new Set(errors)].join('; ') : null,
  }
}
