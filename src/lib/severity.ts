import { compactAge, istMinutesOfDay } from '@/lib/time'
import type { BucketRow, OverviewRow } from '@/lib/types'

/**
 * The one severity model the whole dashboard reads from.
 *
 * It replaces the old binary red/green: a single failure in a busy workflow is
 * a flag, not an outage, and a workflow that *should* be firing but has said
 * nothing for hours is an outage even though nothing is technically red.
 *
 * "Should be firing" is the whole trick, and it is per workflow — see
 * WORKFLOW_CADENCE. Scoring every workflow against one clock marked the
 * event-driven ones as failing every quiet afternoon, which is exactly the
 * alarm fatigue this model exists to prevent.
 */

/**
 * Four health tiers plus `idle`, which is the absence of data rather than a
 * verdict on it. The tier between healthy and warning is the load-bearing one:
 * a busy workflow that dropped one event out of two hundred is not the same
 * animal as one dropping one in twenty, and colouring both amber taught people
 * to ignore amber.
 */
export type Severity = 'failing' | 'warning' | 'minor' | 'healthy' | 'idle'

/**
 * How a workflow is expected to fire, which decides whether silence is evidence.
 *
 * - `event` — fires only when something outside it happens. Idle is its normal
 *   resting state, so silence says nothing about its health, ever.
 * - `window` — fires in scheduled bursts spread across the working day, with
 *   legitimate hour-plus gaps between them.
 * - `continuous` — handles a live inbound stream; going quiet during working
 *   hours means the stream broke.
 */
export type Cadence = 'event' | 'window' | 'continuous'

/**
 * Cadence per workflow. Hardcoded like the pipeline stage order: how often a
 * workflow *ought* to fire is product knowledge the data cannot be asked for.
 *
 * Anything unlisted is treated as continuous — a new workflow that quietly dies
 * should still shout, and a human can reclassify it here once they know better.
 */
export const WORKFLOW_CADENCE: Record<string, Cadence> = {
  scheduler: 'event',
  rh_meetings: 'event',
  welcome_email: 'event',
  sales_coach: 'event',
  confirm_dispatch: 'window',
  reminder_dispatch: 'window',
  first_touch: 'continuous',
  ai_sdr: 'continuous',
}

export const DEFAULT_CADENCE: Cadence = 'continuous'

/** Greened today but silent this long → dead mid-day, which counts as failing. */
export const DEAD_GREEN_MINUTES = 60

type StalenessRule = {
  /** Silence longer than this reads as dead. */
  silentMins: number
  /** IST minute-of-day the rule is awake between; outside it silence is normal. */
  fromMinute: number
  untilMinute: number
}

/** null → silence is never evidence for this cadence, at any hour. */
const STALENESS: Record<Cadence, StalenessRule | null> = {
  event: null,
  // The confirm and reminder ladders fire in bursts from the 9:28 WA through
  // the last same-day call, so only a gap wider than any gap between rungs
  // means anything — and after the evening rungs there is nothing left to fire.
  window: { silentMins: 3 * 60, fromMinute: 9 * 60, untilMinute: 19 * 60 + 30 },
  // Inbound does not stop during the day, so an hour of nothing is a break.
  continuous: { silentMins: DEAD_GREEN_MINUTES, fromMinute: 9 * 60, untilMinute: 21 * 60 },
}

/** Reds at or above this share of today's events are a failure, not a flag. */
export const FAILING_RATIO = 0.1

/**
 * The footnote thresholds. Reds stay `minor` while they are either a trivial
 * share of the day's volume *or* countable on one hand — low volume makes the
 * ratio jumpy (2 reds out of 25 is 8% and means very little), so a small
 * absolute count is its own excuse.
 *
 * The two are deliberately an OR, which means `warning` is what is left over:
 * a meaningful share *and* more than a couple of events. Both have to agree
 * before the board goes amber.
 */
