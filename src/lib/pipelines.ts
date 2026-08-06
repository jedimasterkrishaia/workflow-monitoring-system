import { humanize, sortWorkflows } from '@/lib/aggregate'
import {
  HARD_ERROR_CHECKPOINT,
  rollup,
  type Rollup,
  type RollupOptions,
  type Severity,
} from '@/lib/severity'
import type { BucketRow, OverviewRow } from '@/lib/types'

/**
 * Bucket pipelines — the Overview tab's main body.
 *
 * A flat chip per checkpoint told you *that* something failed but not *where in
 * the journey*, and it averaged buckets together so one dead segment hid behind
 * a healthy total. These render a workflow as rows of ordered stages instead:
 * one row per bucket where buckets exist, one funnel row where the workflow is
 * a dispatch ladder, plain chips where it is neither.
 */

export type Stage = { key: string; label: string }

type PipelineConfig =
  /** One row per bucket; stages are checkpoints. */
  | { kind: 'buckets'; stages: Stage[]; preferred: string[]; extra?: { label: string; stages: Stage[] } }
  /** A single dispatch ladder; stages are *buckets*, not checkpoints. */
  | { kind: 'funnel'; label: string; stages: Stage[]; stampedFrom: string }
  /** A single row; stages are checkpoints, one of which may fan out. */
  | { kind: 'row'; label: string; stages: Stage[]; expand?: string }

/**
 * Stage order per workflow. Hardcoded on purpose: journey order is product
 * knowledge, not something the data can be asked for.
 *
 * Note the two grains. For ai_sdr and first_touch a stage key is a checkpoint;
 * for the dispatch ladders a stage key is a *bucket* of confirm_send /
 * bolna_call / reminder_send, because that is how those workflows label their
 * attempts.
 */
const PIPELINES: Record<string, PipelineConfig> = {
  ai_sdr: {
    kind: 'buckets',
    stages: [
      { key: 'inbound_logged', label: 'Inbound' },
      { key: 'deal_lookup', label: 'Deal lookup' },
      { key: 'ai_parse', label: 'Parse' },
      { key: 'outbound_sent', label: 'Outbound' },
      { key: 'outbound_logged', label: 'Logged' },
      { key: 'stage_update', label: 'Stage' },
    ],
    preferred: ['TallyDemoBooked', 'TallyNotBooked', 'ColdInbound', 'DemoBooked'],
    extra: {
      label: 'Demo actions',
      stages: [
        { key: 'confirm_marked', label: 'Confirmed' },
        { key: 'cancel_marked', label: 'Cancelled' },
        { key: 'reschedule_sent', label: 'Rescheduled' },
        { key: 'scheduler_called', label: 'Scheduler' },
        { key: 'noshow_forward', label: 'No-show fwd' },
        { key: 'noshow_marked', label: 'No-show' },
        { key: 'gm_notified', label: 'GM notified' },
      ],
    },
  },

  confirm_dispatch: {
    kind: 'funnel',
    label: 'Confirmation ladder',
    stages: [
      { key: 'wa_first_check', label: '7pm WA' },
      { key: 'call_first', label: '7:30 call' },
      { key: 'wa_second_check', label: '9am WA' },
      { key: 'call_second', label: '9:30 call' },
      { key: 'wa_third_check', label: '10am WA' },
      { key: 'call_third', label: '10:30 call' },
      { key: 'wa_sameday_first', label: 'Same-day WA' },
      { key: 'call_sameday_first', label: 'Same-day call' },
    ],
    stampedFrom: 'log_append',
  },

  reminder_dispatch: {
    kind: 'funnel',
    label: 'Reminder ladder',
    stages: [
      { key: 'reminder_morning_928', label: '9:28 WA' },
      { key: 'reminder_t30', label: 'T-30 WA' },
      { key: 'reminder_t10_wa', label: 'T-10 WA' },
      { key: 'reminder_t10', label: 'T-10 call' },
    ],
    stampedFrom: 'log_append',
  },

  first_touch: {
    kind: 'row',
    label: 'All leads',
    stages: [
      { key: 'rh_lookup', label: 'RH lookup' },
      { key: 'um_insert', label: 'UM insert' },
      { key: 'wa_send', label: 'WA send' },
      { key: 'template_stamp', label: 'Template' },
      { key: 'conv_log', label: 'Conv log' },
      { key: 'deal_stage_update', label: 'Deal stage' },
    ],
    // wa_send's buckets are the template variants, so it fans out on click.
    expand: 'wa_send',
  },
}

/** The row a bucket-less checkpoint lands in. */
const OTHER_ROW = 'Other'

