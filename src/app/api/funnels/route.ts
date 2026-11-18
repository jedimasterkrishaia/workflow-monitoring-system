import { NextResponse } from 'next/server'

import { getFunnels } from '@/lib/data'

/**
 * The funnels — `mon_funnels(today - days, today)` on the IST calendar.
 *
 * `days` is clamped to 0..60 in the data layer, so a hand-typed `?days=9999`
 * becomes 60 rather than a 30-second query.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const payload = await getFunnels(new URL(request.url).searchParams.get('days'))

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
