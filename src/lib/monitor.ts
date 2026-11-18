/**
 * Shapes and pure helpers for the three monitor functions in Supabase
 * (`mon_health`, `mon_journey`, `mon_funnels`).
 *
 * Nothing here touches the network, so the percent rules and the health
 * ordering can be reasoned about without a database. The fetchers live in
 * lib/data.ts, which is server-only; this module is safe to import from client
 * components for its types.
 */

/* ------------------------------------------------------------------ health */

/** The four statuses mon_health() returns. Anything else is treated as broken. */
export type MonStatus = 'ok' | 'amber' | 'red' | 'broken'

/** One row of `select * from mon_health()`. */
export type HealthRow = {
  system: string
  check_name: string
  status: MonStatus
  detail: string
  n: number | null
}

export type HealthCounts = { red: number; amber: number; ok: number; broken: number }

export type HealthSummary = HealthCounts & {
  /** "4 red, 3 amber, 18 OK. Needs attention: Enrichment, Nurture." */
  line: string
  /** Systems carrying a red or broken check (amber only when nothing is worse). */
  needsAttention: string[]
}

export type HealthPayload = {
  rows: HealthRow[]
  summary: HealthSummary
  /** ISO timestamp of the fetch — the header renders it in IST. */
  generatedAt: string
  configured: boolean
  error: string | null
}

const STATUS_VALUES: MonStatus[] = ['ok', 'amber', 'red', 'broken']

/**
 * A status the function does not promise gets read as `broken` rather than
 * dropped: an unrecognised check is itself something to look at, and silently
 * hiding it is the one failure mode a health board must not have.
 */
export function normalizeStatus(value: unknown): MonStatus {
  return STATUS_VALUES.includes(value as MonStatus) ? (value as MonStatus) : 'broken'
}

/** Red and broken first, then amber, then ok (spec §mon_health). */
const STATUS_RANK: Record<MonStatus, number> = { red: 0, broken: 1, amber: 2, ok: 3 }