export type StageCell = {
  key: string
  label: string
  greenToday: number
  redToday: number
  severity: Severity
  /** Nothing reports this stage here — render a dash, not a misleading zero. */
  empty: boolean
  line: string
  /** Per-bucket breakdown; non-empty only for a configured expand stage. */
  buckets: StageCell[]
}

export type PipelineRow = {
  key: string
  label: string
  /** Raw bucket values are rendered mono; named rows are not. */
  mono: boolean
  stages: StageCell[]
  severity: Severity
  line: string
  /** Dispatch ladders reconcile sends against the log_append stamp. */
  stamped: { count: number; sends: number; short: boolean } | null
}

export type Pipeline = {
  workflow: string
  label: string
  kind: PipelineConfig['kind'] | 'chips'
  severity: Severity
  line: string
  rows: PipelineRow[]
}

function isNamedBucket(bucket: string | null | undefined): boolean {
  const b = (bucket ?? '').trim()
  return b !== '' && b !== '(none)' && b.toLowerCase() !== 'null'
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

function cell(stage: Stage, rows: (OverviewRow | BucketRow)[]): StageCell {
  // deadGreen off: one checkpoint's quiet hour is normal, its row's is not.
  const roll = rollup(rows, { deadGreen: false })
  return {
    key: stage.key,
    label: stage.label,
    greenToday: roll.greenToday,
    redToday: roll.redToday,
    severity: roll.severity,
    empty: rows.length === 0,
    line: roll.line,
    buckets: [],
  }
}

/**
 * A dispatch ladder stamps the same attempt at more than one checkpoint
 * (reminder_send *and* periskope_send both log `reminder_t30`), so the widest
 * single checkpoint is the attempt count — summing would double-count it.
 */
function widestCheckpoint(rows: BucketRow[]): BucketRow[] {
  if (rows.length <= 1) return rows
  const byCheckpoint = groupBy(rows, (r) => r.checkpoint)
  let best: BucketRow[] = []
  let bestGreen = -1
  for (const group of byCheckpoint.values()) {
    const green = group.reduce((sum, r) => sum + (r.green_today ?? 0), 0)
    if (green > bestGreen) {
      bestGreen = green
      best = group
    }
  }
  return best
}

function buildBucketRows(
  config: Extract<PipelineConfig, { kind: 'buckets' }>,
  bucketRows: BucketRow[],
  overviewRows: OverviewRow[],
  opts: RollupOptions,
): PipelineRow[] {
  const stageKeys = new Set(config.stages.map((s) => s.key))
  const inStages = bucketRows.filter((r) => stageKeys.has(r.checkpoint))

  const present = new Set(
    inStages.filter((r) => isNamedBucket(r.bucket)).map((r) => (r.bucket ?? '').trim()),
  )
  const named = [
    ...config.preferred.filter((b) => present.has(b)),
    ...[...present].filter((b) => !config.preferred.includes(b)).sort(),
  ]

  const hasUnbucketed = inStages.some((r) => !isNamedBucket(r.bucket))

  const rows: PipelineRow[] = [...named, ...(hasUnbucketed ? [OTHER_ROW] : [])].map((bucket) => {
    const mine = inStages.filter((r) =>
      bucket === OTHER_ROW ? !isNamedBucket(r.bucket) : (r.bucket ?? '').trim() === bucket,
    )
    const roll = rollup(mine, opts)

    return {
      key: bucket,
      label: bucket,
      mono: bucket !== OTHER_ROW,
      stages: config.stages.map((stage) => cell(stage, mine.filter((r) => r.checkpoint === stage.key))),
      severity: roll.severity,
      line: roll.line,
      stamped: null,
    }
  })

  if (config.extra) {
    const byCheckpoint = groupBy(overviewRows, (r) => r.checkpoint)
    const mine = config.extra.stages.flatMap((stage) => byCheckpoint.get(stage.key) ?? [])
    // Only worth a row once at least one of these actions has ever fired.
    if (mine.length > 0) {
      const roll = rollup(mine, opts)
      rows.push({
        key: '__extra__',
        label: config.extra.label,
        mono: false,
        stages: config.extra.stages.map((stage) => cell(stage, byCheckpoint.get(stage.key) ?? [])),
        severity: roll.severity,
        line: roll.line,
        stamped: null,
      })
    }
  }

  return rows
}

function buildFunnelRow(
  config: Extract<PipelineConfig, { kind: 'funnel' }>,
  bucketRows: BucketRow[],
  opts: RollupOptions,
): PipelineRow[] {
  const sends = bucketRows.filter((r) => r.checkpoint !== config.stampedFrom)

  const stages = config.stages.map((stage) =>
    cell(stage, widestCheckpoint(sends.filter((r) => (r.bucket ?? '').trim() === stage.key))),
  )

  const sendTotal = stages.reduce((sum, s) => sum + s.greenToday, 0)
  const stampTotal = bucketRows
    .filter((r) => r.checkpoint === config.stampedFrom)
    .reduce((sum, r) => sum + (r.green_today ?? 0), 0)

  const roll = rollup(sends, opts)

  return [
    {
      key: '__funnel__',
      label: config.label,
      mono: false,
      stages,
      severity: roll.severity,
      line: roll.line,
      stamped: { count: stampTotal, sends: sendTotal, short: stampTotal < sendTotal },
    },
  ]
}

function buildSingleRow(
  config: Extract<PipelineConfig, { kind: 'row' }>,
  bucketRows: BucketRow[],
  overviewRows: OverviewRow[],
  opts: RollupOptions,
): PipelineRow[] {
  const byCheckpoint = groupBy(overviewRows, (r) => r.checkpoint)
  const roll = rollup(config.stages.flatMap((s) => byCheckpoint.get(s.key) ?? []), opts)

  const stages = config.stages.map((stage) => {
    const built = cell(stage, byCheckpoint.get(stage.key) ?? [])
    if (stage.key !== config.expand) return built

    built.buckets = bucketRows
      .filter((r) => r.checkpoint === stage.key && isNamedBucket(r.bucket))
      .sort((a, b) => (a.bucket ?? '').localeCompare(b.bucket ?? ''))
      .map((r) => cell({ key: (r.bucket ?? '').trim(), label: (r.bucket ?? '').trim() }, [r]))

    return built
  })

  return [
    { key: '__row__', label: config.label, mono: false, stages, severity: roll.severity, line: roll.line, stamped: null },
  ]
}

/** Workflows with no configured journey still get one severity-coloured chip per checkpoint. */
function buildChipRow(overviewRows: OverviewRow[], opts: RollupOptions): PipelineRow[] {
  const byCheckpoint = groupBy(
    overviewRows.filter((r) => r.checkpoint !== HARD_ERROR_CHECKPOINT),
    (r) => r.checkpoint,
  )

  const stages = [...byCheckpoint.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([checkpoint, rows]) => cell({ key: checkpoint, label: humanize(checkpoint) }, rows))

  if (stages.length === 0) return []

  const roll = rollup(overviewRows, opts)
  return [
    { key: '__chips__', label: '', mono: false, stages, severity: roll.severity, line: roll.line, stamped: null },
  ]
}

/**
 * One pipeline per workflow present in either view. monitor_overview is the
 * authority on checkpoint totals; monitor_bucket_overview is the only source
 * of the per-bucket split, and occasionally carries a workflow that has not
 * reached monitor_overview yet — so the workflow list is the union.
 */
export function buildPipelines(
  overview: OverviewRow[],
  buckets: BucketRow[],
  nowMs: number = Date.now(),
): Pipeline[] {
  const overviewByWorkflow = groupBy(overview, (r) => r.workflow ?? '(unknown)')
  const bucketsByWorkflow = groupBy(buckets, (r) => r.workflow ?? '(unknown)')

  const names = sortWorkflows([
    ...new Set([...overviewByWorkflow.keys(), ...bucketsByWorkflow.keys()]),
  ])

  return names.map((workflow) => {
    const bucketRows = bucketsByWorkflow.get(workflow) ?? []
    // Fall back to the bucket rows so a workflow missing from monitor_overview
    // still reports rather than rendering as an empty card.
    const overviewRows = overviewByWorkflow.get(workflow) ?? bucketRows
    const config = PIPELINES[workflow]

    // Every verdict at this grain or coarser is scored against this workflow's
    // own cadence, so an idle event-driven workflow stays healthy.
    const opts: RollupOptions = { workflow, nowMs }

    const rows = !config
      ? buildChipRow(overviewRows, opts)
      : config.kind === 'buckets'
        ? buildBucketRows(config, bucketRows, overviewRows, opts)
        : config.kind === 'funnel'
          ? buildFunnelRow(config, bucketRows, opts)
          : buildSingleRow(config, bucketRows, overviewRows, opts)

    const roll: Rollup = rollup(overviewRows, opts)

    return {
      workflow,
      label: humanize(workflow),
      kind: config?.kind ?? 'chips',
      severity: roll.severity,
      line: roll.line,
      rows,
    }
  })
}
