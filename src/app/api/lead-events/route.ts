import { NextResponse } from 'next/server'

import { getLeadEvents } from '@/lib/data'

/**
 * Event timeline for a single lead, fetched when its row is first expanded.
 * Like /api/monitor, all Supabase access stays server-side (spec §Stack).
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const phone = new URL(request.url).searchParams.get('phone')?.trim() ?? ''

  if (!phone) {
    return NextResponse.json(
      { events: [], configured: true, error: 'phone is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  const payload = await getLeadEvents(phone)

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
