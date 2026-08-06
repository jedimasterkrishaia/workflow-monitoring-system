import { humanize } from '@/lib/aggregate'
import { minutesSince } from '@/lib/time'
import type { DotStatus, LeadRow } from '@/lib/types'

/**
 * Lead tracking model (tab 2).
 *
 * monitor_lead_journey_enriched still carries ~28 checkpoint columns, but the
 * table no longer renders them as dots. This module collapses them into a
 * single health verdict plus the handful of phases an operator narrates a lead
 * with, so a row can say what is wrong instead of making you decode a grid.
 */

export type Health = 'issue' | 'stalled' | 'ok'

/** No activity for this long means stalled — unless the lead has finished. */
export const STALL_HOURS = 24

/**
 * Stages where silence is the expected end state, not a stall.
 *
 * Compared lower-cased here and matched with `ilike` in the server-side stalled
 * filter (lib/data.ts), so the two agree regardless of how the CRM cases them.
 */
export const TERMINAL_STAGES = ['demo conducted', 'closed won', 'closed lost', 'discard']

const TERMINAL_SET = new Set(TERMINAL_STAGES)

export type JourneyPhase = {
  label: string
  /** Any one of these columns green marks the phase reached. */
  columns: string[]
  /** Amber-pill copy when this is the step a stalled lead is waiting on. */
  missing: string
}

/** The narrated journey: five phases, each backed by one checkpoint column. */
export const JOURNEY_PHASES: JourneyPhase[] = [
  { label: 'Booked', columns: ['rh_insert'], missing: 'Booking not recorded' },
  { label: 'Messaged', columns: ['ft_wa_send'], missing: 'No first touch sent' },
  { label: 'Replied', columns: ['sdr_inbound', 'sdr_parse'], missing: 'No reply yet' },
  { label: 'Demo confirmed', columns: ['sdr_confirmed'], missing: 'Demo not confirmed' },
  { label: 'Scheduled', columns: ['sch_calendar'], missing: 'Not on the calendar' },
]

/**
 * Every checkpoint in pipeline order, with a label that is unique across
 * workflows (three checkpoint names repeat between first touch, AI SDR and the
 * scheduler). Order is what makes "first failing checkpoint" mean anything;
 * the labels feed the health badge and the event timeline alike.
 */
export const CHECKPOINT_LABELS: Record<string, string> = {
  rh_received: 'RH received',
  rh_insert: 'RH insert',

  ft_rh_lookup: 'RH lookup',
  ft_um_insert: 'UM insert',
  ft_wa_send: 'WhatsApp send',
  ft_template_stamp: 'Template stamp',
  ft_conv_log: 'Conversation log',
  ft_deal_stage: 'Deal stage',

  sdr_inbound: 'Inbound message',
  sdr_deal_lookup: 'Deal lookup',
  sdr_parse: 'Reply parse',
  sdr_outbound: 'Outbound reply',
  sdr_out_logged: 'Outbound logged',
  sdr_stage: 'SDR stage',
  sdr_confirmed: 'Demo confirmed',
  sdr_cancelled: 'Demo cancelled',
  sdr_resched_link: 'Reschedule link',
  sdr_sched_called: 'Scheduler called',
  sdr_noshow_fwd: 'No-show forwarded',
  sdr_noshow_marked: 'No-show marked',
  sdr_gm_notified: 'GM notified',

  sch_payload: 'Scheduler payload',
  sch_calendar: 'Calendar event',
  sch_supa: 'Scheduler DB write',
  sch_wa_confirm: 'WhatsApp confirm',
  sch_conv_log: 'Scheduler conversation log',
  sch_gm_notified: 'Scheduler GM notify',
  sch_deal_stage: 'Scheduler deal stage',
}

export const CHECKPOINT_ORDER = Object.keys(CHECKPOINT_LABELS)

/**
 * monitor_lead_events names checkpoints without the workflow prefix the
 * enriched view uses (`wa_send`, not `ft_wa_send`) and covers workflows the
 * view has no column for at all — confirm dispatch, welcome email. The timeline
 * captions each block with its workflow, so these labels need no prefix; three
 * names deliberately repeat across workflows.
 */
export const EVENT_CHECKPOINT_LABELS: Record<string, string> = {
  rh_received: 'RH received',
  rh_insert: 'RH insert',

  rh_lookup: 'RH lookup',
  um_insert: 'UM insert',
  wa_send: 'WhatsApp send',
  template_stamp: 'Template stamp',
  conv_log: 'Conversation log',
  deal_stage_update: 'Deal stage update',

  inbound_logged: 'Inbound logged',
  deal_lookup: 'Deal lookup',
  ai_parse: 'Reply parsed',
  outbound_sent: 'Outbound sent',
  outbound_logged: 'Outbound logged',
  stage_update: 'Stage update',
  confirm_marked: 'Demo confirmed',
  noshow_marked: 'No-show marked',
  reschedule_sent: 'Reschedule link sent',
  scheduler_called: 'Scheduler called',
  gm_notified: 'GM notified',

  payload_valid: 'Payload validated',
  calendar_event: 'Calendar event',
  supa_updated: 'Supabase updated',
  wa_confirm: 'WhatsApp confirm',

  bolna_call: 'Bolna call',
  confirm_send: 'Confirmation sent',
  log_append: 'Log appended',

  email_sent: 'Email sent',
  email_marked: 'Email marked',
  email_blocked: 'Email blocked',

  hard_error: 'Hard error',
}

