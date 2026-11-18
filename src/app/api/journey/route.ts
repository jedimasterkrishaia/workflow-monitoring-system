import { NextResponse } from 'next/server'

import { getJourney } from '@/lib/data'

/**
 * One lead's timeline — `mon_journey(q)`.
 *
 * `q` is sanitised in the data layer (`[0-9A-Za-z@._+ -]`, 80 chars) and the
 * response echoes back what was actually searched, so the UI can show the
 * needle the function saw rather than the raw input.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const payload = await getJourney(new URL(request.url).searchParams.get('q'))

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
