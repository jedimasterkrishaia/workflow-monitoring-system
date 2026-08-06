import { humanize } from '@/lib/aggregate'
import { istNaiveToMs } from '@/lib/time'
import type { BatchIntegrityRow, MissedReminderRow } from '@/lib/types'

/**
 * Batch integrity — the two things that leave no red behind.
 *
 * Every other section of this dashboard reports on work that ran and failed. A
 * dispatch loop that died before dispatching, and a reminder that came due and
 * was never attempted, both fail *silently*: nothing stamps a checkpoint, so
 * nothing turns red and the workflow tile stays green. These two views are the
 * only evidence such a batch existed at all, which is why they sit at the top
 * of the flag log rather than folded into the feed.
 */

/** Leads shown in the missed-reminder panel; one lead can miss several actions. */
export const MISSED_REMINDER_GROUPS = 20

/** The n8n template placeholder these loops stamp instead of their own name. */
const PLACEHOLDER_WORKFLOW = 'WORKFLOW_TAG'

export type DeadBatch = BatchIntegrityRow & {
  /** Parsed from the naive IST column, for ordering. */
  startedMs: number | null
  /** The n8n workflow id, which is what actually tells two ladders apart. */
  n8nWorkflowId: string | null
  label: string
}

function n8nWorkflowId(url: string | null | undefined): string | null {
  const match = /\/workflow\/([^/?#]+)/.exec(url ?? '')
  return match ? match[1] : null
}

/**
 * What to call a dead batch.
 *
 * `workflow` is a literal `WORKFLOW_TAG` on every row the view has ever
 * produced — the loops interpolate the placeholder, not their name — so it
 * cannot be shown as-is. The honest fallback is a generic label plus the n8n
 * workflow id in the meta line, which does distinguish the confirm ladder from
 * the reminder one. If the upstream tag is ever fixed, the real name wins.
 */
function batchLabel(row: BatchIntegrityRow): string {
  const name = (row.workflow ?? '').trim()
  return name && name !== PLACEHOLDER_WORKFLOW ? humanize(name) : 'Batch loop'
}

/**
 * One entry per dead execution, newest first.
 *
 * The view carries one row per stamped checkpoint, so a single execution
 * repeats two or three times (6 of 13 executions were duplicated in a routine
 * sample). Collapsing on execution_id is what makes the count read as "batches
 * that died" rather than "log lines about batches that died".
 */
export function dedupeDeadBatches(rows: BatchIntegrityRow[]): DeadBatch[] {
  const byExecution = new Map<string, DeadBatch>()

  for (const row of rows) {
    // Falls back to the start stamp so a row with no execution id still counts
    // once rather than collapsing every such row into one entry.
    const key = (row.execution_id ?? '').trim() || `${row.workflow ?? ''}|${row.batch_started_ist ?? ''}`
    if (byExecution.has(key)) continue

    byExecution.set(key, {
      ...row,
      startedMs: istNaiveToMs(row.batch_started_ist),
      n8nWorkflowId: n8nWorkflowId(row.execution_url),
      label: batchLabel(row),
    })
  }

  return [...byExecution.values()].sort((a, b) => (b.startedMs ?? 0) - (a.startedMs ?? 0))
}

export type MissedAction = {
  action: string | null
  minsOverdue: number | null
  dueMs: number | null
}

export type MissedReminderGroup = {
  phone: string
  name: string | null
  /** The lead's demo, as the naive IST string the view stores. */
  meetingIst: string | null
  actions: MissedAction[]
  /** Most recent due time in the group — what "newest first" orders on. */
  latestDueMs: number
}

function toMinutes(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Missed reminders collapsed to one entry per lead.
 *
 * Grouping is the point: a lead whose demo came and went typically misses the
 * whole ladder at once, and four separate lines for one lead read as four
 * problems. One line naming four overdue actions reads as what it is.
 */
export function groupMissedReminders(
  rows: MissedReminderRow[],
  limit = MISSED_REMINDER_GROUPS,
): MissedReminderGroup[] {
  const byPhone = new Map<string, MissedReminderGroup>()

  for (const row of rows) {
    const phone = (row.phone ?? '').trim()
    if (!phone) continue

    let group = byPhone.get(phone)
    if (!group) {
      group = {
        phone,
        name: row.name,
        // A lead has one demo, so the first row's meeting stands for the group.
        meetingIst: row.meeting_ist,
        actions: [],
        latestDueMs: 0,
      }
      byPhone.set(phone, group)
    }

    const dueMs = istNaiveToMs(row.due_ist)
    group.actions.push({ action: row.action, minsOverdue: toMinutes(row.mins_overdue), dueMs })
    if (dueMs !== null) group.latestDueMs = Math.max(group.latestDueMs, dueMs)
  }

  for (const group of byPhone.values()) {
    // Most overdue first within a lead — that is the rung that broke earliest.
    group.actions.sort((a, b) => (b.minsOverdue ?? 0) - (a.minsOverdue ?? 0))
  }

  return [...byPhone.values()].sort((a, b) => b.latestDueMs - a.latestDueMs).slice(0, limit)
}
