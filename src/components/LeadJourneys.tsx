'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { humanize, type Status } from '@/lib/aggregate'
import { BASE_PATH } from '@/lib/basePath'
import {
  checkpointLabel,
  greenPhases,
  leadDisplayName,
  leadHealth,
  type Health,
  type LeadHealth,
} from '@/lib/journey'
import { leadParamsToQuery } from '@/lib/leadParams'
import { formatIstDateTime, relativeFromTimestamp } from '@/lib/time'
import type {
  LeadEventRow,
  LeadEventsPayload,
  LeadListParams,
  LeadRow,
  LeadsPage,
} from '@/lib/types'
import { EmptyNote, Pill, Select, StatusDot } from '@/components/ui'

/** Lead · Health · Journey · Last activity — the expanded row spans all four. */
const COLUMN_COUNT = 4

const HUBSPOT_RECORD_URL = 'https://app.hubspot.com/contacts/39668252/record/0-3'

/** Every pipeline — the `pipeline` filter's empty value. */
const ALL_PIPELINES = ''

const HEALTH_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'issue', label: 'Issues only' },
  { value: 'stalled', label: 'Stalled only' },
]

const RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

/** Issues first, then stalled, then everything else. */
const HEALTH_RANK: Record<Health, number> = { issue: 0, stalled: 1, ok: 2 }

const HEALTH_TINT: Record<Health, Status> = { issue: 'red', stalled: 'amber', ok: 'green' }

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}

function timestampMs(value: unknown): number {
  const t = Date.parse(String(value ?? ''))
  return Number.isFinite(t) ? t : 0
}

/** One labelled value in the expansion footer. Renders nothing when empty. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === false) return null
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-[12px] text-ink">{children}</div>
    </div>
  )
}

/**
 * Phase pills for one lead: the phases actually reached, plus a single pill for
 * whatever is wrong. Nothing gray is ever rendered — an unreached phase that is
 * not the blocker simply is not shown.
 */
function Journey({ lead, health }: { lead: LeadRow; health: LeadHealth }) {
  const pills: { key: string; status: Status; label: string }[] = greenPhases(lead).map((phase) => ({
    key: phase.label,
    status: 'green',
    label: `${phase.label} ✓`,
  }))

  if (health.level !== 'ok' && health.step) {
    pills.push({
      key: '__health__',
      status: HEALTH_TINT[health.level],
      label: health.level === 'issue' ? `${health.step} ✕` : health.step,
    })
  }

  if (pills.length === 0) return <span className="text-ink-3">—</span>

  return (
    <div className="flex flex-wrap items-center gap-1">
      {pills.map((pill, i) => (
        <Fragment key={pill.key}>
          {i > 0 ? (
            <span aria-hidden className="text-ink-3">
              →
            </span>
          ) : null}
          <Pill status={pill.status}>{pill.label}</Pill>
        </Fragment>
      ))}
    </div>
  )
}

type EventsState =
  | { status: 'loading' }
  | { status: 'ready'; events: LeadEventRow[]; error: string | null }
  | { status: 'error'; message: string }

function ExecutionLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="underline underline-offset-2 hover:text-ink"
    >
      execution ↗
    </a>
  )
}

/**
 * Vertical event log for one lead: a continuous rail with a dot per event.
 * Consecutive events from the same workflow read as one block, captioned only
 * where the workflow changes — a lead's journey usually hands off 2–4 times.
 */
