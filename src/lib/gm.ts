import { GM_STALE_MINUTES, type Status } from '@/lib/aggregate'
import { minutesSince } from '@/lib/time'
import type { GmSlotRow } from '@/lib/types'

/**
 * monitor_gm_slots rows → chip data.
 *
 * The view's own columns (gm_name, age_seconds, updated_at, freshness_status)
 * are used when present; anything else falls back to shape sniffing so a renamed
 * column degrades one chip instead of blanking the strip.
 */

export type GmSlot = {
  name: string
  minsSinceRefresh: number | null
  allFreeWarn: boolean
  counts: { label: string; value: number }[]
  /** green = fresh, amber = stale (>5 min) or all-free warning, idle = unknown age. */
  status: Status
  stale: boolean
  raw: GmSlotRow
}

const NAME_HINT = /(gm|name|owner|user|rep|calendar|email)/i
const TIME_HINT = /(updated|refresh|synced|checked|last|_at$|time)/i
const COUNT_HINT = /(free|avail|open|booked|busy|slot)/i

function isTimestampLike(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /\d{4}-\d{2}/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  )
}

/** Minutes since the row last refreshed, from whichever column carries it. */
function refreshAgeMinutes(row: GmSlotRow, nowMs: number): number | null {
  if (typeof row.age_seconds === 'number' && Number.isFinite(row.age_seconds)) {
    return row.age_seconds / 60
  }
  if (typeof row.updated_at === 'string') {
    const mins = minutesSince(row.updated_at, nowMs)
    if (mins !== null) return mins
  }
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'number' && /age_seconds|seconds_since/i.test(key)) return value / 60
    if (typeof value === 'number' && /(mins|minutes)_(since|ago)|age_minutes/i.test(key)) {
      return value
    }
  }
  const ts = Object.entries(row).find(([k, v]) => isTimestampLike(v) && TIME_HINT.test(k))
  return ts ? minutesSince(ts[1] as string, nowMs) : null
}

export function normalizeGmSlot(row: GmSlotRow, nowMs: number): GmSlot {
  const entries = Object.entries(row)

  const nameEntry =
    (typeof row.gm_name === 'string' && row.gm_name ? (['gm_name', row.gm_name] as const) : null) ??
    entries.find(([k, v]) => typeof v === 'string' && NAME_HINT.test(k) && !isTimestampLike(v)) ??
    entries.find(([, v]) => typeof v === 'string' && !isTimestampLike(v))
  const name = nameEntry ? String(nameEntry[1]) : '(unnamed GM)'

  const minsSinceRefresh = refreshAgeMinutes(row, nowMs)
  const allFreeWarn =
    row.all_free_warn === true || String(row.all_free_warn).toLowerCase() === 'true'

  const counts = entries
    .filter(([k, v]) => typeof v === 'number' && COUNT_HINT.test(k))
    .slice(0, 3)
    .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v as number }))

  // The view's own verdict wins when it disagrees with the clock.
  const declaredStale =
    typeof row.freshness_status === 'string' &&
    row.freshness_status.toLowerCase() !== 'green' &&
    row.freshness_status !== ''
  const stale =
    declaredStale || (minsSinceRefresh !== null && minsSinceRefresh > GM_STALE_MINUTES)

  const status: Status =
    minsSinceRefresh === null && !declaredStale ? 'idle' : stale || allFreeWarn ? 'amber' : 'green'

  return { name, minsSinceRefresh, allFreeWarn, counts, status, stale, raw: row }
}

export function normalizeGmSlots(rows: GmSlotRow[], nowMs: number): GmSlot[] {
  return rows.map((row) => normalizeGmSlot(row, nowMs)).sort((a, b) => {
    // Anything needing attention floats to the front of the strip.
    if (a.status !== b.status) {
      const rank = (s: Status) => (s === 'amber' ? 0 : s === 'idle' ? 1 : 2)
      return rank(a.status) - rank(b.status)
    }
    return a.name.localeCompare(b.name)
  })
}
