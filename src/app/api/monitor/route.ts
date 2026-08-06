import { NextResponse } from 'next/server'

import { getMonitorPayload } from '@/lib/data'
import { parseLeadParams } from '@/lib/leadParams'

/**
 * Snapshot endpoint polled by the dashboard every 60s.
 * All Supabase access happens here, server-side — the service key never leaves
 * the process (spec §Stack).
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const payload = await getMonitorPayload(parseLeadParams(new URL(request.url).searchParams))

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
