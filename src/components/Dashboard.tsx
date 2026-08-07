'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import BucketPipelines from '@/components/BucketPipelines'
import GmStrip from '@/components/GmStrip'
import LeadJourneys from '@/components/LeadJourneys'
import RedsFeed from '@/components/RedsFeed'
import WorkflowTiles from '@/components/WorkflowTiles'
import { Section, Tabs, type Tab } from '@/components/ui'
import { buildWorkflowTiles, withoutSystemCheckpoints } from '@/lib/aggregate'
import { BASE_PATH } from '@/lib/basePath'
import { leadParamsToQuery } from '@/lib/leadParams'
import { buildPipelines } from '@/lib/pipelines'
import { rollup, type Severity } from '@/lib/severity'
import { formatIstClock } from '@/lib/time'
import { DEFAULT_LEAD_PARAMS, type LeadListParams, type MonitorPayload } from '@/lib/types'

const REFRESH_MS = 60_000
const CLOCK_TICK_MS = 30_000
const SEARCH_DEBOUNCE_MS = 350

type TabId = 'overview' | 'leads' | 'flags'

/**
 * Client shell for the ops screen.
 *
 * The first snapshot is server-rendered; after that the page polls
 * /api/monitor every 60s. "Now" is seeded from the payload's generatedAt so the
 * server and client agree on relative times during hydration, then follows the
 * real clock. All three tabs read one payload — switching tabs never refetches.
 */
