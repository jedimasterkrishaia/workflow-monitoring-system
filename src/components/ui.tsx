import type { MonStatus } from '@/lib/monitor'

/** Shared flat primitives. Hairlines only — no shadows, no gradients. */

/**
 * The visual statuses. `idle` carries `broken`: a check that could not run is
 * not a red check, and painting it red would put a failure on a system that may
 * be fine. It reads as neutral-but-noted, and the Broken tile counts it.
 */
export type Status = 'green' | 'red' | 'amber' | 'idle'

export function uiStatus(status: MonStatus): Status {
  switch (status) {
    case 'ok':
      return 'green'
    case 'red':
      return 'red'
    case 'amber':
      return 'amber'
    default:
      return 'idle'
  }
}

/** Background + border for a tinted tile / chip. */
export function statusSurface(status: Status): string {
  switch (status) {
    case 'green':
      return 'bg-ok-soft border-ok/25'
    case 'red':
      return 'bg-bad-soft border-bad/30'
    case 'amber':
      return 'bg-warn-soft border-warn/30'
    default:
      return 'bg-surface border-line'
  }
}

/** Foreground colour for text/marks that carry the status. */
export function statusInk(status: Status): string {
  switch (status) {
    case 'green':
      return 'text-ok'
    case 'red':
      return 'text-bad'
    case 'amber':
      return 'text-warn'
    default:
      return 'text-ink-3'
  }
}

function statusFill(status: Status): string {
  switch (status) {
    case 'green':
      return 'bg-ok'
    case 'red':
      return 'bg-bad'
    case 'amber':
      return 'bg-warn'
    default:
      return 'bg-transparent'
  }
}

/** Status circle: filled for green/red/amber, faint outline for broken. */
export function StatusDot({
  status,
  title,
  size = 8,
}: {
  status: Status
  title?: string
  size?: number
}) {
  return (
    <span
      title={title}
      aria-label={title ?? status}
      className={[
        'inline-block shrink-0 rounded-full align-middle',
        statusFill(status),
        status === 'idle' ? 'border-[0.5px] border-line-strong' : '',
      ].join(' ')}
      style={{ width: size, height: size }}
    />
  )
}

/** Tinted pill — the health board's verdict column. */
export function Pill({
  status,
  title,
  strong,
  children,
}: {
  status: Status
  title?: string
  /** Health badges carry the verdict, so they sit a notch heavier than labels. */
  strong?: boolean
  children: React.ReactNode
}) {
  return (
    <span
      title={title}
      className={[
        'inline-flex items-center whitespace-nowrap rounded-chip border-[0.5px] px-1.5 py-px text-[11px] leading-[16px]',
        statusSurface(status),
        statusInk(status),
        strong ? 'font-medium' : '',
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div className="mb-3.5 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? <span className="text-[11px] text-ink-3">{subtitle}</span> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="hairline rounded-card bg-surface px-3 py-4 text-[12px] text-ink-2">
      {children}
    </div>
  )
}

/** A failed read, stated rather than silently rendered as "no rows". */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="hairline mb-3 rounded-card border-bad/30 bg-bad-soft px-3 py-2 text-[12px] text-bad">
      {children}
    </div>
  )
}

/** Compact select — used by the funnel window picker. */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
      <span className="text-ink-3">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="hairline rounded-chip bg-bg px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
