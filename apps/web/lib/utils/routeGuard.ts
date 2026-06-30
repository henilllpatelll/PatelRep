export const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/reset-password'] as const
export const ALL_ROLES = ['housekeeper', 'engineer', 'housekeeping_supervisor', 'front_desk', 'gm'] as const

export type UserRole = (typeof ALL_ROLES)[number]

const APP_ROLES = new Set<string>(ALL_ROLES)

/** Roles that only use the mobile app — blocked from all web portal routes */
export const MOBILE_ONLY_ROLES = new Set<UserRole>(['housekeeper', 'engineer'])

const ROLE_ROUTE_RULES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: '/dashboard', roles: [...ALL_ROLES] },
  { prefix: '/housekeeping/assignments', roles: ['gm', 'housekeeping_supervisor'] },
  { prefix: '/housekeeping/inspections', roles: ['gm', 'housekeeping_supervisor'] },
  { prefix: '/housekeeping/rooms', roles: ['gm', 'housekeeping_supervisor', 'front_desk'] },
  { prefix: '/housekeeping', roles: ['gm', 'housekeeping_supervisor', 'housekeeper', 'front_desk'] },
  { prefix: '/engineering', roles: ['gm', 'engineer', 'housekeeping_supervisor'] },
  { prefix: '/tasks', roles: [...ALL_ROLES] },
  { prefix: '/scheduling', roles: ['gm', 'housekeeping_supervisor', 'engineer'] },
  { prefix: '/staff', roles: ['gm'] },
  { prefix: '/ai', roles: ['gm', 'housekeeping_supervisor', 'engineer', 'front_desk'] },
  { prefix: '/sop', roles: ['gm', 'housekeeping_supervisor', 'engineer'] },
  { prefix: '/guest-requests', roles: ['gm', 'housekeeping_supervisor', 'front_desk', 'housekeeper'] },
  { prefix: '/logbook', roles: ['housekeeping_supervisor', 'engineer', 'front_desk', 'gm'] },
  { prefix: '/lost-found', roles: ['gm', 'housekeeping_supervisor', 'front_desk'] },
  { prefix: '/reports', roles: ['gm', 'housekeeping_supervisor', 'engineer'] },
  { prefix: '/billing', roles: ['gm'] },
  { prefix: '/settings', roles: ['gm'] },
]

export type RouteAccessDecision =
  | { type: 'allow' }
  | { type: 'redirect'; pathname: string; redirectTo?: string; unauthorized?: string; mobileOnly?: boolean }

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

export function toAppRole(role: unknown): UserRole | null {
  return typeof role === 'string' && APP_ROLES.has(role) ? (role as UserRole) : null
}

export function getAppRoleFromSources(...roles: unknown[]): UserRole | null {
  for (const role of roles) {
    const appRole = toAppRole(role)
    if (appRole) return appRole
  }
  return null
}

function getRouteRoles(pathname: string): UserRole[] | null {
  const match = ROLE_ROUTE_RULES.find(({ prefix }) => pathname === prefix || pathname.startsWith(prefix + '/'))
  return match?.roles ?? null
}

export function getRouteAccessDecision({
  pathname,
  isAuthenticated,
  hasHotel,
  role,
}: {
  pathname: string
  isAuthenticated: boolean
  hasHotel: boolean
  role: UserRole | null | undefined
}): RouteAccessDecision {
  // Mobile-only roles (housekeeper, engineer) can reach public routes
  // (so the login page can show them the "use mobile app" error) but nothing else.
  if (isAuthenticated && role && MOBILE_ONLY_ROLES.has(role)) {
    if (isPublicRoute(pathname)) return { type: 'allow' }
    return { type: 'redirect', pathname: '/login', mobileOnly: true }
  }

  if (isPublicRoute(pathname)) {
    if (isAuthenticated && pathname === '/login') {
      return { type: 'redirect', pathname: '/dashboard' }
    }
    return { type: 'allow' }
  }

  if (!isAuthenticated) {
    return { type: 'redirect', pathname: '/login', redirectTo: pathname }
  }

  if (!hasHotel && pathname !== '/onboarding') {
    return { type: 'redirect', pathname: '/onboarding' }
  }

  const allowedRoles = getRouteRoles(pathname)
  if (!allowedRoles) return { type: 'allow' }

  if (!role) {
    return pathname === '/dashboard'
      ? { type: 'allow' }
      : { type: 'redirect', pathname: '/dashboard', unauthorized: pathname }
  }

  if (!allowedRoles.includes(role)) {
    return { type: 'redirect', pathname: '/dashboard', unauthorized: pathname }
  }

  return { type: 'allow' }
}
