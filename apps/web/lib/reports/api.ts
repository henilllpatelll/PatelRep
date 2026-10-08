// Typed client for the Reports API. Unwraps the {data} envelope.
import { apiClient } from '@/lib/api/client'
import { filterQuery, type ReportFilters, type ReportView } from './filters'
import type {
  AnyViewData,
  Capabilities,
  DeliveryRow,
  DeliveryStatus,
  EmployeeData,
  MetricDefinition,
  RecordsResult,
  ReportSchedule,
  RoomAssetData,
  ScheduleInput,
  SchedulePreview,
  SegmentsData,
  TrendSeries,
} from './types'

async function unwrap<T>(promise: Promise<any>): Promise<T> {
  const response = await promise
  return response?.data as T
}

export interface TeamQuery {
  page?: number
  per_page?: number
  search?: string
  role?: string
  sort?: string
  desc?: boolean
}

// Only these views accept a department filter on the server (the others are fixed to one department).
const DEPARTMENT_AWARE_VIEWS: ReportView[] = ['overview', 'guest-experience', 'team']

export const reportsV2Api = {
  capabilities: () => unwrap<Capabilities>(apiClient.get('/reports/capabilities')),
  definitions: () => unwrap<Record<string, MetricDefinition>>(apiClient.get('/reports/definitions')),

  view: <T extends AnyViewData = AnyViewData>(view: ReportView, filters: ReportFilters, team?: TeamQuery) =>
    unwrap<T>(
      apiClient.get(`/reports/views/${view}`, {
        params: {
          ...filterQuery(filters, DEPARTMENT_AWARE_VIEWS.includes(view)),
          ...(view === 'team' ? team : {}),
        },
      }),
    ),

  trend: (metric: string, filters: ReportFilters, granularity?: string) =>
    unwrap<TrendSeries>(apiClient.get('/reports/trends', { params: { metric, granularity, ...filterQuery(filters) } })),

  segments: (metric: string, dimension: string, filters: ReportFilters) =>
    unwrap<SegmentsData>(apiClient.get('/reports/segments', { params: { metric, dimension, ...filterQuery(filters) } })),

  records: (
    params: { kind: string; filter: string; page?: number; per_page?: number; search?: string } & Record<string, string | number | undefined>,
    filters: ReportFilters,
  ) => unwrap<RecordsResult>(apiClient.get('/reports/records', { params: { ...filterQuery(filters), ...params } })),

  employee: (userId: string, filters: ReportFilters) =>
    unwrap<EmployeeData>(apiClient.get(`/reports/employee/${encodeURIComponent(userId)}`, { params: filterQuery(filters, false) })),

  roomAsset: (kind: 'room' | 'asset', id: string, filters: ReportFilters) =>
    unwrap<RoomAssetData>(
      apiClient.get(`/reports/room-asset/${kind}/${encodeURIComponent(id)}`, { params: filterQuery(filters, false) }),
    ),

  // ── Export ──
  exportPath: (
    view: ReportView,
    format: 'csv' | 'pdf',
    filters: ReportFilters,
    options: { include_charts: boolean; include_definitions: boolean; include_exceptions: boolean },
  ) => {
    const params = new URLSearchParams()
    const query: Record<string, string | boolean | undefined> = {
      view,
      format,
      ...filterQuery(filters, DEPARTMENT_AWARE_VIEWS.includes(view)),
      ...options,
    }
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, String(value))
    })
    return `/reports/export?${params.toString()}`
  },
  download: (path: string) => apiClient.download(path),

  // ── Schedules ──
  deliveryStatus: () => unwrap<DeliveryStatus>(apiClient.get('/reports/delivery-status')),
  schedules: () => unwrap<ReportSchedule[]>(apiClient.get('/reports/schedules')),
  recipients: (reportType: string, department?: string) =>
    unwrap<Array<{ user_id: string; name: string; role: string; department: string | null }>>(
      apiClient.get('/reports/schedules/recipients', { params: { report_type: reportType, department } }),
    ),
  previewSchedule: (body: ScheduleInput) => unwrap<SchedulePreview>(apiClient.post('/reports/schedules/preview', body)),
  createSchedule: (body: ScheduleInput) => unwrap<ReportSchedule>(apiClient.post('/reports/schedules', body)),
  updateSchedule: (id: string, body: Partial<ScheduleInput> & { enabled?: boolean }) =>
    unwrap<ReportSchedule>(apiClient.patch(`/reports/schedules/${id}`, body)),
  deleteSchedule: (id: string) => apiClient.delete(`/reports/schedules/${id}`),
  deliveries: (id: string) => unwrap<DeliveryRow[]>(apiClient.get(`/reports/schedules/${id}/deliveries`)),
  retryDelivery: (scheduleId: string, deliveryId: string) =>
    unwrap<{ status: string; error_summary: string | null }>(
      apiClient.post(`/reports/schedules/${scheduleId}/deliveries/${deliveryId}/retry`),
    ),
}
