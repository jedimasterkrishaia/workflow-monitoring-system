import { NextResponse, type NextRequest } from 'next/server'

/**
 * HTTP Basic Auth for the whole dashboard.
 *
 * This is the app's only access control: every page and every /api route reads
 * Supabase with the service_role key, so an unauthenticated request here is a
 * full read of the monitor views. Credentials come from BASIC_AUTH_USER /
 * BASIC_AUTH_PASS (see .env.example).
 */

const REALM = 'KoreFi Workflow Monitor'

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required.\n', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Compares without short-circuiting on the first differing byte, so response
 * time doesn't leak how much of the credential was correct.
 */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/** base64 → UTF-8. `atob` alone yields latin1 and would break non-ASCII passwords. */
function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function middleware(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASS

  if (!user || !pass) {
    // Open in dev so `npm run dev` needs no setup, closed in production: a
    // misconfigured deploy should refuse to serve rather than serve to anyone.
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()

    return new NextResponse('Server misconfigured: BASIC_AUTH_USER / BASIC_AUTH_PASS are unset.\n', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const header = request.headers.get('authorization')
  if (!header || !header.startsWith('Basic ')) return unauthorized()

  let decoded: string
  try {
    decoded = decodeBase64Utf8(header.slice('Basic '.length).trim())
  } catch {
    return unauthorized()
  }

  // Split on the first colon only — passwords are allowed to contain colons.
  const separator = decoded.indexOf(':')
  if (separator === -1) return unauthorized()

  const userOk = safeEqual(decoded.slice(0, separator), user)
  const passOk = safeEqual(decoded.slice(separator + 1), pass)
  if (!(userOk && passOk)) return unauthorized()

  return NextResponse.next()
}

export const config = {
  // Everything except Next's own static output. API routes are deliberately
  // included — they return the same data the page does.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
