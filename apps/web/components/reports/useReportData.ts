'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { reportsV2Api, type TeamQuery } from '@/lib/reports/api'
import type { ReportView } from '@/lib/reports/filters'
import type { AnyViewData, TrendSeries } from '@/lib/reports/types'
import { useReports } from './ReportsContext'

/** Fetch exactly one view. Keys are tenant + role + filters scoped, so views never share a cache across tenants
 *  and switching tabs/drawers reuses (rather than refetches) data for identical filters. */
export function useViewData<T extends AnyViewData>(view: ReportView, team?: TeamQuery) {
  const { queryScope, filters, ready } = useReports()
  return useQuery({
    queryKey: [...queryScope, 'view', view, filters, team ?? null],
    queryFn: () => reportsV2Api.view<T>(view, filters, team),
    enabled: ready,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}

export function useTrend(metric: string, granularity?: string, enabled = true) {
  const { queryScope, filters, ready } = useReports()
  return useQuery<TrendSeries>({
    queryKey: [...queryScope, 'trend', metric, granularity ?? null, filters],
    queryFn: () => reportsV2Api.trend(metric, filters, granularity),
    enabled: ready && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}
