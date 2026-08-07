/** Shapes of the read-only Supabase views backing the dashboard. */

export type DotStatus = 'green' | 'red' | null

/** monitor_overview — one row per workflow×checkpoint. */
export type OverviewRow = {
  workflow: string
  checkpoint: string
  green_today: number | null
  red_today: number | null
  green_7d: number | null
  red_7d: number | null
  last_green: string | null
  last_red: string | null
  mins_since_green: number | null
}

/** monitor_bucket_overview — same shape as overview plus the checkpoint sub-path. */
export type BucketRow = OverviewRow & {
  bucket: string | null
}

/** monitor_reds_feed — latest failures. */
export type RedRow = {
  id: string | number
  workflow: string | null
  workflow_raw?: string | null
  checkpoint: string | null
  bucket: string | null
  phone: string | null
  hubspot_deal_id: string | null
  detail: string | null
  execution_url: string | null
  created_at: string | null
}

/**
 * monitor_lead_journey_enriched — one row per lead, the ~30 journey status
 * columns plus CRM context (name, pipeline, stage, deal, demo).
 */
export type LeadRow = {
  phone: string
  lead_name: string | null
  deal_name: string | null
  pipeline: string | null
  lead_bucket: string | null
  current_stage: string | null
  current_campaign: string | null
  um_deal_id: string | number | null
  demo_scheduled_at: string | null
  demo_outcome: string | null
  last_activity: string | null
  red_details: string | Record<string, unknown> | null
  hard_error: DotStatus | string | null
  /** The journey checkpoint columns (see JOURNEY_PHASES) plus anything new. */
  [column: string]: unknown
}

/**
 * monitor_lead_events — the append-only checkpoint log behind one lead, fetched
 * on demand when a row is expanded rather than shipped with the snapshot.
 */
export type LeadEventRow = {
  phone?: string | null
  workflow: string | null
  checkpoint: string | null
  bucket: string | null
  status: string | null
  detail: string | null
  execution_url: string | null
  created_at: string | null
}

/** Response of /api/lead-events?phone=… */
export type LeadEventsPayload = {
  events: LeadEventRow[]
  /** false when SUPABASE_* env vars are missing/placeholder. */
  configured: boolean
  error: string | null
}

/**
 * monitor_batch_integrity — one row per checkpoint stamped by a dispatch batch
 * loop, reconciling what came due against what the loop actually completed.
 *
 * Two quirks, both handled in lib/batches:
 * - `workflow` is the literal string `WORKFLOW_TAG` on every row — the n8n
 *   template placeholder is never substituted, so it identifies nothing.
 * - one execution appears several times, once per checkpoint it stamped.
 */
export type BatchIntegrityRow = {
  workflow: string | null
  execution_id: string | null
  /** "40 due: wa_first_check×40" — what the loop was handed. */
  due_detail: string | null
  due_count: number | null
  done_detail: string | null
  /** IST wall clock with no offset — read via istNaiveToMs, never new Date(). */
  batch_started_ist: string | null
  verdict: string | null
  execution_url: string | null
}

/** monitor_missed_reminders — one row per reminder action that came due and never fired. */
export type MissedReminderRow = {
  phone: string | null
  name: string | null
  deal_owner: string | null
  /** IST wall clock with no offset. */
  meeting_ist: string | null
  action: string | null
  /** IST wall clock with no offset. */
  due_ist: string | null
  /** PostgREST may hand a `numeric` back as a string — coerce before use. */
  mins_overdue: number | string | null
}

/**
 * monitor_coach_integrity — one row per sales_coach run, listing the required
 * steps it finished without stamping.
 */
export type CoachIntegrityRow = {
  execution_id: string | null
  /** IST wall clock with no offset. */
  started_ist: string | null
  missing_required: string[] | null
  onepager_sent: boolean | null
  followup_enqueued: boolean | null
  verdict: string | null
  execution_url: string | null
}

/**
 * monitor_missed_transcripts — a demo happened but its transcript never
 * arrived. Carries other verdicts too (e.g. `outcome_unmarked`); the panel
 * only ever wants `missing_transcript`, filtered server-side.
 */
