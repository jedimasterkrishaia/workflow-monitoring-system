import type { WorkflowTile } from '@/lib/aggregate'
import { severityAccent, severityInk } from '@/lib/severity'

/**
 * Overview tab — one tile per workflow.
 *
 * The surface stays neutral whatever the state: severity lives in a 3px leading
 * edge and one line of text. A wall of red-filled tiles reads as "everything is
 * on fire" the moment a single checkpoint hiccups, which is exactly the alarm
 * fatigue the severity model exists to stop.
 */
export default function WorkflowTiles({ tiles }: { tiles: WorkflowTile[] }) {
  if (tiles.length === 0) {
    return (
      <div className="hairline-dashed rounded-card px-3 py-4 text-[12px] text-ink-3">
        No workflows reporting yet.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.workflow}
          className={[
            'hairline rounded-card bg-surface px-4 py-[18px]',
            severityAccent(tile.severity),
          ].join(' ')}
        >
          <div className="truncate text-[12px] font-medium text-ink" title={tile.workflow}>
            {tile.label}
          </div>

          {tile.hasData ? (
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-[20px] font-semibold leading-none tabular-nums text-ink">
                {tile.greenToday}
              </span>
              <span className="text-[12px] tabular-nums text-ink-2">/ {tile.totalToday}</span>
            </div>
          ) : (
            <div className="mt-2 text-[12px] leading-none text-ink-3">—</div>
          )}

          {/* The count and the verdict are two separate reads — let them breathe. */}
          <div
            className={['mt-3 truncate text-[11px]', severityInk(tile.severity)].join(' ')}
            title={tile.line}
          >
            {tile.line}
          </div>
        </div>
      ))}
    </div>
  )
}