export const MINOR_RATIO = 0.02
export const MINOR_REDS = 2

/** Every workflow reports unrecoverable crashes under this checkpoint name. */
export const HARD_ERROR_CHECKPOINT = 'hard_error'

/** Severity-first ordering, worst first. */
export const SEVERITY_RANK: Record<Severity, number> = {
  failing: 0,
  warning: 1,
  minor: 2,
  healthy: 3,
  idle: 4,
}

export type Rollup = {
  severity: Severity
  greenToday: number
  redToday: number
  totalToday: number
  hardErrorToday: number
  /** Most recent green anywhere in the rolled-up set. */
  minsSinceGreen: number | null
  /** Checkpoints carrying today's reds, most reds first — names the flag. */
  redCheckpoints: string[]
  /** One-line status: "healthy · 52m", "188/189 · 1 flag", "20% failing". */
  line: string
  /** false → nothing has ever reported here, so "healthy" would be a lie. */
  hasHistory: boolean
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export type RollupOptions = {
  /**
   * Whether a stale last-green can mark the set as failing.
   *
   * On for workflows and pipeline rows, where silence means something died. Off
   * for a single stage cell: plenty of checkpoints legitimately fire a handful
   * of times a day, and scoring each one against a 60-minute clock paints the
   * whole board red — which is precisely the alarm fatigue this model exists to
   * prevent. A quiet stage still shows up in its row's verdict.
   */
  deadGreen?: boolean
  /** Which workflow these rows belong to — picks the cadence (see WORKFLOW_CADENCE). */
  workflow?: string
  /**
   * Epoch ms the IST cadence windows are read against. Threaded from the
   * dashboard's clock so server and client agree during hydration.
   */
  nowMs?: number
}

/**
 * How long this set may stay silent before it reads as failing, or null when
 * silence proves nothing — because the workflow is event-driven, because it is
 * outside the workflow's active hours, or because staleness is off entirely.
 */
export function staleAfterMinutes(options: RollupOptions = {}): number | null {
  const { deadGreen = true, workflow, nowMs = Date.now() } = options
  if (!deadGreen) return null

  const rule = STALENESS[WORKFLOW_CADENCE[workflow ?? ''] ?? DEFAULT_CADENCE]
  if (!rule) return null

  const minute = istMinutesOfDay(nowMs)
  if (minute < rule.fromMinute || minute > rule.untilMinute) return null

  return rule.silentMins
}

/** Today's reds as a share of today's events; 0 when nothing ran. */
function redRatio(counts: Pick<Rollup, 'redToday' | 'totalToday'>): number {
  return counts.totalToday > 0 ? counts.redToday / counts.totalToday : 0
}

/**
 * The severity rules, in precedence order. Failing wins over warning wins over
 * minor, so a hard error can never be softened by a good ratio.
 */
export function severityOf(
  counts: Omit<Rollup, 'severity' | 'line' | 'redCheckpoints'>,
  options: RollupOptions = {},
): Severity {
  if (counts.hardErrorToday > 0) return 'failing'
  if (redRatio(counts) >= FAILING_RATIO) return 'failing'

  const staleAfter = staleAfterMinutes(options)
  if (
    staleAfter !== null &&
    counts.greenToday > 0 &&
    counts.minsSinceGreen !== null &&
    counts.minsSinceGreen > staleAfter
  ) {
    return 'failing'
  }

  if (counts.redToday > 0) {
    return redRatio(counts) < MINOR_RATIO || counts.redToday <= MINOR_REDS ? 'minor' : 'warning'
  }
  if (counts.greenToday > 0) return 'healthy'
  return 'idle'
}

function statusLine(
  counts: Omit<Rollup, 'severity' | 'line' | 'redCheckpoints'>,
  severity: Severity,
  redCheckpoints: string[],
): string {
  switch (severity) {
    case 'failing': {
      if (counts.hardErrorToday > 0) {
        return `${counts.hardErrorToday} hard error${counts.hardErrorToday === 1 ? '' : 's'}`
      }
      if (redRatio(counts) >= FAILING_RATIO) {
        return `${Math.round(redRatio(counts) * 100)}% failing`
      }
      return `no green ${compactAge(counts.minsSinceGreen)}`
    }
    case 'warning': {
      const shown = redCheckpoints.slice(0, 2).join(', ')
      const more = redCheckpoints.length > 2 ? ` +${redCheckpoints.length - 2}` : ''
      const flags = `${counts.redToday} flag${counts.redToday === 1 ? '' : 's'}`
      return shown ? `${flags} · ${shown}${more}` : flags
    }
    // Leads with what went right, because that is the honest headline here:
    // "188/189 · 1 flag" is a good day with a footnote, not an incident.
    case 'minor':
      return `${counts.greenToday}/${counts.totalToday} · ${counts.redToday} flag${
        counts.redToday === 1 ? '' : 's'
      }`
    case 'healthy':
      // An old green that deliberately did not raise a flag has to say so, or a
      // workflow last seen this morning reads as if it just fired.
      return counts.minsSinceGreen !== null && counts.minsSinceGreen > DEAD_GREEN_MINUTES
        ? `healthy · last green ${compactAge(counts.minsSinceGreen)} ago`
        : `healthy · ${compactAge(counts.minsSinceGreen)}`
    default:
      return counts.hasHistory ? 'quiet today' : 'no data yet'
  }
}

/**
 * Rolls a set of monitor_overview / monitor_bucket_overview rows into one
 * verdict. Works at any grain: a whole workflow, one checkpoint, one bucket.
 */
export function rollup(rows: (OverviewRow | BucketRow)[], options: RollupOptions = {}): Rollup {
  let greenToday = 0
  let redToday = 0
  let hardErrorToday = 0
  let hasHistory = false
  let minsSinceGreen: number | null = null

  const redsByCheckpoint = new Map<string, number>()

  for (const row of rows) {
    const green = num(row.green_today)
    const red = num(row.red_today)

    greenToday += green
    redToday += red

    if (row.checkpoint === HARD_ERROR_CHECKPOINT) hardErrorToday += red
    if (red > 0) {
      redsByCheckpoint.set(row.checkpoint, (redsByCheckpoint.get(row.checkpoint) ?? 0) + red)
    }

    if (green || red || num(row.green_7d) || num(row.red_7d) || row.last_green || row.last_red) {
      hasHistory = true
    }

    const mins = row.mins_since_green
    if (typeof mins === 'number' && Number.isFinite(mins)) {
      minsSinceGreen = minsSinceGreen === null ? mins : Math.min(minsSinceGreen, mins)
    }
  }

  const counts = {
    greenToday,
    redToday,
    totalToday: greenToday + redToday,
    hardErrorToday,
    minsSinceGreen,
    hasHistory,
  }

  const redCheckpoints = [...redsByCheckpoint.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([checkpoint]) => checkpoint)

  const severity = severityOf(counts, options)

  return { ...counts, severity, redCheckpoints, line: statusLine(counts, severity, redCheckpoints) }
}

/** Foreground colour for the status line. Minor sits a shade back from healthy. */
export function severityInk(severity: Severity): string {
  switch (severity) {
    case 'failing':
      return 'text-bad'
    case 'warning':
      return 'text-warn'
    case 'minor':
      return 'text-minor-ink'
    case 'healthy':
      return 'text-ok'
    default:
      return 'text-ink-3'
  }
}

/** The 3px leading edge on a tile or pipeline card. */
export function severityAccent(severity: Severity): string {
  switch (severity) {
    case 'failing':
      return 'accent accent-bad'
    case 'warning':
      return 'accent accent-warn'
    case 'minor':
      return 'accent accent-minor'
    case 'healthy':
      return 'accent accent-ok'
    default:
      return 'accent'
  }
}
