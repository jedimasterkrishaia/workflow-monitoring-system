'use client'

import { useMemo, useState } from 'react'

import { humanize } from '@/lib/aggregate'
import { dedupeDeadBatches, groupMissedReminders } from '@/lib/batches'
import { compactAge, formatIstNaive } from '@/lib/time'
import type {
  BatchIntegrityRow,
  CoachIntegrityRow,
  MissedReminderRow,
  MissedTranscriptRow,
} from '@/lib/types'
import { ExecutionLink, Pill, StatusDot } from '@/components/ui'

/**
 * The top of the flag log — failures that leave no red behind.
 *
 * The feed below this can only show work that ran and failed. A dispatch loop
 * that died before dispatching, a coach run that finished without stamping
 * every required step, a reminder that came due and was never attempted, and a
 * demo whose transcript never arrived all stamp nothing at all: the workflow
 * tile stays green and the feed stays quiet while leads go untouched. So these
 * four are pinned above the hard errors rather than sorted in among them.
 *
 * Renders nothing at all when every block is clear — an empty state here would
 * be a permanent fixture claiming credit for a normal day.
 */

/** Rows shown before a block collapses behind "Show more" — the header still states the true total. */
const PAGE_SIZE = 5

function hoursSinceDemo(value: number | string | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Footer toggle for a capped block. Renders nothing once everything already fits on screen. */
function ShowMoreRow({
  total,
  expanded,
  onToggle,
}: {
  total: number
  expanded: boolean
  onToggle: () => void
}) {
  if (total <= PAGE_SIZE) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      className="hairline-t block w-full px-4 py-2 text-left text-[11px] text-ink-2 hover:bg-surface"
    >
      {expanded ? 'Show less' : `Show ${total - PAGE_SIZE} more`}
    </button>
  )
}

