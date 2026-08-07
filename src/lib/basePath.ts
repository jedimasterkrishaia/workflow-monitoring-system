/**
 * Single source of truth for the app's basePath.
 *
 * next.config.ts reads this for `basePath`/`assetPrefix`, which makes every
 * page, static asset, and API route resolve under `/pulse` — in both `next
 * dev` and the production build alike. But a raw client-side `fetch('/api/…')`
 * never goes through the router, so it is not rewritten by that config. Every
 * fetch to an internal API route has to prefix its URL with this constant by
 * hand, or it 404s against the un-prefixed path.
 */
export const BASE_PATH = '/pulse'