/** Sorts by status only, so rows keep the function's system grouping within a rank. */
export function sortHealthRows(rows: HealthRow[]): HealthRow[] {
  return [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
}

export function countHealth(rows: HealthRow[]): HealthCounts {
  const counts: HealthCounts = { red: 0, amber: 0, ok: 0, broken: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}

export function summarizeHealth(rows: HealthRow[]): HealthSummary {
  const counts = countHealth(rows)

  const systemsWith = (statuses: MonStatus[]) => [
    ...new Set(rows.filter((row) => statuses.includes(row.status)).map((row) => row.system)),
  ]

  // Amber only earns a mention when nothing is red or broken — otherwise the
  // sentence names eight systems and stops being a summary.
  const needsAttention =
    counts.red + counts.broken > 0 ? systemsWith(['red', 'broken']) : systemsWith(['amber'])

  const parts: string[] = []
  if (counts.red) parts.push(`${counts.red} red`)
  if (counts.broken) parts.push(`${counts.broken} broken`)
  if (counts.amber) parts.push(`${counts.amber} amber`)
  parts.push(`${counts.ok} OK`)

  const head = rows.length === 0 ? 'No checks returned' : parts.join(', ')
  const tail = needsAttention.length ? ` Needs attention: ${needsAttention.join(', ')}.` : ''

  return { ...counts, line: `${head}.${tail}`, needsAttention }
}

/* ----------------------------------------------------------------- journey */

export type JourneyStatus = 'ok' | 'fail'

/** One row of `select * from mon_journey(q)`. */
export type JourneyRow = {
  at: string
  /** Pre-formatted IST wall clock from the function, e.g. "14 Nov 19:28:00". */
  at_ist: string
  system: string
  step: string
  detail: string
  status: JourneyStatus
}

export type JourneyPayload = {
  /** The sanitised needle actually sent to the function. */
  q: string
  rows: JourneyRow[]
  systems: string[]
  fails: number
  configured: boolean
  error: string | null
}

/** Max characters mon_journey() is called with (spec §mon_journey). */
export const JOURNEY_QUERY_MAX = 80

const JOURNEY_DISALLOWED = /[^0-9A-Za-z@._+ -]/g

/**
 * Keeps only `[0-9A-Za-z@._+ -]` and caps the length, per the spec. The
 * function takes any phone format or an email, so punctuation a user pastes
 * ("+91 98765-43210", "name@co.in") survives; everything else goes.
 */
export function sanitizeJourneyQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(JOURNEY_DISALLOWED, '').trim().slice(0, JOURNEY_QUERY_MAX)
}

/* ----------------------------------------------------------------- funnels */

/** One row of `select * from mon_funnels(d_from, d_to)` — per day × funnel × segment × step. */
export type FunnelRow = {
  cohort_day: string
  funnel: string
  segment: string
  step_no: number
  step: string
  n: number
}

/** A step before the percent rules run — what buildFunnelCards sums up. */
export type FunnelStepTotal = { step_no: number; step: string; n: number }

export type FunnelStep = FunnelStepTotal & {
  /**
   * Percent against `pctOf`, or null where the step carries no percentage
   * (step 1 of a normal funnel, and the send steps of Follow-ups).
   */
  pct: number | null
  /** Label of the step `pct` is measured against. */
  pctOf: string | null
  /** Percent of step 1. Null for step 1 itself, and for Follow-ups throughout. */
  pctOfFirst: number | null
  /** 0..100 bar width, relative to the largest step in this card. */
  bar: number
}

export type FunnelCard = {
  funnel: string
  segment: string
  /** "Round robin", or "WhatsApp agent · we texted first". */
  title: string
  steps: FunnelStep[]
  /** Per-day counts behind the card, for the optional day-by-day table. */
  days: { cohort_day: string; counts: Record<number, number> }[]
}

export type FunnelsPayload = {
  days: number
  dFrom: string
  dTo: string
  cards: FunnelCard[]
  /** Distinct cohort days present in the rows, ascending. */
  cohortDays: string[]
  rowCount: number
  /**
   * True if any single request came back on the PostgREST row ceiling, which
   * means a window is wider than one request can carry and the totals shown
   * are short. Surfaced rather than swallowed — see POSTGREST_MAX_ROWS.
   */
  truncated: boolean
  configured: boolean
  error: string | null
}

/** Window picker options (spec §mon_funnels). `days` is the lookback in days. */
export const FUNNEL_WINDOWS: { days: number; label: string }[] = [
  { days: 0, label: 'Today' },
  { days: 1, label: 'Yesterday and today' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
]

export const DEFAULT_FUNNEL_DAYS = 7

/** Hard bound on `?days=` (spec §API routes). */
export const MAX_FUNNEL_DAYS = 60

export function clampDays(raw: string | number | null | undefined): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_FUNNEL_DAYS
  return Math.min(MAX_FUNNEL_DAYS, Math.max(0, Math.trunc(parsed)))
}

/** Display order of the five funnels; anything new sorts after them, by name. */
const FUNNEL_ORDER = ['Round robin', 'Popup', 'Instant demo', 'WhatsApp agent', 'Follow-ups']
const SEGMENT_ORDER = ['all', 'we texted first', 'they texted first']

function orderIndex(list: string[], value: string): number {
  const found = list.indexOf(value)
  return found === -1 ? list.length : found
}

/* --- percent rules ------------------------------------------------------- */

/**
 * Follow-ups is pairs, not a ladder: step 1 ("Replied before fu1") is a
 * standalone count, then each "X sent" is followed by "Replied after X". So the
 * reply steps are a share of the send above them, and the send steps — which
 * are not a subset of anything before them — carry no percentage at all.
 */
const PAIRED_FUNNEL = 'Follow-ups'

/**
 * Steps measured against something other than the step directly above.
 * "Tapped self setup" is the other branch out of the popup, not a step after
 * "Tapped WhatsApp", so showing it as a share of WhatsApp taps would read as a
 * drop-off that never happened.
 */
const PERCENT_BASE_OVERRIDES: Record<string, Record<string, string>> = {
  Popup: { 'Tapped self setup': 'Saw popup' },
}

function percent(n: number, base: number | undefined): number | null {
  if (base === undefined || base <= 0) return null
  return Math.round((n / base) * 1000) / 10
}

/**
 * Applies the percent rules to one funnel × segment's steps, which must already
 * be summed over the window and sorted by step_no.
 */
export function applyPercentRules(funnel: string, steps: FunnelStepTotal[]): FunnelStep[] {
  const byStepNo = new Map(steps.map((step) => [step.step_no, step]))
  const byLabel = new Map(steps.map((step) => [step.step, step]))
  const first = steps[0]
  const max = steps.reduce((largest, step) => Math.max(largest, step.n), 0)
  const paired = funnel === PAIRED_FUNNEL
  const overrides = PERCENT_BASE_OVERRIDES[funnel] ?? {}

  return steps.map((step, index) => {
    let base: FunnelStepTotal | undefined

    if (paired) {
      // Reply steps (3, 5, 7, …) against the send step before them; nothing else.
      base =
        step.step_no >= 3 && step.step_no % 2 === 1 ? byStepNo.get(step.step_no - 1) : undefined
    } else if (overrides[step.step]) {
      base = byLabel.get(overrides[step.step])
    } else if (index > 0) {
      base = steps[index - 1]
    }

    return {
      ...step,
      pct: base ? percent(step.n, base.n) : null,
      pctOf: base ? base.step : null,
      // Step 1 of Follow-ups is not a funnel entry, so "% of step 1" means nothing there.
      pctOfFirst: paired || !first || step === first ? null : percent(step.n, first.n),
      bar: max > 0 ? Math.round((step.n / max) * 1000) / 10 : 0,
    }
  })
}

/**
 * Sums `n` over the selected days per funnel × segment × step_no and attaches
 * the percentages, keeping the per-day counts for the day-by-day table.
 */
export function buildFunnelCards(rows: FunnelRow[]): FunnelCard[] {
  type Group = {
    funnel: string
    segment: string
    steps: Map<number, FunnelStepTotal>
    days: Map<string, Record<number, number>>
  }

  const groups = new Map<string, Group>()

  for (const row of rows) {
    const key = `${row.funnel} ${row.segment}`
    let group = groups.get(key)
    if (!group) {
      group = { funnel: row.funnel, segment: row.segment, steps: new Map(), days: new Map() }
      groups.set(key, group)
    }

    // bigint columns can arrive as strings depending on the PostgREST version.
    const n = Number(row.n) || 0

    const step = group.steps.get(row.step_no)
    if (step) step.n += n
    else group.steps.set(row.step_no, { step_no: row.step_no, step: row.step, n })

    const day = group.days.get(row.cohort_day) ?? {}
    day[row.step_no] = (day[row.step_no] ?? 0) + n
    group.days.set(row.cohort_day, day)
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        orderIndex(FUNNEL_ORDER, a.funnel) - orderIndex(FUNNEL_ORDER, b.funnel) ||
        a.funnel.localeCompare(b.funnel) ||
        orderIndex(SEGMENT_ORDER, a.segment) - orderIndex(SEGMENT_ORDER, b.segment) ||
        a.segment.localeCompare(b.segment),
    )
    .map((group) => ({
      funnel: group.funnel,
      segment: group.segment,
      title:
        group.segment && group.segment !== 'all'
          ? `${group.funnel} · ${group.segment}`
          : group.funnel,
      steps: applyPercentRules(
        group.funnel,
        [...group.steps.values()].sort((a, b) => a.step_no - b.step_no),
      ),
      days: [...group.days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohort_day, counts]) => ({ cohort_day, counts })),
    }))
}

