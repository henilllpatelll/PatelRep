'use client'

// One source of truth for the Reports experience: URL-synced filters, active view, and the
// single active drawer. Everything is derived from the URL so refresh, deep links and browser
// back/forward all behave, and nothing sensitive is stored outside the query string.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { reportsV2Api } from '@/lib/reports/api'
import {
  REPORT_VIEWS,
  filtersFromParams,
  filtersToParams,
  hotelToday,
  parseView,
  type ReportFilters,
  type ReportView,
} from '@/lib/reports/filters'
import { CLOSED, drawerToParams, parseDrawer, sameDrawer, type DrawerState } from '@/lib/reports/drawerState'
import type { Capabilities, MetricDefinition } from '@/lib/reports/types'
import { useRole } from '@/lib/hooks/useRole'
import { useHotelStore } from '@/stores/hotelStore'

interface ReportsContextValue {
  ready: boolean
  hotelId: string | null
  role: string | null
  timezone: string
  today: string
  filters: ReportFilters
  setFilters: (patch: Partial<ReportFilters>) => void
  view: ReportView | null
  allowedViews: ReportView[]
  setView: (view: ReportView) => void
  capabilities: Capabilities | undefined
  capabilitiesError: boolean
  definitions: Record<string, MetricDefinition> | undefined
  drawer: DrawerState
  openDrawer: (state: DrawerState) => void
  closeDrawer: () => void
  goBack: () => void
  canGoBack: boolean
  /** Prefix for every React Query key: tenant + role scoped so caches can never cross tenants. */
  queryScope: readonly unknown[]
}

const ReportsContext = createContext<ReportsContextValue | null>(null)

export function useReports(): ReportsContextValue {
  const value = useContext(ReportsContext)
  if (!value) throw new Error('useReports must be used inside <ReportsProvider>')
  return value
}

export function ReportsProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { role } = useRole()
  const hotel = useHotelStore((s) => s.hotel)
  const hotelId = hotel?.id ?? null
  const timezone = hotel?.timezone || 'America/Chicago'
  const today = hotelToday(timezone)
  // Drawers we drilled through (in-memory only); the browser history still drives back/forward.
  const [stack, setStack] = useState<DrawerState[]>([])

  const capabilitiesQuery = useQuery({
    queryKey: ['reports', hotelId, role, 'capabilities'],
    queryFn: reportsV2Api.capabilities,
    enabled: !!hotelId && !!role,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const capabilities = capabilitiesQuery.data
  const definitionsQuery = useQuery({
    queryKey: ['reports', hotelId, role, 'definitions'],
    queryFn: reportsV2Api.definitions,
    enabled: !!hotelId && !!capabilities?.views.length,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  })

  const allowedViews = useMemo(
    () => REPORT_VIEWS.filter((v) => capabilities?.views.includes(v)),
    [capabilities],
  )
  const paramsKey = searchParams.toString()
  const filters = useMemo(
    () => filtersFromParams(new URLSearchParams(paramsKey), today, capabilities?.departments),
    [paramsKey, today, capabilities?.departments],
  )
  const view = useMemo<ReportView | null>(() => {
    const requested = parseView(new URLSearchParams(paramsKey).get('view'), allowedViews)
    return requested ?? allowedViews[0] ?? null
  }, [paramsKey, allowedViews])
  const drawer = useMemo<DrawerState>(() => {
    const parsed = parseDrawer(new URLSearchParams(paramsKey))
    // A drawer only exists for a view the caller may open; the API enforces the rest.
    return view ? parsed : CLOSED
  }, [paramsKey, view])

  const push = useCallback(
    (params: URLSearchParams, replace = false) => {
      const query = params.toString()
      const url = query ? `${pathname}?${query}` : pathname
      if (replace) router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    },
    [pathname, router],
  )
  const current = useCallback(() => new URLSearchParams(paramsKey), [paramsKey])

  const setFilters = useCallback(
    (patch: Partial<ReportFilters>) => {
      const next = { ...filters, ...patch }
      // Switching away from a custom range keeps the chosen preset's dates authoritative.
      const params = filtersToParams(next, drawerToParams(CLOSED, current()))
      push(params)
    },
    [filters, current, push],
  )

  const setView = useCallback(
    (next: ReportView) => {
      setStack([])
      const params = drawerToParams(CLOSED, current())
      params.set('view', next)
      push(params)
    },
    [current, push],
  )

  const openDrawer = useCallback(
    (state: DrawerState) => {
      if (drawer.kind !== 'closed' && !sameDrawer(drawer, state)) setStack((s) => [...s, drawer])
      push(drawerToParams(state, current()))
    },
    [drawer, current, push],
  )
  const closeDrawer = useCallback(() => {
    setStack([])
    push(drawerToParams(CLOSED, current()), true)
  }, [current, push])
  const goBack = useCallback(() => {
    const previous = stack[stack.length - 1]
    if (previous) {
      setStack((s) => s.slice(0, -1))
      push(drawerToParams(previous, current()), true)
    } else closeDrawer()
  }, [stack, current, push, closeDrawer])

  const queryScope = useMemo(() => ['reports', hotelId, role] as const, [hotelId, role])

  const value: ReportsContextValue = {
    ready: !!hotelId && !!role && !capabilitiesQuery.isLoading,
    hotelId,
    role,
    timezone,
    today,
    filters,
    setFilters,
    view,
    allowedViews,
    setView,
    capabilities,
    capabilitiesError: capabilitiesQuery.isError,
    definitions: definitionsQuery.data,
    drawer,
    openDrawer,
    closeDrawer,
    goBack,
    canGoBack: stack.length > 0 && drawer.kind !== 'closed',
    queryScope,
  }
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>
}