/** Known checkpoints get their curated label; anything new falls back to humanize. */
export function checkpointLabel(key: string | null | undefined): string {
  if (!key) return '—'
  return CHECKPOINT_LABELS[key] ?? EVENT_CHECKPOINT_LABELS[key] ?? humanize(key)
}

/** Normalises a journey cell to green / red / null (= checkpoint never reached). */
export function dotStatus(value: unknown): DotStatus {
  if (value === null || value === undefined) return null
  const v = String(value).trim().toLowerCase()
  if (v === 'green' || v === 'ok' || v === 'true') return 'green'
  if (v === 'red' || v === 'fail' || v === 'error' || v === 'false') return 'red'
  return null
}

export function isHardError(lead: LeadRow): boolean {
  const v = lead.hard_error
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  return s === 'red' || s === 'true' || s === 'yes' || (s !== '' && s !== 'null' && s !== 'green')
}

/** Falls back to the deal name, then the phone, so a row is never nameless. */
export function leadDisplayName(lead: LeadRow): string {
  const name = typeof lead.lead_name === 'string' ? lead.lead_name.trim() : ''
  if (name) return name
  const deal = typeof lead.deal_name === 'string' ? lead.deal_name.trim() : ''
  if (deal) return deal
  return String(lead.phone ?? '—')
}

/** red_details arrives as free text or JSON depending on the view's shape. */
export function redDetailsText(details: LeadRow['red_details']): string {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

/** "{}" and the literal string "null" are the view's ways of saying nothing broke. */
function hasRedDetails(details: LeadRow['red_details']): boolean {
  const text = redDetailsText(details).trim()
  return text !== '' && text.toLowerCase() !== 'null' && text !== '{}' && text !== '[]'
}

/** Checkpoint keys named anywhere inside a free-text or JSON red_details value. */
function keysNamedIn(details: LeadRow['red_details']): string[] {
  if (!details) return []

  if (typeof details === 'object') {
    if (Array.isArray(details)) {
      return details.flatMap((item) => {
        if (typeof item === 'string') return keysNamedIn(item)
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          const named = record.checkpoint ?? record.key ?? record.step
          return named ? [String(named)] : []
        }
        return []
      })
    }
    // { ft_wa_send: "429 from WA", … } — a key with no value is not a failure.
    return Object.entries(details as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
      .map(([k]) => k)
  }

  const text = String(details).toLowerCase()
  return CHECKPOINT_ORDER.filter((key) => text.includes(key))
}

/**
 * The checkpoint to name in the health badge. Status columns win over
 * red_details because they are structured; the free-text blob is the fallback
 * for views that only report the failure in prose.
 */
export function firstRedCheckpoint(lead: LeadRow): string | null {
  const fromColumns = CHECKPOINT_ORDER.filter((key) => dotStatus(lead[key]) === 'red')
  if (fromColumns.length) return fromColumns[0]

  const named = new Set(keysNamedIn(lead.red_details))
  return CHECKPOINT_ORDER.find((key) => named.has(key)) ?? null
}

/** Phases the lead has actually reached, in order. */
export function greenPhases(lead: LeadRow): JourneyPhase[] {
  return JOURNEY_PHASES.filter((phase) =>
    phase.columns.some((column) => dotStatus(lead[column]) === 'green'),
  )
}

/**
 * What a stalled lead is actually waiting on: the first unreached phase *after*
 * the furthest one it has reached. Leads skip phases routinely — a lead that is
 * booked, messaged and demo-confirmed is waiting on the calendar, not on the
 * reply it never technically logged, so the earliest gap is the wrong answer.
 */
function nextMissingPhase(lead: LeadRow): JourneyPhase | null {
  const reached = (phase: JourneyPhase) =>
    phase.columns.some((column) => dotStatus(lead[column]) === 'green')

  const lastReached = JOURNEY_PHASES.map(reached).lastIndexOf(true)
  return JOURNEY_PHASES.slice(lastReached + 1).find((phase) => !reached(phase)) ?? null
}

function isTerminal(stage: unknown): boolean {
  if (typeof stage !== 'string') return false
  return TERMINAL_SET.has(stage.trim().toLowerCase())
}

export type LeadHealth = {
  level: Health
  /** Badge copy: "Issue: WhatsApp send" / "Stalled 3d" / "On track". */
  label: string
  /** Journey-pill copy for the failed (issue) or awaited (stalled) step. */
  step: string | null
  /** Full red_details, surfaced as the badge tooltip. */
  detail: string
}

/**
 * One verdict per lead, computed in the browser from the row already on screen.
 *
 * A hard error counts as an issue even if red_details is empty: it is the one
 * signal that must never sort below a stalled lead.
 */
export function leadHealth(lead: LeadRow, nowMs: number): LeadHealth {
  const detail = redDetailsText(lead.red_details).trim()

  if (hasRedDetails(lead.red_details) || isHardError(lead)) {
    const key = firstRedCheckpoint(lead)
    const step = key ? checkpointLabel(key) : isHardError(lead) ? 'hard error' : 'unknown step'
    return { level: 'issue', label: `Issue: ${step}`, step, detail }
  }

  const mins = minutesSince(lead.last_activity, nowMs)
  if (mins !== null && mins > STALL_HOURS * 60 && !isTerminal(lead.current_stage)) {
    const days = Math.max(1, Math.floor(mins / (60 * 24)))
    return {
      level: 'stalled',
      label: `Stalled ${days}d`,
      step: nextMissingPhase(lead)?.missing ?? null,
      detail,
    }
  }

  return { level: 'ok', label: 'On track', step: null, detail }
}