/* ------------------------------------------------------------- IST calendar */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` of the IST calendar day `daysAgo` days before `nowMs`. */
export function istDate(daysAgo = 0, nowMs = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MS - daysAgo * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The (d_from, d_to) pair for a window.
 *
 * `days` is a lookback, not a count: 0 is today only, 1 is yesterday and today,
 * 7 is the spec's `current_date - 7 .. current_date` — eight cohort days.
 */
export function funnelWindow(days: number, nowMs = Date.now()): { dFrom: string; dTo: string } {
  return { dFrom: istDate(days, nowMs), dTo: istDate(0, nowMs) }
}

/**
 * PostgREST will not return more than 1000 rows in one response, and it does it
 * silently — no error, just a short list.
 */
export const POSTGREST_MAX_ROWS = 1000

/**
 * Days per request.
 *
 * mon_funnels returns ~42 rows a day (5 funnels × their segments × steps), so a
 * 30-day window is ~1300 rows and would come back cut to 1000 — the 24-day
 * window and the 60-day window both returned exactly 1000 rows and identical
 * totals before this was chunked. 10 days (~420 rows) leaves room for the
 * funnels to grow before anyone has to think about this again.
 */
export const FUNNEL_CHUNK_DAYS = 10

/**
 * Splits a lookback into disjoint sub-windows, newest first, each small enough
 * to come back whole. Days are summed afterwards, so where the cuts fall makes
 * no difference to the totals.
 */
export function funnelChunks(
  days: number,
  chunkDays = FUNNEL_CHUNK_DAYS,
  nowMs = Date.now(),
): { dFrom: string; dTo: string }[] {
  const size = Math.max(1, Math.trunc(chunkDays))
  const chunks: { dFrom: string; dTo: string }[] = []

  for (let start = Math.max(0, days); start >= 0; start -= size) {
    const end = Math.max(0, start - (size - 1))
    chunks.push({ dFrom: istDate(start, nowMs), dTo: istDate(end, nowMs) })
    if (end === 0) break
  }

  return chunks
}
