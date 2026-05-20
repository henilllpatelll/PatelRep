import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/reset-password']
const ALL_ROLES = ['housekeeper', 'engineer', 'housekeeping_supervisor', 'chief_engineer', 'front_desk', 'gm'] as const

type UserRole = (typeof ALL_ROLES)[number]

const ROLE_ROUTE_RULES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: '/dashboard', roles: [...ALL_ROLES] },
  { prefix: '/housekeeping/assignments', roles: ['gm', 'housekeeping_supervisor'] },
  { prefix: '/housekeeping/inspections', roles: ['gm', 'housekeeping_supervisor'] },
  { prefix: '/housekeeping/rooms', roles: ['gm', 'housekeeping_supervisor', 'front_desk'] },
  { prefix: '/housekeeping', roles: ['gm', 'housekeeping_supervisor', 'housekeeper', 'front_desk'] },
  { prefix: '/engineering', roles: ['gm', 'chief_engineer', 'engineer'] },
  { prefix: '/tasks', roles: [...ALL_ROLES] },
  { prefix: '/scheduling', roles: ['gm', 'housekeeping_supervisor', 'chief_engineer'] },
  { prefix: '/staff', roles: ['gm'] },
  { prefix: '/ai', roles: ['gm', 'housekeeping_supervisor', 'chief_engineer'] },
  { prefix: '/sop', roles: ['gm', 'housekeeping_supervisor', 'chief_engineer'] },
  { prefix: '/guest-requests', roles: ['gm', 'housekeeping_supervisor', 'front_desk'] },
  { prefix: '/logbook', roles: [...ALL_ROLES] },
  { prefix: '/lost-found', roles: ['gm', 'housekeeping_supervisor', 'front_desk'] },
  { prefix: '/reports', roles: ['gm', 'housekeeping_supervisor', 'chief_engineer'] },
  { prefix: '/billing', roles: ['gm'] },
  { prefix: '/settings', roles: ['gm'] },
]

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

function decodeJwtClaims(accessToken: string | undefined): Record<string, unknown> {
  if (!accessToken) return {}
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return {}
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function getRouteRoles(pathname: string): UserRole[] | null {
  const match = ROLE_ROUTE_RULES.find(({ prefix }) => pathname === prefix || pathname.startsWith(prefix + '/'))
  return match?.roles ?? null
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          request.cookies.set(name, value)
          supabaseResponse = NextResponse.next({ request })
          supabaseResponse.cookies.set(name, value, options as any)
        },
        remove(name: string, options: Record<string, unknown>) {
          request.cookies.set(name, '')
          supabaseResponse = NextResponse.next({ request })
          supabaseResponse.cookies.set(name, '', options as any)
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const jwtClaims = decodeJwtClaims(session?.access_token)

  const { pathname } = request.nextUrl

  // Allow public routes through for everyone
  if (isPublicRoute(pathname)) {
    // If already authenticated and hitting /login, redirect to dashboard
    if (user && pathname === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Not authenticated — redirect to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Preserve the intended destination so we can redirect after login
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated but no hotel_id — redirect to onboarding
  // Check JWT claims first (app_metadata via hook, user_metadata as fallback),
  // then fall back to the pr_hotel_id cookie set by the onboarding page on hotel creation.
  const hotelId =
    (jwtClaims.hotel_id as string | undefined) ??
    (user.app_metadata as Record<string, unknown>)?.hotel_id ??
    (user.user_metadata as Record<string, unknown>)?.hotel_id ??
    request.cookies.get('pr_hotel_id')?.value

  if (!hotelId && pathname !== '/onboarding') {
    const url = request.nextUrl.clone()
    url.pathname = '/onboarding'
    return NextResponse.redirect(url)
  }

  const role =
    (jwtClaims.role as UserRole | undefined) ??
    ((user.app_metadata as Record<string, unknown>)?.role as UserRole | undefined) ??
    ((user.user_metadata as Record<string, unknown>)?.role as UserRole | undefined)
  const allowedRoles = getRouteRoles(pathname)

  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.searchParams.set('unauthorized', pathname)
    return NextResponse.redirect(url)
  }

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
