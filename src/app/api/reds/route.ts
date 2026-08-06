import { NextResponse } from 'next/server'

import { REDS_PAGE_SIZE, getRedsPage } from '@/lib/data'

/**
 * Later pages of the flag log. Page 1 ships with the snapshot; "Load more"
 * comes through here so the 60s poll never has to carry the whole feed.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('offset')
  const parsed = Number.parseInt(raw ?? '0', 10)
  const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  const page = await getRedsPage(offset, REDS_PAGE_SIZE)

  return NextResponse.json(page, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
