/** Time helpers. All absolute timestamps render in IST (spec §Page). */

export const IST_TIME_ZONE = 'Asia/Kolkata'

const istClock = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * "14:32:07 IST" — the header's refresh stamp.
 *
 * This is the only formatter left: mon_journey() returns `at_ist` already
 * formatted, and mon_funnels() returns plain IST calendar dates, so nothing
 * else on the page has a timestamp to convert.
 */
export function formatIstClock(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : `${istClock.format(date)} IST`
}
