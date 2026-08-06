'use client'

import { useState } from 'react'

import { normalizeGmSlots } from '@/lib/gm'
import { compactAge } from '@/lib/time'
import type { GmSlotRow } from '@/lib/types'
import { StatusDot, statusSurface } from '@/components/ui'

const COLLAPSE_AT = 6

/**
 * GM calendar slots as a chip strip, not tiles — freshness is the only thing
 * worth a glance. Stale (>5 min) chips sort first and stay visible even while
 * the rest of the strip is collapsed behind "+N GMs".
 */
export default function GmStrip({ rows, nowMs }: { rows: GmSlotRow[]; nowMs: number }) {
  const [expanded, setExpanded] = useState(false)
  const slots = normalizeGmSlots(rows, nowMs)

  if (slots.length === 0) {
    return <span className="text-[12px] text-ink-3">No GM slots reporting.</span>
  }

  const visible = expanded ? slots : slots.slice(0, COLLAPSE_AT)
  const hidden = slots.length - visible.length

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((slot, i) => (
        <span
          key={`${slot.name}-${i}`}
          title={[
            slot.name,
            ...slot.counts.map((c) => `${c.label}: ${c.value}`),
            slot.allFreeWarn ? 'all slots free' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          className={`hairline flex items-center gap-1.5 rounded-chip px-2 py-1 text-[12px] ${statusSurface(slot.status)}`}
        >
          <StatusDot status={slot.status} size={7} />
          <span className="text-ink">{slot.name}</span>
          <span className="tabular-nums text-ink-3">{compactAge(slot.minsSinceRefresh)}</span>
          {slot.stale ? <span className="font-medium text-warn">stale</span> : null}
          {!slot.stale && slot.allFreeWarn ? (
            <span className="font-medium text-warn">all free</span>
          ) : null}
        </span>
      ))}

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="hairline rounded-chip bg-bg px-2 py-1 text-[12px] text-ink-2 hover:bg-surface"
        >
          {expanded ? 'Show less' : `+${hidden} GMs`}
        </button>
      ) : null}
    </div>
  )
}
