/** Time helpers. All absolute timestamps render in IST (spec §Page layout). */

export const IST_TIME_ZONE = 'Asia/Kolkata'

const istClock = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const istDateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "14:32:07 IST" — used for the last-refreshed stamp. */
export function formatIstClock(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? `${istClock.format(d)} IST` : '—'
}

/** "04 Aug, 14:32 IST" — used in expanded rows. */
export function formatIstDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? `${istDateTime.format(d)} IST` : '—'
}

/** Compact relative label: "just now", "33m ago", "4h ago", "2d ago". */
export function relativeFromMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'never'
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/** Same label, derived from a timestamp against an explicit "now" (hydration-safe). */
export function relativeFromTimestamp(
  value: string | number | Date | null | undefined,
  nowMs: number,
): string {
  const d = toDate(value)
  if (!d) return 'never'
  return relativeFromMinutes((nowMs - d.getTime()) / 60000)
}

/** Ultra-compact age for chips: "12s", "4m", "3h", "2d". */
export function compactAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const m = Math.max(0, minutes)
  if (m < 1) return `${Math.max(0, Math.round(m * 60))}s`
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h`
  return `${Math.floor(h / 24)}d`
}

/** IST is a fixed UTC+5:30 offset, so "today" needs no timezone database. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Epoch ms of 00:00 IST on the day `nowMs` falls in. */
export function istDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
}

/** Minutes past 00:00 IST — the clock lib/severity reads its cadence windows against. */
export function istMinutesOfDay(nowMs: number): number {
  return Math.floor((nowMs - istDayStartMs(nowMs)) / 60000)
}

/**
 * The monitor views' `*_ist` columns are `timestamp without time zone` holding
 * IST wall clock, so they arrive carrying no offset at all
 * ("2026-08-06T14:05:00.289695"). `new Date()` reads an offset-less timestamp as
 * the *runtime's* local time, so rendering one through the IST formatter would
 * shift it by whatever the server or browser happens to be set to — 19:35 for a
 * 14:05 batch on a UTC box. Pinning +05:30 keeps the digits the database wrote.
 */
const NAIVE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.(\d+))?$/

export function istNaiveToMs(value: string | null | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()

  const match = NAIVE_TIMESTAMP.exec(trimmed)
  // No match means it already carries a zone (or is not a timestamp) — normal parse.
  if (!match) {
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const [, date, hourMinute, seconds = '00', fraction] = match
  // Postgres writes microseconds; Date.parse only promises to read milliseconds.
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : ''
  const parsed = Date.parse(`${date}T${hourMinute}:${seconds}${millis}+05:30`)
  return Number.isFinite(parsed) ? parsed : null
}

/** "04 Aug, 14:32 IST" for a naive `*_ist` column. */
export function formatIstNaive(value: string | null | undefined): string {
  const ms = istNaiveToMs(value)
  return ms === null ? '—' : formatIstDateTime(ms)
}

/**
 * The IST wall clock at `ms`, shaped the way a naive `*_ist` column stores it —
 * so a cutoff can be compared against one of those columns server-side.
 */
export function toIstNaive(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19)
}

/** Minutes elapsed between a timestamp and "now"; null when unparseable. */
export function minutesSince(
  value: string | number | Date | null | undefined,
  nowMs: number,
): number | null {
  const d = toDate(value)
  if (!d) return null
  return (nowMs - d.getTime()) / 60000
}