function Timeline({ state, nowMs }: { state: EventsState | undefined; nowMs: number }) {
  if (!state || state.status === 'loading') {
    return <div className="text-[12px] text-ink-3">Loading events…</div>
  }

  if (state.status === 'error') {
    return <div className="text-[12px] text-bad">Could not load events: {state.message}</div>
  }

  if (state.events.length === 0) {
    return (
      <div className="text-[12px] text-ink-3">
        {state.error ? `Could not load events: ${state.error}` : 'No events logged for this lead.'}
      </div>
    )
  }

  return (
    <div className="relative">
      {/* One rail behind every dot; captions sit clear of it. */}
      <span aria-hidden className="absolute bottom-2 left-[3.5px] top-2 w-px bg-line-strong" />

      {state.events.map((event, i) => {
        const red = String(event.status ?? '').trim().toLowerCase() === 'red'
        const bucket = text(event.bucket)
        const detail = text(event.detail)
        const newWorkflow = i === 0 || event.workflow !== state.events[i - 1].workflow

        return (
          <Fragment key={`${event.created_at ?? ''}-${event.checkpoint ?? ''}-${i}`}>
            {newWorkflow ? (
              <div className="relative pb-1 pl-4 pt-2.5 text-[11px] font-medium text-ink-3 first:pt-0">
                {humanize(event.workflow)}
              </div>
            ) : null}

            <div className="relative pb-1.5 pl-4">
              <span className="absolute left-0 top-[5px]">
                <StatusDot status={red ? 'red' : 'green'} size={8} />
              </span>

              <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
                <span className="text-ink" title={!red && detail ? detail : undefined}>
                  {checkpointLabel(event.checkpoint)}
                </span>
                {bucket && bucket !== '(none)' ? (
                  <span className="text-ink-3">({bucket})</span>
                ) : null}
                <span
                  className="tabular-nums text-ink-3"
                  title={formatIstDateTime(event.created_at)}
                >
                  {relativeFromTimestamp(event.created_at, nowMs)}
                </span>
              </div>

              {red ? (
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-bad">
                  {detail ? <span className="break-words">{detail}</span> : null}
                  {event.execution_url ? <ExecutionLink url={event.execution_url} /> : null}
                </div>
              ) : null}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * Tab 2 — one row per lead from monitor_lead_journey_enriched, read as a
 * tracking board: what state is this lead in, and is anything wrong with it.
 *
 * Every filter is resolved server-side and lives on the Dashboard, so search,
 * health, pipeline and time range all reach the whole view rather than the page
 * on screen. This component owns only the paging tail — page 1 arrives with the
 * snapshot, "Show more" appends from /api/leads. Expanding a row pulls that
 * lead's event log on demand.
 */
export default function LeadJourneys({
  leads,
  total,
  hasMore,
  pipelines,
  nowMs,
  params,
  onParamsChange,
  onPagedInChange,
  loading,
}: {
  leads: LeadRow[]
  /** Matches across the whole view; null when the count query failed. */
  total: number | null
  hasMore: boolean
  pipelines: string[]
  nowMs: number
  params: LeadListParams
  onParamsChange: (params: LeadListParams) => void
  /** Lets the Dashboard hold the 60s poll while pages are loaded. */
  onPagedInChange: (pagedIn: boolean) => void
  loading: boolean
}) {
  const [openPhone, setOpenPhone] = useState<string | null>(null)
  const [events, setEvents] = useState<Record<string, EventsState>>({})

  // Pages loaded past the snapshot's first page.
  const [extra, setExtra] = useState<LeadRow[]>([])
  const [more, setMore] = useState(hasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // A refresh replaces page 1 under us; drop the tail rather than show a list
  // stitched from two different snapshots.
  useEffect(() => {
    setExtra([])
    setMore(hasMore)
    setLoadError(null)
  }, [leads, hasMore])

  useEffect(() => onPagedInChange(extra.length > 0), [extra.length, onPagedInChange])

  const set = useCallback(
    (patch: Partial<LeadListParams>) => onParamsChange({ ...params, ...patch }),
    [params, onParamsChange],
  )

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    setLoadError(null)
    try {
      const offset = leads.length + extra.length
      const query = leadParamsToQuery(params, { offset: String(offset) })
      const res = await fetch(`${BASE_PATH}/api/leads?${query}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const page = (await res.json()) as LeadsPage
      setExtra((prev) => [...prev, ...(page.leads ?? [])])
      setMore(Boolean(page.hasMore))
      if (page.error) setLoadError(page.error)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMore(false)
    }
  }, [leads.length, extra.length, params])

  // Phones already fetched (or in flight) — the cache the spec asks for.
  const requested = useRef<Set<string>>(new Set())

  const toggleRow = useCallback((phone: string) => {
    setOpenPhone((current) => (current === phone ? null : phone))

    if (requested.current.has(phone)) return
    requested.current.add(phone)
    setEvents((prev) => ({ ...prev, [phone]: { status: 'loading' } }))

    fetch(`${BASE_PATH}/api/lead-events?phone=${encodeURIComponent(phone)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as LeadEventsPayload
      })
      .then((payload) =>
        setEvents((prev) => ({
          ...prev,
          [phone]: { status: 'ready', events: payload.events ?? [], error: payload.error ?? null },
        })),
      )
      .catch((err) => {
        // Drop it from the cache so re-expanding retries instead of re-showing the error.
        requested.current.delete(phone)
        setEvents((prev) => ({
          ...prev,
          [phone]: { status: 'error', message: err instanceof Error ? err.message : String(err) },
        }))
      })
  }, [])

  const pipelineOptions = useMemo(
    () => [
      { value: ALL_PIPELINES, label: 'All' },
      ...pipelines.map((name) => ({ value: name, label: name })),
    ],
    [pipelines],
  )

  /**
   * Health drives the badge and the sort. It no longer filters: the server
   * already did that, and re-filtering here would only hide rows the count in
   * the header has promised are there.
   */
  const rows = useMemo(
    () =>
      [...leads, ...extra]
        .map((lead) => ({ lead, health: leadHealth(lead, nowMs) }))
        .sort(
          (a, b) =>
            HEALTH_RANK[a.health.level] - HEALTH_RANK[b.health.level] ||
            timestampMs(b.lead.last_activity) - timestampMs(a.lead.last_activity),
        ),
    [leads, extra, nowMs],
  )

  // Only meaningful with no health filter on; otherwise the tally just restates it.
  const counts = useMemo(
    () => ({
      issues: rows.filter((r) => r.health.level === 'issue').length,
      stalled: rows.filter((r) => r.health.level === 'stalled').length,
    }),
    [rows],
  )

  const filtered = Boolean(params.q) || params.health !== 'all' || Boolean(params.pipeline)

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={params.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search name or phone…"
          className="hairline w-64 rounded-chip bg-bg px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
        />
        <Select
          label="Pipeline"
          value={params.pipeline}
          options={pipelineOptions}
          onChange={(pipeline) => set({ pipeline })}
        />
        <Select
          label="Health"
          value={params.health}
          options={HEALTH_OPTIONS}
          onChange={(health) => set({ health: health as LeadListParams['health'] })}
        />
        <Select
          label="Range"
          value={params.range}
          options={RANGE_OPTIONS}
          onChange={(range) => set({ range: range as LeadListParams['range'] })}
        />
        <span className="text-[11px] text-ink-3">
          {loading ? (
            'searching…'
          ) : (
            <>
              Showing {rows.length}
              {total !== null ? ` of ${total}` : ''}
              {/* The tally counts loaded rows, so say so rather than let it read
                  as a verdict on the whole result set. */}
              {!filtered && rows.length > 0
                ? ` · ${counts.issues} issue${counts.issues === 1 ? '' : 's'} · ${
                    counts.stalled
                  } stalled in view`
                : ''}
            </>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyNote>
          {params.q
            ? 'No lead matches that name or phone.'
            : filtered || params.range !== 'all'
              ? 'No lead matches these filters.'
              : 'No lead journeys yet.'}
        </EmptyNote>
      ) : (
        <div className="hairline overflow-x-auto rounded-card bg-bg">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="hairline-b bg-surface text-left">
                <th className="px-3 py-2 font-medium text-ink-2">Lead</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium text-ink-2">Health</th>
                <th className="w-full px-3 py-2 font-medium text-ink-2">Journey</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-ink-2">
                  Last activity
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lead, health }, rowIndex) => {
                const phone = String(lead.phone ?? `row-${rowIndex}`)
                const isOpen = openPhone === phone
                const dealId = text(lead.um_deal_id)

                return (
                  <Fragment key={phone}>
                    <tr
                      onClick={() => toggleRow(phone)}
                      className={[
                        'hairline-b cursor-pointer',
                        health.level === 'issue'
                          ? 'bg-bad-soft'
                          : isOpen
                            ? 'bg-surface'
                            : 'hover:bg-surface-2',
                      ].join(' ')}
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-ink">{leadDisplayName(lead)}</div>
                        <div className="font-mono text-[11px] text-ink-3">{phone}</div>
                      </td>

                      <td className="whitespace-nowrap px-3 py-1.5">
                        <Pill status={HEALTH_TINT[health.level]} strong title={health.detail || undefined}>
                          {health.label}
                        </Pill>
                      </td>

                      <td className="px-3 py-1.5">
                        <Journey lead={lead} health={health} />
                      </td>

                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-ink-2">
                        {relativeFromTimestamp(lead.last_activity, nowMs)}
                      </td>
                    </tr>

                    {isOpen ? (
                      <tr className="hairline-b bg-surface">
                        <td colSpan={COLUMN_COUNT} className="px-3 py-2.5">
                          <Timeline state={events[phone]} nowMs={nowMs} />

                          <div className="hairline-t mt-2.5 flex flex-wrap gap-x-8 gap-y-2.5 pt-2.5">
                            <Detail label="HubSpot">
                              {dealId ? (
                                <a
                                  href={`${HUBSPOT_RECORD_URL}/${dealId}`}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  onClick={(e) => e.stopPropagation()}
                                  className="underline underline-offset-2 hover:text-ink-2"
                                >
                                  Open deal ↗
                                </a>
                              ) : (
                                <span className="text-ink-3">No deal id</span>
                              )}
                            </Detail>
                            <Detail label="Current campaign">
                              {text(lead.current_campaign) ?? '—'}
                            </Detail>
                            <Detail label="Demo scheduled">
                              {lead.demo_scheduled_at ? (
                                <span className="tabular-nums">
                                  {formatIstDateTime(lead.demo_scheduled_at)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </Detail>
                            <Detail label="Demo outcome">{text(lead.demo_outcome) ?? '—'}</Detail>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {loadError ? (
        <div className="mt-2 text-[11px] text-bad">Could not load more: {loadError}</div>
      ) : null}

      {more ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="hairline mt-2 rounded-chip px-2.5 py-1 text-[12px] text-ink-2 hover:bg-surface disabled:text-ink-3"
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}
