import Dashboard from '@/components/Dashboard'
import { getMonitorPayload } from '@/lib/data'

/** Single-page ops screen. Server-renders the first snapshot, then the client polls. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Page() {
  const initialPayload = await getMonitorPayload()
  return <Dashboard initialPayload={initialPayload} />
}
