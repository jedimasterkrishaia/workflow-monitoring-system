import type { Status } from '@/lib/aggregate'

/** Shared flat primitives. Hairlines only — no shadows, no gradients. */

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

/** Status circle: filled for green/red/amber, faint outline for "never reached". */
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

/**
 * Tinted pill — health badges and journey phases on the lead tab.
 *
 * Deliberately has no `idle` styling worth reaching for: a phase that has not
 * happened is not rendered at all, so the row only ever states facts.
 */
export function Pill({
  status,
  title,
  strong,
  children,
}: {
  status: Status
  title?: string
  /** Health badges carry the verdict, so they sit a notch heavier than phases. */
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

/** Count badge — used for the red total on the flag-log tab label. */
export function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-1.5 rounded-full bg-bad px-1.5 py-px text-[10px] font-semibold tabular-nums leading-[15px] text-white">
      {count > 999 ? '999+' : count}
    </span>
  )
}

export type Tab<T extends string> = { id: T; label: string; badge?: number }

/** Underlined tab bar. Flat — the active tab is marked by a 1px rule, not a fill. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<T>[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="hairline-b mb-5 flex items-center gap-1" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={[
              // -0.5px pulls the active rule over the container hairline.
              'relative -mb-[0.5px] flex items-center px-2.5 py-2 text-[13px]',
              selected
                ? 'border-b border-ink font-medium text-ink'
                : 'border-b border-transparent text-ink-2 hover:text-ink',
            ].join(' ')}
          >
            {tab.label}
            {tab.badge ? <Badge count={tab.badge} /> : null}
          </button>
        )
      })}
    </div>
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

/**
 * Link out to the n8n execution behind a row.
 *
 * Stops propagation because these sit inside rows that are themselves clickable
 * to expand — following the link should not also toggle the group open.
 */
export function ExecutionLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="underline underline-offset-2 hover:text-ink"
    >
      execution ↗
    </a>
  )
}

/** Compact select used by the flag-log and lead filters. */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
      <span className="text-ink-3">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="hairline rounded-chip bg-bg px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Small on/off pill — used for the reds-only toggle. */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={[
        'hairline rounded-chip px-2 py-1 text-[12px]',
        checked ? 'border-bad/30 bg-bad-soft text-bad' : 'bg-bg text-ink-2 hover:bg-surface',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
