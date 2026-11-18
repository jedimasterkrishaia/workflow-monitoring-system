'use client'

import { useCallback, useRef, useState } from 'react'

import { JOURNEY_QUERY_MAX, sanitizeJourneyQuery, type JourneyPayload } from '@/lib/monitor'
import { EmptyNote, ErrorNote, Section } from '@/components/ui'

/**
 * Lead journey search.
 *
 * The needle is sanitised here as well as in the data layer — not for safety
 * (the server does that regardless) but so the box shows the user the same
 * characters the function will actually receive.
 */
export default function LeadJourney() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<JourneyPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  // Guards against an older search landing after a newer one.
  const latest = useRef(0)

  const search = useCallback(async () => {
    const q = sanitizeJourneyQuery(input)
    if (!q) {
      setResult(null)
      setFailed(null)
      return
    }

    const ticket = ++latest.current
    setLoading(true)
    setFailed(null)

    try {
      const response = await fetch(`/api/journey?q=${encodeURIComponent(q)}`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as JourneyPayload
      if (ticket === latest.current) setResult(payload)
    } catch (err) {
      if (ticket === latest.current) {
        setFailed(err instanceof Error ? err.message : String(err))
        setResult(null)
      }
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [input])

  const subtitle = result
    ? `${result.rows.length} ${result.rows.length === 1 ? 'step' : 'steps'} across ${result.systems.length} ${result.systems.length === 1 ? 'system' : 'systems'}${result.fails ? ` · ${result.fails} failed` : ''}`
    : undefined

  return (
    <Section title="Lead journey" subtitle={subtitle}>
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <input
          type="search"
          value={input}
          maxLength={JOURNEY_QUERY_MAX}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Phone or email"
          aria-label="Phone or email"
          className="hairline w-full max-w-xs rounded-chip bg-bg px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={loading || !sanitizeJourneyQuery(input)}
          className="hairline rounded-chip bg-surface px-2.5 py-1.5 text-[12px] text-ink hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {result && result.rows.length > 0 ? (
          <span className="text-[11px] text-ink-3">{result.systems.join(' · ')}</span>
        ) : null}
      </form>

      {failed ? <ErrorNote>Search failed: {failed}</ErrorNote> : null}
      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}

      {!result ? (
        <EmptyNote>Search a phone number or email to see that lead&rsquo;s timeline.</EmptyNote>
      ) : result.rows.length === 0 ? (
        <EmptyNote>
          Nothing found for &ldquo;{result.q}&rdquo;. Any phone format works, or an email.
        </EmptyNote>
      ) : (
        <div className="hairline overflow-hidden rounded-card">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="hairline-b bg-surface text-left text-[11px] text-ink-3">
                <th className="px-3 py-2 font-medium">Time IST</th>
                <th className="px-3 py-2 font-medium">System</th>
                <th className="px-3 py-2 font-medium">Step</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => {
                const failedRow = row.status === 'fail'
                return (
                  <tr
                    key={`${row.at}-${row.system}-${row.step}-${index}`}
                    className={[
                      index === 0 ? '' : 'hairline-t',
                      // Fail rows in red (spec §mon_journey).
                      failedRow ? 'bg-bad-soft text-bad' : '',
                    ].join(' ')}
                  >
                    <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums text-ink-2">
                      {row.at_ist}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-ink-2">
                      {row.system}
                    </td>
                    <td
                      className={[
                        'px-3 py-2 align-top font-medium',
                        failedRow ? 'text-bad' : 'text-ink',
                      ].join(' ')}
                    >
                      {row.step}
                    </td>
                    <td
                      className={[
                        'px-3 py-2 align-top',
                        failedRow ? 'text-bad' : 'text-ink-2',
                      ].join(' ')}
                    >
                      {row.detail}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
