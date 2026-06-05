import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getAppRoleFromSources, getRouteAccessDecision, type RouteAccessDecision } from '@/lib/utils/routeGuard'

function decodeJwtClaims(accessToken: string | undefined): Record<string, unknown> {
  if (!accessToken) return {}
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return {}
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function redirectFromDecision(request: NextRequest, decision: Extract<RouteAccessDecision, { type: 'redirect' }>) {
  const url = request.nextUrl.clone()
  url.pathname = decision.pathname
  url.search = ''
  if (decision.redirectTo) url.searchParams.set('redirectTo', decision.redirectTo)
  if (decision.unauthorized) url.searchParams.set('unauthorized', decision.unauthorized)
  return NextResponse.redirect(url)
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() verifies the token with the Supabase Auth server on every request.
  const [{ data: sessionData }, { data: userData }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ])
  const user = userData.user ?? null
  const jwtClaims = decodeJwtClaims(sessionData.session?.access_token)

  const { pathname } = request.nextUrl
  const hotelId =
    (jwtClaims.hotel_id as string | undefined) ??
    (user?.app_metadata as Record<string, unknown> | undefined)?.hotel_id ??
    (user?.user_metadata as Record<string, unknown> | undefined)?.hotel_id ??
    request.cookies.get('pr_hotel_id')?.value
  const role = getAppRoleFromSources(
    jwtClaims.user_role,
    jwtClaims.role,
    (user?.app_metadata as Record<string, unknown> | undefined)?.role,
    (user?.user_metadata as Record<string, unknown> | undefined)?.role,
    request.cookies.get('pr_role')?.value,
  )

  const decision = getRouteAccessDecision({
    pathname,
    isAuthenticated: !!user,
    hasHotel: !!hotelId,
    role,
  })

  if (decision.type === 'redirect') return redirectFromDecision(request, decision)

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (Next.js static files)
     * - _next/image   (Next.js image optimization)
     * - favicon.ico
     * - robots.txt
     * - Any file with an extension (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|eot|mp4|webm)$).*)',
  ],
}
