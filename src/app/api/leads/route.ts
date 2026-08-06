import { NextResponse } from 'next/server'

import { LEAD_PAGE_SIZE, getLeadsPage } from '@/lib/data'
import { parseLeadParams } from '@/lib/leadParams'

/**
 * Later pages of the lead list. Page 1 ships with the snapshot; "Show more"
 * comes through here, carrying the same filters so the tail matches the head.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const parsed = Number.parseInt(params.get('offset') ?? '0', 10)
  const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  const page = await getLeadsPage(parseLeadParams(params), offset, LEAD_PAGE_SIZE)

  return NextResponse.json(page, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
