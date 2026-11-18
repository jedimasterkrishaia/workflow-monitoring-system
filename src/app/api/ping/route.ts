/**
 * Liveness probe for the container healthcheck (docker-compose.yml).
 *
 * Deliberately imports nothing: no Supabase, no data layer. `/` is not usable
 * as a probe because rendering it calls mon_health() and mon_funnels(), which
 * together take several seconds and blew past the healthcheck timeout — the
 * container then never reached "healthy" and Traefik dropped its route, so the
 * site answered 404 while the app itself was perfectly fine.
 *
 * This says only "the Node process is up and routing requests". Whether
 * Supabase is reachable is the dashboard's own job to report, and a database
 * blip should not make Docker kill a working container.
 */

export const dynamic = 'force-static'

export function GET() {
  return new Response('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  })
}
