import { rollup, type Severity } from '@/lib/severity'
import type { BucketRow, OverviewRow } from '@/lib/types'

/**
 * Pure roll-up helpers shared by server and client rendering.
 * No Supabase imports here — this module is safe in client components.
 */

/** Dot/pill palette. Workflow health uses Severity (see lib/severity) instead. */
export type Status = 'green' | 'amber' | 'red' | 'idle'

/** GM calendar slots are expected to refresh continuously (spec §Section 1). */
export const GM_STALE_MINUTES = 5

/**
 * Display order only. The workflow list itself is derived from monitor_overview,
 * so a new workflow shows up without a code change and a retired one disappears;
 * names not listed here sort alphabetically after the ones that are.
 */
export const KNOWN_WORKFLOW_ORDER = [
  'rh_meetings',
  'first_touch',
  'ai_sdr',
  'scheduler',
  'confirm_dispatch',
  'reminder_dispatch',
  'welcome_email',
]

/**
 * Checkpoints a dispatch batch loop stamps about itself rather than about a
 * lead. They report loop bookkeeping — what came due, whether the loop finished
 * — so they belong in the batch-integrity panel on the flag log, not in the
 * lead-touch surfaces.
 */
export const SYSTEM_CHECKPOINTS = new Set(['batch_due', 'batch_done'])

/**
 * Drops the system checkpoints from an overview/bucket set.
 *
 * Applied to the whole payload rather than per widget, because these rows carry
 * a workflow of literal `WORKFLOW_TAG` — the n8n placeholder the loops never
 * substitute — and that pseudo-workflow has no other checkpoints. Filtering
 * only the pipelines would leave a phantom "WORKFLOW TAG" tile in Workflows
 * sitting above an empty pipeline card.
 */
export function withoutSystemCheckpoints<T extends { checkpoint: string }>(rows: T[]): T[] {
  return rows.filter((row) => !SYSTEM_CHECKPOINTS.has(row.checkpoint))
}

const ACRONYMS = new Set(['rh', 'ai', 'sdr', 'gm', 'wa', 'um', 't30', 't10', 'id'])

/** `rh_meetings` → `RH meetings`. Names that already look human are left alone. */
export function humanize(name: string | null | undefined): string {
  if (!name) return '—'
  if (!/^[a-z0-9_]+$/.test(name)) return name
  const words = name.split('_').filter(Boolean)
  return words
    .map((word, i) => {
      if (ACRONYMS.has(word)) return word.toUpperCase()
      if (i === 0) return word.charAt(0).toUpperCase() + word.slice(1)
      return word
    })
    .join(' ')
}

export function sortWorkflows(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ia = KNOWN_WORKFLOW_ORDER.indexOf(a)
    const ib = KNOWN_WORKFLOW_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
}

export type WorkflowTile = {
  workflow: string
  label: string
  greenToday: number
  redToday: number
  totalToday: number
  minsSinceGreen: number | null
  checkpointCount: number
  severity: Severity
  /** "healthy · 14m" / "1 flag · um_insert" / "20% failing". */
  line: string
  /** false → render the tile but say "no data yet" (spec §Data sources). */
  hasData: boolean
}

/**
 * One tile per DISTINCT workflow across both views, scored by the shared
 * severity model rather than by "is anything red".
 *
 * The union matters: monitor_bucket_overview sometimes carries a workflow that
 * has not surfaced in monitor_overview yet, and a workflow throwing hard errors
 * must not be invisible just because it missed the aggregate view.
 */
export function buildWorkflowTiles(
  overview: OverviewRow[],
  buckets: BucketRow[],
  nowMs: number = Date.now(),
): WorkflowTile[] {
  const byWorkflow = new Map<string, OverviewRow[]>()
  for (const row of overview) {
    const key = row.workflow ?? '(unknown)'
    const list = byWorkflow.get(key)
    if (list) list.push(row)
    else byWorkflow.set(key, [row])
  }

  const fromBuckets = new Map<string, BucketRow[]>()
  for (const row of buckets) {
    const key = row.workflow ?? '(unknown)'
    if (byWorkflow.has(key)) continue
    const list = fromBuckets.get(key)
    if (list) list.push(row)
    else fromBuckets.set(key, [row])
  }

  const names = sortWorkflows([...new Set([...byWorkflow.keys(), ...fromBuckets.keys()])])

  return names.map((workflow) => {
    const rows = byWorkflow.get(workflow) ?? fromBuckets.get(workflow) ?? []
    // Named so the staleness rule can read this workflow's cadence.
    const roll = rollup(rows, { workflow, nowMs })

    return {
      workflow,
      label: humanize(workflow),
      greenToday: roll.greenToday,
      redToday: roll.redToday,
      totalToday: roll.totalToday,
      minsSinceGreen: roll.minsSinceGreen,
      checkpointCount: rows.length,
      severity: roll.severity,
      line: roll.line,
      hasData: roll.hasHistory,
    }
  })
}
