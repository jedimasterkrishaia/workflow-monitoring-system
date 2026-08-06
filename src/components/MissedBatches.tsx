'use client'

import { useMemo } from 'react'

import { humanize } from '@/lib/aggregate'
import { dedupeDeadBatches, groupMissedReminders } from '@/lib/batches'
import { compactAge, formatIstNaive } from '@/lib/time'
import type { BatchIntegrityRow, MissedReminderRow } from '@/lib/types'
import { ExecutionLink, Pill, StatusDot } from '@/components/ui'

/**
 * The top of the flag log — failures that leave no red behind.
 *
 * The feed below this can only show work that ran and failed. A dispatch loop
 * that died before dispatching, and a reminder that came due and was never
 * attempted, both stamp nothing at all: the workflow tile stays green and the
 * feed stays quiet while leads go untouched. So these are pinned above the hard
 * errors rather than sorted in among them.
 *
 * Renders nothing at all when both are clear — an empty state here would be a
 * permanent fixture claiming credit for a normal day.
 */
export default function MissedBatches({
  batches,
  missed,
}: {
  batches: BatchIntegrityRow[]
  missed: MissedReminderRow[]
}) {
  const dead = useMemo(() => dedupeDeadBatches(batches), [batches])
  const groups = useMemo(() => groupMissedReminders(missed), [missed])

  if (dead.length === 0 && groups.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">
        Missed &amp; broken batches
      </h2>

      {dead.length > 0 ? (
        <div className="hairline accent accent-bad rounded-card bg-bg">
          <div className="hairline-b flex items-baseline gap-2 bg-surface px-4 py-2.5">
            <span className="text-[12px] font-semibold text-bad">
              Batch loop died · last 48h
            </span>
            <span className="text-[11px] tabular-nums text-ink-2">{dead.length}</span>
          </div>

          {dead.map((row, i) => (
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

          {groups.map((group) => (
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
        </div>
      ) : null}
    </div>
  )
}
