import { NextResponse } from 'next/server'

import { getHealth } from '@/lib/data'

/**
 * The health board — `mon_health()`. Polled by the page every 60s.
 * All Supabase access happens here, server-side: the service key never leaves
 * the process (spec §API routes).
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const payload = await getHealth()

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
