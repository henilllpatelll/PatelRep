import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/reset-password']

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as any),
          )
        },
      },
    },
  )

  // IMPORTANT: Do not write any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

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
  // Check both JWT app_metadata and user_metadata (the hook may not have run yet)
  const hotelId =
    (user.app_metadata as Record<string, unknown>)?.hotel_id ??
    (user.user_metadata as Record<string, unknown>)?.hotel_id

  if (!hotelId && pathname !== '/onboarding') {
    const url = request.nextUrl.clone()
    url.pathname = '/onboarding'
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
