import { NextResponse, type NextRequest } from 'next/server'

/**
 * HTTP Basic Auth over the whole app (spec §Decisions).
 *
 * The lead journey shows names, phone numbers and WhatsApp message text, so
 * there is no public surface here — the API routes are behind it too, not just
 * the page.
 */

const REALM = 'AiA System Monitor'

function challenge(): NextResponse {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Length-independent, content-constant comparison.
 *
 * `===` on secrets leaks their prefix through timing. node:crypto's
 * timingSafeEqual is not available in the middleware runtime, so this is the
 * same idea by hand: always walk the full longer string, accumulating
 * differences instead of returning at the first one.
 */
function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

export function middleware(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASS

  // Fail closed. An unset password on a dashboard holding lead phone numbers
  // must not quietly serve it to the internet — a deploy that forgot the env
  // var should be obvious immediately.
  if (!user || !pass) {
    return new NextResponse(
      'Basic auth is not configured: set BASIC_AUTH_USER and BASIC_AUTH_PASS.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const [scheme, encoded] = header.split(' ')
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return challenge()

  let decoded: string
  try {
    decoded = atob(encoded)
  } catch {
    return challenge()
  }

  // Only the first colon separates the pair; a password may contain more.
  const separator = decoded.indexOf(':')
  if (separator === -1) return challenge()

  const okUser = safeEqual(decoded.slice(0, separator), user)
  const okPass = safeEqual(decoded.slice(separator + 1), pass)
  // Both are always evaluated, so a wrong username and a wrong password cost
  // the same — the response cannot be used to confirm a valid username.
  if (!okUser || !okPass) return challenge()

  return NextResponse.next()
}

export const config = {
  /**
   * Everything except Next's build output and the favicon.
   *
   * _next/static and _next/image carry no lead data, and exempting them keeps
   * the 401 challenge from re-firing on every asset of an unauthenticated page
   * load. The page, the three API routes and anything added later are covered.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