export default function MissingAndBroken({
  batches,
  missed,
  brokenCoach,
  missedTranscripts,
}: {
  batches: BatchIntegrityRow[]
  missed: MissedReminderRow[]
  brokenCoach: CoachIntegrityRow[]
  missedTranscripts: MissedTranscriptRow[]
}) {
  const dead = useMemo(() => dedupeDeadBatches(batches), [batches])
  const groups = useMemo(() => groupMissedReminders(missed), [missed])

  const [showAllDead, setShowAllDead] = useState(false)
  const [showAllCoach, setShowAllCoach] = useState(false)
  const [showAllMissed, setShowAllMissed] = useState(false)
  const [showAllTranscripts, setShowAllTranscripts] = useState(false)

  if (
    dead.length === 0 &&
    brokenCoach.length === 0 &&
    groups.length === 0 &&
    missedTranscripts.length === 0
  ) {
    return null
  }

  const visibleDead = showAllDead ? dead : dead.slice(0, PAGE_SIZE)
  const visibleCoach = showAllCoach ? brokenCoach : brokenCoach.slice(0, PAGE_SIZE)
  const visibleGroups = showAllMissed ? groups : groups.slice(0, PAGE_SIZE)
  const visibleTranscripts = showAllTranscripts
    ? missedTranscripts
    : missedTranscripts.slice(0, PAGE_SIZE)

  return (
    <div className="space-y-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">Missing &amp; broken</h2>

      {dead.length > 0 ? (
        <div className="hairline accent accent-bad rounded-card bg-bg">
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-semibold text-bad">
              Batch loop died · last 48h
            </span>
            <span className="text-[11px] tabular-nums text-ink-2">{dead.length}</span>
          </div>

          {visibleDead.map((row, i) => (
            <div
              key={`dead-${row.execution_id ?? i}-${i}`}
              className="hairline-b flex items-start gap-2.5 px-4 py-3 text-[13px] last:border-b-0"
            >
              <span className="mt-[5px]">
                <StatusDot status="red" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-ink">{row.label}</span>
                  {row.due_detail ? (
                    <>
                      <span className="text-ink-3">—</span>
                      <span className="text-ink">{row.due_detail}</span>
                    </>
                  ) : null}
                  <span className="text-ink-3">·</span>
                  <span className="text-bad">never completed</span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-2">
                  <span>started {formatIstNaive(row.batch_started_ist)}</span>
                  {/* Every row claims workflow `WORKFLOW_TAG`, so the n8n id is
                      the only thing separating the confirm and reminder ladders. */}
                  {row.n8nWorkflowId ? (
                    <span className="font-mono text-ink-3">{row.n8nWorkflowId}</span>
                  ) : null}
                  {row.execution_url ? <ExecutionLink url={row.execution_url} /> : null}
                </div>
              </div>
            </div>
          ))}

          <ShowMoreRow
            total={dead.length}
            expanded={showAllDead}
            onToggle={() => setShowAllDead((v) => !v)}
          />
        </div>
      ) : null}

      {brokenCoach.length > 0 ? (
        <div className="hairline accent accent-bad rounded-card bg-bg">
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-semibold text-bad">
              Coach run incomplete · last 48h
            </span>
            <span className="text-[11px] tabular-nums text-ink-2">{brokenCoach.length}</span>
          </div>

          {visibleCoach.map((row, i) => (
            <div
              key={`coach-${row.execution_id ?? i}-${i}`}
              className="hairline-b flex items-start gap-2.5 px-4 py-3 text-[13px] last:border-b-0"
            >
              <span className="mt-[5px]">
                <StatusDot status="red" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-ink">Coach run</span>
                  <span className="text-ink-3">—</span>
                  <span className="text-ink">
                    missing {(row.missing_required ?? []).join(', ') || 'required steps'}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-2">
                  <span>started {formatIstNaive(row.started_ist)}</span>
                  {row.execution_url ? <ExecutionLink url={row.execution_url} /> : null}
                </div>
              </div>
            </div>
          ))}

          <ShowMoreRow
            total={brokenCoach.length}
            expanded={showAllCoach}
            onToggle={() => setShowAllCoach((v) => !v)}
          />
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="hairline accent accent-warn rounded-card bg-bg">
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-semibold text-warn">Missed reminders</span>
            <span className="text-[11px] tabular-nums text-ink-2">
              {groups.length} lead{groups.length === 1 ? '' : 's'}
            </span>
          </div>

          {visibleGroups.map((group) => (
            <div
              key={group.phone}
              className="hairline-b flex items-start gap-2.5 px-4 py-3 text-[13px] last:border-b-0"
            >
              <span className="mt-[5px]">
                <StatusDot status="amber" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-ink">
                    {group.name?.trim() || 'Unknown lead'}
                  </span>
                  <span className="font-mono text-[11px] text-ink-2">{group.phone}</span>
                  {group.meetingIst ? (
                    <>
                      <span className="text-ink-3">·</span>
                      <span className="text-ink-2">
                        demo {formatIstNaive(group.meetingIst)}
                      </span>
                    </>
                  ) : null}
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.actions.map((action, i) => (
                    <Pill key={`${action.action ?? 'action'}-${i}`} status="amber">
                      {humanize(action.action)}
                      {action.minsOverdue === null ? null : (
                        <span className="ml-1 tabular-nums opacity-80">
                          {compactAge(action.minsOverdue)} late
                        </span>
                      )}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <ShowMoreRow
            total={groups.length}
            expanded={showAllMissed}
            onToggle={() => setShowAllMissed((v) => !v)}
          />
        </div>
      ) : null}

      {missedTranscripts.length > 0 ? (
        <div className="hairline accent accent-warn rounded-card bg-bg">
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-semibold text-warn">Missed transcripts</span>
            <span className="text-[11px] tabular-nums text-ink-2">
              {missedTranscripts.length}
            </span>
          </div>

          {visibleTranscripts.map((row, i) => {
            const hours = hoursSinceDemo(row.hours_since_demo)
            return (
              <div
                key={`transcript-${row.phone ?? i}-${i}`}
                className="hairline-b flex items-start gap-2.5 px-4 py-3 text-[13px] last:border-b-0"
              >
                <span className="mt-[5px]">
                  <StatusDot status="amber" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium text-ink">
                      {row.lead_name?.trim() || 'Unknown lead'}
                    </span>
                    {row.gm ? (
                      <>
                        <span className="text-ink-3">·</span>
                        <span className="text-ink-2">{row.gm}</span>
                      </>
                    ) : null}
                    <span className="text-ink-3">·</span>
                    <span className="text-warn">demo conducted — transcript missing</span>
                    {row.hubspot_stage ? (
                      <Pill status="idle">{row.hubspot_stage}</Pill>
                    ) : null}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-2">
                    <span>demo {formatIstNaive(row.demo_ist)}</span>
                    {hours === null ? null : (
                      <span className="tabular-nums">{hours.toFixed(1)}h since demo</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          <ShowMoreRow
            total={missedTranscripts.length}
            expanded={showAllTranscripts}
            onToggle={() => setShowAllTranscripts((v) => !v)}
          />
        </div>
      ) : null}
    </div>
  )
}
