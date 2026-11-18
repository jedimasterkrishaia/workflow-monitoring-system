'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { FunnelsPayload, HealthPayload } from '@/lib/monitor'
import { formatIstClock } from '@/lib/time'
import Funnels from '@/components/Funnels'
import HealthBoard, { HealthTiles } from '@/components/HealthBoard'
import LeadJourney from '@/components/LeadJourney'
import { ErrorNote } from '@/components/ui'

/** Health auto-refresh cadence (spec §Page 1). Health only — funnels on demand. */
const HEALTH_POLL_MS = 60_000

function StatusLegend() {
  return (
    <details className="hairline rounded-card bg-surface px-3 py-2 text-[12px]">
      <summary className="cursor-pointer text-[12px] text-ink-2 hover:text-ink">
        What the statuses mean
      </summary>
      <dl className="mt-2.5 space-y-2 text-ink-2">
        <div>
          <dt className="inline font-medium text-bad">red</dt>
          <dd className="inline"> — something is failing now and leads are affected. Act today.</dd>
        </div>
        <div>
          <dt className="inline font-medium text-warn">amber</dt>
          <dd className="inline">
            {' '}
            — worth a look: a small number of leads are stuck, or a step is slower than usual.
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-ok">ok</dt>
          <dd className="inline"> — the check ran and found nothing wrong.</dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink-3">broken</dt>
          <dd className="inline">
            {' '}
            — the check itself could not run, so this system&rsquo;s state is unknown. Not the same
            as red: fix the check, then read the result.
          </dd>
        </div>
      </dl>
      <p className="mt-2.5 text-[11px] text-ink-3">
        Every check and its wording lives in Supabase (mon_health); this page only displays them.
        Counts are over the last 24 hours unless the detail says otherwise.
      </p>
    </details>
  )
}

/**
 * The page.
 *
 * Health is server-rendered once and then polled every 60s. The journey and the
 * funnels fetch on their own, so a 60s health refresh never clears a search or
 * reloads a 30-day window.
 */
export default function Monitor({
  initialHealth,
  initialFunnels,
}: {
  initialHealth: HealthPayload
  initialFunnels: FunnelsPayload
}) {
  const [health, setHealth] = useState(initialHealth)
  const [pollFailed, setPollFailed] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // The stamp is rendered client-side from the payload, so it must not be read
  // during the first render — the server and the browser would format against
  // different clocks and React would flag the mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setHealth((await response.json()) as HealthPayload)
      setPollFailed(null)
    } catch (err) {
      setPollFailed(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => void refresh(), HEALTH_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
      <header className="hairline-b mb-6 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">AiA System Monitor</h1>
          <div className="flex items-center gap-2.5 text-[11px] text-ink-3">
            <span suppressHydrationWarning>
              {mounted ? `Refreshed ${formatIstClock(health.generatedAt)}` : 'Refreshed —'}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="hairline rounded-chip bg-surface px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-2">{health.summary.line}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">Health refreshes every 60s.</p>
      </header>

      {!health.configured ? (
        <ErrorNote>
          Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
        </ErrorNote>
      ) : null}
      {health.error ? <ErrorNote>{health.error}</ErrorNote> : null}
      {pollFailed ? <ErrorNote>Health refresh failed: {pollFailed}</ErrorNote> : null}

      <HealthTiles counts={health.summary} />
      <HealthBoard rows={health.rows} />
      <LeadJourney />
      <Funnels initial={initialFunnels} />
      <StatusLegend />
    </main>
  )
}
