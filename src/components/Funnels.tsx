'use client'

import { useCallback, useRef, useState } from 'react'

import {
  DEFAULT_FUNNEL_DAYS,
  FUNNEL_WINDOWS,
  type FunnelCard,
  type FunnelsPayload,
} from '@/lib/monitor'
import { EmptyNote, ErrorNote, Section, Select } from '@/components/ui'

/** One step row: label, count, bar, and the percentages the data layer decided. */
function StepRow({ step }: { step: FunnelCard['steps'][number] }) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5">
      <div className="w-6 shrink-0 text-[11px] tabular-nums text-ink-3">{step.step_no}</div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-ink" title={step.step}>
          {step.step}
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-chip bg-surface">
          <div className="h-full rounded-chip bg-ink-2/35" style={{ width: `${step.bar}%` }} />
        </div>
      </div>

      <div className="w-14 shrink-0 text-right text-[12px] font-medium tabular-nums text-ink">
        {step.n.toLocaleString('en-IN')}
      </div>

      {/* Percent against the step this one is measured off — blank where the
          rules say the step carries none (step 1, and the Follow-ups sends). */}
      <div
        className="w-16 shrink-0 text-right text-[12px] tabular-nums text-ink-2"
        title={step.pctOf ? `${step.pct}% of ${step.pctOf}` : undefined}
      >
        {step.pct === null ? '' : `${step.pct}%`}
      </div>

      <div
        className="hidden w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-3 sm:block"
        title={step.pctOfFirst === null ? undefined : `${step.pctOfFirst}% of step 1`}
      >
        {step.pctOfFirst === null ? '' : `${step.pctOfFirst}% of 1`}
      </div>
    </div>
  )
}

/** The optional day-by-day table — the rows are already per cohort day. */
function DayTable({ card }: { card: FunnelCard }) {
  return (
    <details className="hairline-t">
      <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-ink-3 hover:text-ink-2">
        Day by day
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-1 pr-3 font-medium">Day</th>
              {card.steps.map((step) => (
                <th
                  key={step.step_no}
                  className="py-1 pl-2 text-right font-medium"
                  title={step.step}
                >
                  {step.step_no}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.days.map((day) => (
              <tr key={day.cohort_day} className="hairline-t">
                <td className="whitespace-nowrap py-1 pr-3 tabular-nums text-ink-2">
                  {day.cohort_day}
                </td>
                {card.steps.map((step) => (
                  <td
                    key={step.step_no}
                    className="py-1 pl-2 text-right tabular-nums text-ink-2"
                  >
                    {day.counts[step.step_no] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function Card({ card }: { card: FunnelCard }) {
  return (
    <div className="hairline overflow-hidden rounded-card">
      <div className="hairline-b flex items-baseline justify-between gap-2 bg-surface px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink">{card.funnel}</h3>
        {card.segment && card.segment !== 'all' ? (
          <span className="text-[11px] text-ink-3">{card.segment}</span>
        ) : null}
      </div>
      <div className="divide-y divide-line/60">
        {card.steps.map((step) => (
          <StepRow key={step.step_no} step={step} />
        ))}
      </div>
      {card.days.length > 1 ? <DayTable card={card} /> : null}
    </div>
  )
}

/**
 * Funnels, one card per funnel × segment.
 *
 * Every number here — the sums over the window, both percentages and the bar
 * width — comes from the data layer (lib/monitor.ts). This component only
 * picks a window and lays the result out.
 */
export default function Funnels({ initial }: { initial: FunnelsPayload }) {
  const [payload, setPayload] = useState(initial)
  const [days, setDays] = useState(initial.days ?? DEFAULT_FUNNEL_DAYS)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(async (nextDays: number) => {
    const ticket = ++latest.current
    setDays(nextDays)
    setLoading(true)
    setFailed(null)

    try {
      const response = await fetch(`/api/funnels?days=${nextDays}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const next = (await response.json()) as FunnelsPayload
      if (ticket === latest.current) setPayload(next)
    } catch (err) {
      if (ticket === latest.current) setFailed(err instanceof Error ? err.message : String(err))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [])

  const windowLabel = FUNNEL_WINDOWS.find((option) => option.days === payload.days)?.label

  return (
    <Section
      title="Funnels"
      subtitle={
        loading
          ? 'loading…'
          : `${payload.dFrom} → ${payload.dTo} · ${payload.cohortDays.length} ${payload.cohortDays.length === 1 ? 'day' : 'days'}${windowLabel ? ` · ${windowLabel}` : ''}`
      }
      right={
        <Select
          label="Window"
          value={String(days)}
          disabled={loading}
          options={FUNNEL_WINDOWS.map((option) => ({
            value: String(option.days),
            label: option.label,
          }))}
          onChange={(value) => void load(Number(value))}
        />
      }
    >
      {failed ? <ErrorNote>Could not load funnels: {failed}</ErrorNote> : null}
      {payload.error ? <ErrorNote>{payload.error}</ErrorNote> : null}
      {payload.truncated ? (
        <ErrorNote>
          A funnel request came back on the 1000-row ceiling, so these totals are short. Narrow the
          window.
        </ErrorNote>
      ) : null}

      {payload.cards.length === 0 ? (
        <EmptyNote>No funnel rows for this window.</EmptyNote>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {payload.cards.map((card) => (
            <Card key={`${card.funnel}-${card.segment}`} card={card} />
          ))}
        </div>
      )}
    </Section>
  )
}