export default function Dashboard({ initialPayload }: { initialPayload: MonitorPayload }) {
  const [payload, setPayload] = useState<MonitorPayload>(initialPayload)
  const [tab, setTab] = useState<TabId>('overview')
  const [leadParams, setLeadParams] = useState<LeadListParams>(DEFAULT_LEAD_PARAMS)
  // True once the lead tab has pulled pages past the first one.
  const [leadsPagedIn, setLeadsPagedIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => {
    const t = Date.parse(initialPayload.generatedAt)
    return Number.isFinite(t) ? t : 0
  })

  const leadParamsRef = useRef(leadParams)
  leadParamsRef.current = leadParams

  const refresh = useCallback(async (params: LeadListParams) => {
    setRefreshing(true)
    try {
      const res = await fetch(`${BASE_PATH}/api/monitor?${leadParamsToQuery(params)}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next = (await res.json()) as MonitorPayload
      setPayload(next)
      setNowMs(Date.now())
      setFetchError(null)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
      setLoadingLeads(false)
    }
  }, [])

  // Align relative times with the real clock once hydration is done.
  useEffect(() => setNowMs(Date.now()), [])

  // A poll replaces page 1 and drops any loaded tail, which is fine for the flag
  // log but yanks the floor out from under someone paging through leads. While
  // they are paged in, the Refresh button is the only thing that reloads.
  const pollPaused = tab === 'leads' && leadsPagedIn

  useEffect(() => {
    if (pollPaused) return
    const id = setInterval(() => void refresh(leadParamsRef.current), REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh, pollPaused])

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Search runs server-side across the whole view, so it round-trips — debounced
  // because it fires per keystroke.
  const firstSearch = useRef(true)
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false
      return
    }
    setLoadingLeads(true)
    const id = setTimeout(() => void refresh(leadParamsRef.current), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [leadParams.q, refresh])

  // The dropdowns are single deliberate actions — no reason to make them wait.
  const firstFilter = useRef(true)
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false
      return
    }
    setLoadingLeads(true)
    void refresh(leadParamsRef.current)
  }, [leadParams.range, leadParams.health, leadParams.pipeline, refresh])

  // The batch loops' own bookkeeping checkpoints are dropped once, here, so
  // every Overview surface agrees — tiles, pipelines and chips alike. They are
  // read instead by the batch-integrity panel on the flag log, from its own
  // view. See withoutSystemCheckpoints for why this is not done per widget.
  const overview = useMemo(() => withoutSystemCheckpoints(payload.overview), [payload.overview])
  const buckets = useMemo(() => withoutSystemCheckpoints(payload.buckets), [payload.buckets])

  // nowMs is a dependency because the staleness rule is time-of-day aware: a
  // workflow's window can close between two refreshes (see lib/severity).
  const tiles = useMemo(
    () => buildWorkflowTiles(overview, buckets, nowMs),
    [overview, buckets, nowMs],
  )
  const pipelines = useMemo(
    () => buildPipelines(overview, buckets, nowMs),
    [overview, buckets, nowMs],
  )

  // Lets the flag log order by the same severity the Overview tab shows.
  const severityByCheckpoint = useMemo(() => {
    const map = new Map<string, Severity>()
    for (const row of overview) {
      // Per-checkpoint grain, so the stale-green rule stays out of it (see severity.ts).
      map.set(`${row.workflow ?? ''}|${row.checkpoint ?? ''}`, rollup([row], { deadGreen: false }).severity)
    }
    return map
  }, [overview])

  const tabs: Tab<TabId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'leads', label: 'Lead wise' },
    { id: 'flags', label: 'Flag logs', badge: payload.redsLast24h },
  ]

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[17px] font-semibold tracking-tight">Pipeline health</h1>
        <div className="flex items-center gap-3 text-[12px] text-ink-2">
          <span>
            Updated {formatIstClock(payload.generatedAt)}
            {refreshing ? ' · refreshing…' : ''}
          </span>
          <button
            type="button"
            onClick={() => void refresh(leadParams)}
            className="hairline rounded-chip px-2 py-1 hover:bg-surface"
          >
            Refresh
          </button>
        </div>
      </header>

      {!payload.configured ? (
        <div className="mb-4 rounded-card border-[0.5px] border-warn/30 bg-warn-soft px-3 py-2.5 text-[13px]">
          <span className="font-medium">Supabase credentials not set.</span> Fill{' '}
          <code className="font-mono">SUPABASE_URL</code> and{' '}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> in{' '}
          <code className="font-mono">.env.local</code>, then restart{' '}
          <code className="font-mono">npm run dev</code>. Until then every tab renders empty.
        </div>
      ) : null}

      {payload.errors.length > 0 ? (
        <div className="mb-4 rounded-card border-[0.5px] border-bad/30 bg-bad-soft px-3 py-2.5 text-[13px]">
          <div className="font-medium">Some views failed to load</div>
          <ul className="mt-1 list-inside list-disc font-mono text-[11px]">
            {payload.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {fetchError ? (
        <div className="mb-4 rounded-card border-[0.5px] border-bad/30 bg-bad-soft px-3 py-2.5 text-[13px]">
          Refresh failed: <span className="font-mono">{fetchError}</span>
        </div>
      ) : null}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' ? (
        <>
          <Section title="Workflows" subtitle="today">
            <WorkflowTiles tiles={tiles} />
          </Section>

          <Section title="GM slots" subtitle="calendar freshness">
            <GmStrip rows={payload.gmSlots} nowMs={nowMs} />
          </Section>

          <Section title="Pipelines" subtitle="stages in journey order, per bucket">
            <BucketPipelines pipelines={pipelines} />
          </Section>
        </>
      ) : null}

      {tab === 'leads' ? (
        <LeadJourneys
          leads={payload.leads}
          total={payload.leadsTotal}
          hasMore={payload.leadsHasMore}
          pipelines={payload.leadPipelines}
          nowMs={nowMs}
          params={leadParams}
          onParamsChange={setLeadParams}
          onPagedInChange={setLeadsPagedIn}
          loading={loadingLeads}
        />
      ) : null}

      {tab === 'flags' ? (
        <RedsFeed
          reds={payload.reds}
          hardErrors={payload.hardErrors}
          deadBatches={payload.deadBatches}
          missedReminders={payload.missedReminders}
          brokenCoach={payload.brokenCoach}
          missedTranscripts={payload.missedTranscripts}
          hasMore={payload.redsHasMore}
          nowMs={nowMs}
          severityByCheckpoint={severityByCheckpoint}
        />
      ) : null}

      <footer className="hairline-t mt-7 pt-3 text-[11px] text-ink-3">
        Read-only view of Supabase monitor views ·{' '}
        {pollPaused
          ? 'auto-refresh paused while you page through leads — use Refresh'
          : 'auto-refreshes every 60s'}
      </footer>
    </main>
  )
}
