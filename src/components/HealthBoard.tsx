'use client'

import type { HealthCounts, HealthRow, MonStatus } from '@/lib/monitor'
import { EmptyNote, Pill, Section, statusInk, statusSurface, uiStatus } from '@/components/ui'

/** Red / Amber / OK / Broken counts (spec §Page 2). */
const TILES: { status: MonStatus; key: keyof HealthCounts; label: string }[] = [
  { status: 'red', key: 'red', label: 'Red' },
  { status: 'amber', key: 'amber', label: 'Amber' },
  { status: 'ok', key: 'ok', label: 'OK' },
  { status: 'broken', key: 'broken', label: 'Broken' },
]

export function HealthTiles({ counts }: { counts: HealthCounts }) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TILES.map((tile) => {
        const status = uiStatus(tile.status)
        return (
          <div
            key={tile.key}
            className={['rounded-card border-[0.5px] px-3 py-2.5', statusSurface(status)].join(' ')}
          >
            <div className={['text-[22px] font-semibold tabular-nums leading-7', statusInk(status)].join(' ')}>
              {counts[tile.key]}
            </div>
            <div className="text-[11px] text-ink-2">{tile.label}</div>
          </div>
        )
      })}
    </div>
  )
}

const STATUS_LABEL: Record<MonStatus, string> = {
  red: 'red',
  amber: 'amber',
  ok: 'ok',
  broken: 'broken',
}

/**
 * The health board.
 *
 * Rows arrive from the data layer already ordered red → broken → amber → ok,
 * and `detail` is a ready-to-show sentence from mon_health(), so nothing is
 * re-worded or re-derived here.
 */
export default function HealthBoard({ rows }: { rows: HealthRow[] }) {
  if (rows.length === 0) {
    return (
      <Section title="Health board">
        <EmptyNote>No checks returned.</EmptyNote>
      </Section>
    )
  }

  return (
    <Section title="Health board" subtitle={`${rows.length} checks`}>
      <div className="hairline overflow-hidden rounded-card">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="hairline-b bg-surface text-left text-[11px] text-ink-3">
              <th className="px-3 py-2 font-medium">System</th>
              <th className="px-3 py-2 font-medium">Check</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const status = uiStatus(row.status)
              return (
                <tr
                  key={`${row.system}-${row.check_name}-${index}`}
                  className={index === 0 ? '' : 'hairline-t'}
                >
                  <td className="whitespace-nowrap px-3 py-2 align-top text-ink-2">{row.system}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-medium text-ink">
                    {row.check_name}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Pill status={status} strong>
                      {STATUS_LABEL[row.status]}
                    </Pill>
                  </td>
                  <td className="px-3 py-2 align-top text-ink-2">{row.detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
