import Monitor from '@/components/Monitor'
import { getFunnels, getHealth } from '@/lib/data'
import { DEFAULT_FUNNEL_DAYS } from '@/lib/monitor'

/**
 * Single-page ops screen. Server-renders the health board and the default
 * 7-day funnels, then the client polls health every 60s.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Page() {
  const [health, funnels] = await Promise.all([getHealth(), getFunnels(DEFAULT_FUNNEL_DAYS)])

  return <Monitor initialHealth={health} initialFunnels={funnels} />
}