export type MissedTranscriptRow = {
  lead_name: string | null
  phone: string | null
  email: string | null
  gm: string | null
  /** IST wall clock with no offset. */
  demo_ist: string | null
  deal_id: string | null
  hubspot_stage: string | null
  /** PostgREST may hand a `numeric` back as a string — coerce before use. */
  hours_since_demo: number | string | null
  verdict: string | null
}

/** monitor_gm_slots — one row per GM calendar owner. */
export type GmSlotRow = {
  gm_name?: string | null
  hubspot_owner_id?: string | null
  updated_at?: string | null
  age_seconds?: number | null
  freshness_status?: string | null
  today_free?: number | null
  tomorrow_free?: number | null
  day_after_free?: number | null
  all_free_warn?: boolean | null
  [column: string]: unknown
}

/** One page of the flag log. */
export type RedsPage = {
  reds: RedRow[]
  /** True when another page exists behind this one. */
  hasMore: boolean
  error: string | null
}

/** How far back the lead tab looks, matched against `last_activity`. */
export type LeadRange = '7d' | '30d' | 'all'

/** Health filter on the lead tab. Resolved server-side so it reaches every page. */
export type LeadHealthFilter = 'all' | 'issue' | 'stalled'

/**
 * Everything that narrows the lead list. All four are resolved server-side, so
 * a filter reaches the whole table rather than the rows already on screen.
 */
export type LeadListParams = {
  /** Name or phone fragment. */
  q: string
  range: LeadRange
  health: LeadHealthFilter
  /** Exact `pipeline` value; '' means every pipeline. */
  pipeline: string
}

export const DEFAULT_LEAD_PARAMS: LeadListParams = {
  q: '',
  range: '7d',
  health: 'all',
  pipeline: '',
}

/** One page of the lead list. */
export type LeadsPage = {
  leads: LeadRow[]
  /** Rows matching the filters across the whole view; null when the count failed. */
  total: number | null
  /** True when another page exists behind this one. */
  hasMore: boolean
  error: string | null
}

/** Everything the dashboard needs, fetched in one server round trip. */
export type MonitorPayload = {
  /** ISO timestamp the snapshot was assembled, server-side. */
  generatedAt: string
  /** false when SUPABASE_* env vars are missing/placeholder — UI shows a setup banner. */
  configured: boolean
  /** Per-view failures; a broken view degrades that section only. */
  errors: string[]
  overview: OverviewRow[]
  buckets: BucketRow[]
  /** First page of the flag log; later pages arrive via /api/reds. */
  reds: RedRow[]
  redsHasMore: boolean
  /**
   * Hard errors from the last 24h, queried separately so they stay pinned even
   * when they have scrolled out of the first page of the feed.
   */
  hardErrors: RedRow[]
  /** Reds in the last 24h — the number on the Flag logs tab. */
  redsLast24h: number
  /**
   * Dispatch batches whose loop died without completing, last 48h. Pinned to the
   * top of the flag log: a batch that never ran leaves no red behind to find.
   */
  deadBatches: BatchIntegrityRow[]
  /** Reminder actions that came due and never fired, newest first. */
  missedReminders: MissedReminderRow[]
  /**
   * sales_coach runs that finished without stamping every required step, last
   * 48h. Same silent-failure shape as deadBatches — nothing turns red.
   */
  brokenCoach: CoachIntegrityRow[]
  /** Demos that happened with no transcript ever recorded, most overdue first. */
  missedTranscripts: MissedTranscriptRow[]
  /** First page of the lead list; later pages arrive via /api/leads. */
  leads: LeadRow[]
  /** Leads matching the active filters across the whole view — the N in "50 of N". */
  leadsTotal: number | null
  leadsHasMore: boolean
  /**
   * Every pipeline the view knows about, unfiltered. The dropdown cannot be
   * built from the loaded rows once the pipeline filter runs server-side —
   * filtering to one pipeline would leave that as the only option on offer.
   */
  leadPipelines: string[]
  gmSlots: GmSlotRow[]
}
