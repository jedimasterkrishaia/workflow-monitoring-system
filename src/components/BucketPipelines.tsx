'use client'

import { Fragment, useState } from 'react'

import type { Pipeline, PipelineRow, StageCell } from '@/lib/pipelines'
import { severityAccent, severityInk, type Severity } from '@/lib/severity'

/**
 * Overview tab — one card per workflow, its stages laid out in journey order.
 *
 * Replaces the flat checkpoint chip grid, which averaged buckets together and
 * so let one dead segment hide behind a healthy total, and gave no sense of
 * where in the journey a failure sat.
 */

/**
 * Counts stay neutral when healthy — and when minor, which is the point of the
 * tier. Colouring every good number green makes the one amber number impossible
 * to spot, which defeats the point.
 */
function countInk(severity: Severity): string {
  switch (severity) {
    case 'failing':
      return 'text-bad'
    case 'warning':
      return 'text-warn'
    case 'idle':
      return 'text-ink-3'
    default:
      return 'text-ink'
  }
}

/**
 * The `3✕` marker follows the tier too. A stage that dropped one event out of
 * two hundred is a footnote, and a red numeral is not how you write a footnote.
 */
function flagInk(severity: Severity): string {
  switch (severity) {
    case 'failing':
      return 'text-bad'
    case 'warning':
      return 'text-warn'
    default:
      return 'text-ink-2'
  }
}

function StageBody({ stage, open }: { stage: StageCell; open: boolean }) {
  return (
    <>
      <span className={stage.empty ? 'text-ink-3' : 'text-ink-2'}>{stage.label}</span>
      {stage.empty ? (
        <span className="text-ink-3">—</span>
      ) : (
        <span className={['font-medium tabular-nums', countInk(stage.severity)].join(' ')}>
          {stage.greenToday}
        </span>
      )}
      {stage.redToday > 0 ? (
        <span className={['font-medium tabular-nums', flagInk(stage.severity)].join(' ')}>
          {stage.redToday}✕
        </span>
      ) : null}
      {stage.buckets.length > 0 ? <span className="text-ink-3">{open ? '▾' : '▸'}</span> : null}
    </>
  )
}

function Row({
  row,
  rowId,
  chips,
  expanded,
  onToggle,
}: {
  row: PipelineRow
  /** Namespaces the expand state, so `wa_send` in two workflows stays distinct. */
  rowId: string
  /** Chip layout for workflows with no configured journey — no arrows. */
  chips: boolean
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
}) {
  const idOf = (stage: StageCell) => `${rowId}:${stage.key}`
  const openStages = row.stages.filter((s) => s.buckets.length > 0 && expanded[idOf(s)])

  return (
    <div className="hairline-b px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {row.label ? (
          <span
            className={[
              'w-32 shrink-0 truncate text-[11px] text-ink-2',
              row.mono ? 'font-mono' : '',
            ].join(' ')}
            title={row.label}
          >
            {row.label}
          </span>
        ) : null}

        {/* gap-x-2.5 lands on both sides of every → , so the arrows get air without
            needing padding of their own. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px]">
          {row.stages.map((stage, i) => {
            const expandable = stage.buckets.length > 0
            const open = Boolean(expanded[idOf(stage)])
            const title = `${stage.key} — ${stage.line}`

            const inner = expandable ? (
              <button
                type="button"
                onClick={() => onToggle(idOf(stage))}
                title={title}
                className={[
                  'inline-flex items-baseline gap-1 rounded-chip hover:bg-surface-2',
                  stage.optional ? 'opacity-60' : '',
                ].join(' ')}
              >
                <StageBody stage={stage} open={open} />
              </button>
            ) : (
              <span
                title={title}
                className={[
                  'inline-flex items-baseline gap-1',
                  chips ? 'hairline rounded-chip bg-surface px-2 py-0.5' : '',
                  stage.optional ? 'opacity-60' : '',
                ].join(' ')}
              >
                <StageBody stage={stage} open={open} />
              </span>
            )

            return (
              <Fragment key={stage.key}>
                {i > 0 && !chips ? (
                  <span aria-hidden className="text-ink-3">
                    →
                  </span>
                ) : null}
                {inner}
              </Fragment>
            )
          })}
        </div>

        {row.stamped ? (
          <span
            className={[
              'shrink-0 text-[11px] tabular-nums',
              row.stamped.short ? 'text-warn' : 'text-ink-3',
            ].join(' ')}
            title={`log_append stamped ${row.stamped.count} of ${row.stamped.sends} sends today`}
          >
            stamped {row.stamped.count}
          </span>
        ) : null}

        <span
          className={['w-32 shrink-0 truncate text-right text-[11px]', severityInk(row.severity)].join(
            ' ',
          )}
          title={row.line}
        >
          {row.line}
        </span>
      </div>

      {openStages.map((stage) => (
        <div key={stage.key} className="hairline mt-2 overflow-hidden rounded-chip bg-surface sm:ml-32">
          {stage.buckets.map((bucket) => (
            <div
              key={bucket.key}
              className="hairline-b flex items-center gap-2 px-2.5 py-1.5 text-[11px] last:border-b-0"
            >
              <span className="mr-auto truncate font-mono text-ink">{bucket.label}</span>
              <span className={['tabular-nums', countInk(bucket.severity)].join(' ')}>
                {bucket.greenToday}
              </span>
              {bucket.redToday > 0 ? (
                <span className={['font-medium tabular-nums', flagInk(bucket.severity)].join(' ')}>
                  {bucket.redToday}✕
                </span>
              ) : null}
              <span className={['w-28 text-right', severityInk(bucket.severity)].join(' ')}>
                {bucket.line}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function BucketPipelines({ pipelines }: { pipelines: Pipeline[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (pipelines.length === 0) {
    return (
      <div className="hairline-dashed rounded-card px-3 py-4 text-[12px] text-ink-3">
        No workflows reporting yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pipelines.map((pipeline) => (
        <div
          key={pipeline.workflow}
          className={['hairline rounded-card bg-bg', severityAccent(pipeline.severity)].join(' ')}
        >
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-medium text-ink" title={pipeline.workflow}>
              {pipeline.label}
            </span>
            <span className={['ml-auto text-[11px]', severityInk(pipeline.severity)].join(' ')}>
              {pipeline.line}
            </span>
          </div>

          {pipeline.rows.length === 0 ? (
            <div className="px-4 py-3 text-[11px] text-ink-3">No checkpoints reporting yet.</div>
          ) : (
            pipeline.rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                rowId={`${pipeline.workflow}:${row.key}`}
                chips={pipeline.kind === 'chips'}
                expanded={expanded}
                onToggle={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
              />
            ))
          )}
        </div>
      ))}
    </div>
  )
}
