'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import MissedBatches from '@/components/MissedBatches'
import { humanize } from '@/lib/aggregate'
import { SEVERITY_RANK, type Severity } from '@/lib/severity'
import { formatIstDateTime, relativeFromTimestamp } from '@/lib/time'
import type { BatchIntegrityRow, MissedReminderRow, RedRow, RedsPage } from '@/lib/types'
import { EmptyNote, ExecutionLink, Select, StatusDot } from '@/components/ui'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const ALL = '__all__'

const TIME_WINDOWS: { value: string; label: string; ms: number | null }[] = [
  { value: ALL, label: 'All time', ms: null },
  { value: '1h', label: 'Last hour', ms: HOUR_MS },
  { value: '24h', label: 'Last 24h', ms: DAY_MS },
  { value: '7d', label: 'Last 7d', ms: 7 * DAY_MS },
]

function timestampMs(row: RedRow): number | null {
  if (!row.created_at) return null
  const t = new Date(row.created_at).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * A run of identical failures, collapsed to one line.
 *
 * Only *consecutive* rows collapse: a checkpoint that failed 30 times in a row
 * is one incident, but the same checkpoint failing again after something else
 * failed in between is a second one, and merging those would hide the gap.
 */
type Group = {
  key: string
  rows: RedRow[]
  /** Severity of the checkpoint this group belongs to, for ordering. */
  severity: Severity
  latestMs: number
}

function groupKey(row: RedRow): string {
  return `${row.workflow ?? ''}|${row.checkpoint ?? ''}|${row.detail ?? ''}`
}

function collapse(rows: RedRow[], severityOf: (row: RedRow) => Severity): Group[] {
  const groups: Group[] = []

  for (const row of rows) {
    const key = groupKey(row)
    const last = groups[groups.length - 1]

    if (last && last.key === key) {
      last.rows.push(row)
      last.latestMs = Math.max(last.latestMs, timestampMs(row) ?? 0)
      continue
    }

    groups.push({
      key,
      rows: [row],
      severity: severityOf(row),
      latestMs: timestampMs(row) ?? 0,
    })
  }

  return groups
}

function RedLine({
  row,
  nowMs,
  count,
  onClick,
  open,
}: {
  row: RedRow
  nowMs: number
  /** >1 renders the ×N collapse marker and makes the line expandable. */
  count: number
  onClick?: () => void
  open?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={[
        'flex items-start gap-2.5 px-4 py-3 text-[13px]',
        onClick ? 'cursor-pointer hover:bg-surface-2' : '',
      ].join(' ')}
    >
      <span className="mt-[5px]">
        <StatusDot status="red" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium text-ink">{humanize(row.workflow)}</span>
          <span className="text-ink-3">·</span>
          <span className="text-ink-2">
            {humanize(row.checkpoint)}
            {row.bucket && row.bucket !== '(none)' ? (
              <span className="text-ink-3"> / {row.bucket}</span>
            ) : null}
          </span>
          {row.detail ? (
            <>
              <span className="text-ink-3">—</span>
              <span className="text-ink">{row.detail}</span>
            </>
          ) : null}
          {count > 1 ? (
            <span className="ml-0.5 rounded-chip bg-surface px-1.5 text-[11px] font-medium tabular-nums text-ink-2">
              ×{count}
            </span>
          ) : null}
          {count > 1 ? <span className="text-ink-3">{open ? '▾' : '▸'}</span> : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-2">
          <span title={formatIstDateTime(row.created_at)}>
            {relativeFromTimestamp(row.created_at, nowMs)}
          </span>
          {row.phone ? <span className="font-mono">{row.phone}</span> : null}
          {row.hubspot_deal_id ? <span>deal {row.hubspot_deal_id}</span> : null}
          {row.execution_url ? <ExecutionLink url={row.execution_url} /> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Tab 3 — the flag log.
 *
 * Three tiers, in order of how easily they are missed. Batch integrity sits at
 * the very top because a batch that never ran leaves no red behind to find at
 * all. Hard errors come next, queried separately server-side and pinned: they
 * are the thing you must not be able to filter, sort, or paginate away, so they
 * neither collapse nor take part in the ordering below. The feed itself is last.
 */
export default function RedsFeed({
  reds,
  hardErrors,
  deadBatches,
  missedReminders,
  hasMore,
  nowMs,
  severityByCheckpoint,
}: {
  reds: RedRow[]
  hardErrors: RedRow[]
  deadBatches: BatchIntegrityRow[]
  missedReminders: MissedReminderRow[]
  hasMore: boolean
  nowMs: number
  /** `workflow|checkpoint` → severity, so the feed can order by it. */
  severityByCheckpoint: Map<string, Severity>
}) {
  const [workflow, setWorkflow] = useState(ALL)
  const [checkpoint, setCheckpoint] = useState(ALL)
  const [timeWindow, setTimeWindow] = useState(ALL)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  // Pages loaded past the snapshot's first page.
  const [extra, setExtra] = useState<RedRow[]>([])
  const [more, setMore] = useState(hasMore)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // A refresh replaces page 1 under us; drop the tail rather than show a feed
  // stitched from two different snapshots.
  useEffect(() => {
    setExtra([])
    setMore(hasMore)
  }, [reds, hasMore])

  const loadMore = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const offset = reds.length + extra.length
      const res = await fetch(`/api/reds?offset=${offset}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const page = (await res.json()) as RedsPage
      setExtra((prev) => [...prev, ...(page.reds ?? [])])
      setMore(Boolean(page.hasMore))
      if (page.error) setLoadError(page.error)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [reds.length, extra.length])

  const pinnedIds = useMemo(() => new Set(hardErrors.map((r) => r.id)), [hardErrors])

  const loaded = useMemo(
    () => [...reds, ...extra].filter((row) => !pinnedIds.has(row.id)),
    [reds, extra, pinnedIds],
  )

  const workflowOptions = useMemo(() => {
    const names = new Set<string>()
    for (const row of loaded) if (row.workflow) names.add(row.workflow)
    return [
      { value: ALL, label: 'All' },
      ...[...names].sort().map((n) => ({ value: n, label: humanize(n) })),
    ]
  }, [loaded])

  // Checkpoints narrow to the selected workflow — the cross product is mostly empty.
  const checkpointOptions = useMemo(() => {
    const names = new Set<string>()
    for (const row of loaded) {
      if (workflow !== ALL && row.workflow !== workflow) continue
      if (row.checkpoint) names.add(row.checkpoint)
    }
    return [
      { value: ALL, label: 'All' },
      ...[...names].sort().map((n) => ({ value: n, label: humanize(n) })),
    ]
  }, [loaded, workflow])

  const filtered = useMemo(() => {
    const span = TIME_WINDOWS.find((w) => w.value === timeWindow)?.ms ?? null
    return loaded.filter((row) => {
      if (workflow !== ALL && row.workflow !== workflow) return false
      if (checkpoint !== ALL && row.checkpoint !== checkpoint) return false
      if (span !== null) {
        const t = timestampMs(row)
        if (t === null || nowMs - t > span) return false
      }
      return true
    })
  }, [loaded, workflow, checkpoint, timeWindow, nowMs])

  const groups = useMemo(() => {
    const severityOf = (row: RedRow): Severity =>
      severityByCheckpoint.get(`${row.workflow ?? ''}|${row.checkpoint ?? ''}`) ?? 'warning'

    return collapse(filtered, severityOf).sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.latestMs - a.latestMs,
    )
  }, [filtered, severityByCheckpoint])

  // A checkpoint choice can go stale when the workflow filter changes under it.
  const checkpointValue = checkpointOptions.some((o) => o.value === checkpoint) ? checkpoint : ALL

  return (
    <div className="space-y-5">
      <MissedBatches batches={deadBatches} missed={missedReminders} />

      {hardErrors.length > 0 ? (
        <div className="hairline accent accent-bad rounded-card bg-bg">
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-semibold text-bad">Hard errors · last 24h</span>
            <span className="text-[11px] tabular-nums text-ink-2">{hardErrors.length}</span>
          </div>
          {hardErrors.map((row, i) => (
            <div key={`hard-${row.id ?? i}-${i}`} className="hairline-b last:border-b-0">
              <RedLine row={row} nowMs={nowMs} count={1} />
            </div>
          ))}
        </div>
      ) : (
        <div className="hairline rounded-card bg-surface px-4 py-3 text-[12px] text-ink-2">
          No hard errors in the last 24h.
        </div>
      )}

      <div>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <Select
            label="Workflow"
            value={workflow}
            options={workflowOptions}
            onChange={(v) => {
              setWorkflow(v)
              setCheckpoint(ALL)
            }}
          />
          <Select
            label="Checkpoint"
            value={checkpointValue}
            options={checkpointOptions}
            onChange={setCheckpoint}
          />
          <Select label="Time" value={timeWindow} options={TIME_WINDOWS} onChange={setTimeWindow} />
          <span className="text-[11px] text-ink-3">
            {groups.length === filtered.length
              ? `${filtered.length} red${filtered.length === 1 ? '' : 's'}`
              : `${filtered.length} reds in ${groups.length} group${groups.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyNote>
            {loaded.length === 0
              ? 'Nothing red in the feed — pipeline is clean.'
              : 'No reds match these filters.'}
          </EmptyNote>
        ) : (
          <div className="hairline overflow-hidden rounded-card bg-bg">
            {groups.map((group, i) => {
              const id = `${group.key}-${i}`
              const open = openGroup === id
              const [first] = group.rows

              return (
                <div key={id} className="hairline-b last:border-b-0">
                  <RedLine
                    row={first}
                    nowMs={nowMs}
                    count={group.rows.length}
                    open={open}
                    onClick={
                      group.rows.length > 1 ? () => setOpenGroup(open ? null : id) : undefined
                    }
                  />

                  {open ? (
                    <div className="hairline-t bg-surface">
                      {group.rows.map((row, j) => (
                        <div
                          key={`${row.id ?? 'row'}-${j}`}
                          className="hairline-b flex flex-wrap items-center gap-x-2 px-4 py-1.5 pl-10 text-[11px] text-ink-2 last:border-b-0"
                        >
                          <span className="tabular-nums" title={formatIstDateTime(row.created_at)}>
                            {formatIstDateTime(row.created_at)}
                          </span>
                          {row.phone ? <span className="font-mono">{row.phone}</span> : null}
                          {row.hubspot_deal_id ? <span>deal {row.hubspot_deal_id}</span> : null}
                          {row.execution_url ? <ExecutionLink url={row.execution_url} /> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {loadError ? (
          <div className="mt-2 text-[11px] text-bad">Could not load more: {loadError}</div>
        ) : null}

        {more ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="hairline mt-2 rounded-chip px-2.5 py-1 text-[12px] text-ink-2 hover:bg-surface disabled:text-ink-3"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
