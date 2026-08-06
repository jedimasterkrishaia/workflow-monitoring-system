import {
  DEFAULT_LEAD_PARAMS,
  type LeadHealthFilter,
  type LeadListParams,
  type LeadRange,
} from '@/lib/types'

/**
 * One reading of the lead tab's filters, shared by both API routes and the
 * client that calls them. The snapshot and the "Show more" tail have to agree
 * on what is being filtered, or the tail belongs to a different list than the
 * head — so neither side gets to parse these its own way.
 *
 * No server-only imports here: the browser builds the same query strings.
 */

const RANGES: LeadRange[] = ['7d', '30d', 'all']
const HEALTH_FILTERS: LeadHealthFilter[] = ['all', 'issue', 'stalled']

function oneOf<T extends string>(allowed: T[], value: string | null, fallback: T): T {
  return allowed.includes((value ?? '') as T) ? ((value ?? '') as T) : fallback
}

/** Unknown or missing values fall back to the defaults rather than erroring. */
export function parseLeadParams(params: URLSearchParams): LeadListParams {
  return {
    q: params.get('q') ?? DEFAULT_LEAD_PARAMS.q,
    range: oneOf(RANGES, params.get('range'), DEFAULT_LEAD_PARAMS.range),
    health: oneOf(HEALTH_FILTERS, params.get('health'), DEFAULT_LEAD_PARAMS.health),
    pipeline: params.get('pipeline') ?? DEFAULT_LEAD_PARAMS.pipeline,
  }
}

/** Only non-default values are written, which keeps the polled URL stable and short. */
export function leadParamsToQuery(
  params: LeadListParams,
  extra: Record<string, string> = {},
): string {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.range !== DEFAULT_LEAD_PARAMS.range) search.set('range', params.range)
  if (params.health !== DEFAULT_LEAD_PARAMS.health) search.set('health', params.health)
  if (params.pipeline) search.set('pipeline', params.pipeline)
  for (const [key, value] of Object.entries(extra)) search.set(key, value)
  return search.toString()
}
