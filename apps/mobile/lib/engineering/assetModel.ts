/* ─── Asset inventory model ─────────────────────────────────────────────────
   Pure rules for the Assets list: the row the API returns, the filters the sheet edits, and the exact request a set of
   filters becomes. Every filter is applied by the server over the whole property inventory, never over the page on
   screen. `service_status` is derived by the API (active downtime impact, else a repair in progress, else operational);
   it is a display value, not a stored column, and it is deliberately separate from predictive risk. */

export type AssetServiceStatus = "operational" | "degraded" | "out_of_service" | "under_repair";

export interface AssetRow {
  id: string;
  name: string;
  asset_tag?: string | null;
  category_id?: string | null;
  room_id?: string | null;
  location_text?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  failure_risk_score?: number | null;
  updated_at?: string | null;
  asset_categories?: { name?: string | null; code?: string | null } | null;
  rooms?: { room_number?: string | null; floor?: number | null; building?: string | null } | null;
  active_downtime?: { id?: string; started_at?: string; impact_level?: string; downtime_type?: string; work_order_id?: string | null; elapsed_minutes?: number } | null;
  service_status: AssetServiceStatus;
  active_work_order_count: number;
  next_pm_due_at?: string | null;
  pm_overdue: boolean;
  pm_due_soon: boolean;
  last_serviced_at?: string | null;
  repeat_repairs_90d: number;
  has_active_prediction: boolean;
  had_downtime_365d: boolean;
}

export interface AssetPage {
  rows: AssetRow[];
  /** The server says another page exists. Never inferred from a short page. */
  hasMore: boolean;
  total: number;
}

export const ASSET_QUICK_FILTERS = ["all", "attention", "out_of_service", "active_repairs"] as const;
export type AssetQuickFilter = (typeof ASSET_QUICK_FILTERS)[number];

export const ASSET_SERVICE_STATUSES: readonly AssetServiceStatus[] = ["operational", "degraded", "out_of_service", "under_repair"];
export const ASSET_MAINTENANCE_FILTERS = ["active_work_order", "pm_overdue", "pm_due_soon", "none"] as const;
export type AssetMaintenanceFilter = (typeof ASSET_MAINTENANCE_FILTERS)[number];
export const ASSET_RELIABILITY_FILTERS = ["active_prediction", "repeat_repairs", "confirmed_downtime"] as const;
export type AssetReliabilityFilter = (typeof ASSET_RELIABILITY_FILTERS)[number];
export const ASSET_SORTS = ["name", "location", "last_serviced", "next_pm", "risk", "updated"] as const;
export type AssetSort = (typeof ASSET_SORTS)[number];

export interface AssetFilters {
  quick: AssetQuickFilter;
  categoryId: string | null;
  status: AssetServiceStatus | null;
  maintenance: AssetMaintenanceFilter | null;
  reliability: AssetReliabilityFilter | null;
  floor: number | null;
  building: string | null;
  sort: AssetSort;
}

export const EMPTY_ASSET_FILTERS: AssetFilters = {
  quick: "all",
  categoryId: null,
  status: null,
  maintenance: null,
  reliability: null,
  floor: null,
  building: null,
  sort: "name",
};

export const ASSET_PAGE_SIZE = 25;

/** Sheet criteria in force (the quick chips and the search text show their own state). */
export function activeAssetFilterCount(filters: AssetFilters): number {
  return [
    filters.categoryId != null,
    filters.status != null,
    filters.maintenance != null,
    filters.reliability != null,
    filters.floor != null,
    !!filters.building?.trim(),
    filters.sort !== "name",
  ].filter(Boolean).length;
}

export function hasAnyAssetFilter(filters: AssetFilters, query: string): boolean {
  return filters.quick !== "all" || activeAssetFilterCount(filters) > 0 || query.trim() !== "";
}

/** The request for one page. A quick chip and a sheet criterion on the same field never contradict: the sheet wins. */
export function assetBrowseParams(filters: AssetFilters, query: string, page: number): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = { page, per_page: ASSET_PAGE_SIZE, sort_by: filters.sort };
  const q = query.trim();
  if (q) params.q = q;
  if (filters.categoryId) params.category_id = filters.categoryId;
  if (filters.floor != null) params.floor = filters.floor;
  const building = filters.building?.trim();
  if (building) params.building = building;
  const status = filters.status ?? (filters.quick === "out_of_service" ? "out_of_service" : null);
  if (status) params.status = status;
  const maintenance = filters.maintenance ?? (filters.quick === "active_repairs" ? "active_work_order" : null);
  if (maintenance) params.maintenance = maintenance;
  if (filters.reliability) params.reliability = filters.reliability;
  if (filters.quick === "attention") params.attention = true;
  return params;
}

/** A stable key for one request (page excluded): results from a different key are never mixed in. */
export function assetBrowseKey(filters: AssetFilters, query: string): string {
  const { page: _page, ...rest } = assetBrowseParams(filters, query, 1);
  return JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
}

export function mergeAssetPages(existing: readonly AssetRow[], incoming: readonly AssetRow[]): AssetRow[] {
  const seen = new Set(existing.map((row) => row.id));
  const merged = [...existing];
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

export interface AssetCardModel {
  id: string;
  title: string;
  /** `AC-312 · HVAC` pieces, tag first. */
  tag: string | null;
  category: string | null;
  room: string | null;
  locationText: string | null;
  status: AssetServiceStatus;
  /** Active repairs on the equipment, shown as its own indicator beside the service status. */
  activeRepairs: number;
  pmOverdue: boolean;
  hasPrediction: boolean;
}

export function assetCardModel(row: AssetRow): AssetCardModel {
  return {
    id: row.id,
    title: row.name,
    tag: row.asset_tag?.trim() || null,
    category: row.asset_categories?.name?.trim() || null,
    room: row.rooms?.room_number?.trim() || null,
    locationText: row.location_text?.trim() || null,
    status: row.service_status,
    activeRepairs: row.active_work_order_count ?? 0,
    pmOverdue: !!row.pm_overdue,
    hasPrediction: !!row.has_active_prediction,
  };
}

export type AssetEventType =
  | "downtime_started"
  | "downtime_restored"
  | "work_order_created"
  | "repair_completed"
  | "pm_completed"
  | "reading_recorded";

export interface AssetEvent {
  /** Stable across rebuilds: `<type>:<source id>`. */
  key: string;
  type: AssetEventType;
  at: string;
  /** Free text from the record itself (work order title, PM name, meter name); never composed here. */
  label: string | null;
  workOrderId?: string | null;
  recordId?: string | null;
  scheduleId?: string | null;
  impact?: string | null;
}

export interface AssetEventSources {
  downtime: ReadonlyArray<{ id: string; started_at: string; restored_at?: string | null; impact_level?: string; work_order_id?: string | null }>;
  workOrders: ReadonlyArray<{ id: string; title: string; created_at?: string | null; completed_at?: string | null; status: string }>;
  pmCompletions: ReadonlyArray<{ id: string; pm_schedule_id: string; completed_at: string; schedule_name: string | null }>;
  readings: ReadonlyArray<{ id: string; recorded_at: string; meter: string }>;
}

export const ASSET_EVENT_LIMIT = 30;

/**
 * One newest-first history from records the screen already holds. Only things the data states become events: a
 * restore appears only when a restore time was recorded, and nothing is inferred (a completed work order does not
 * imply the asset was restored).
 */
export function buildAssetTimeline(sources: AssetEventSources, limit = ASSET_EVENT_LIMIT): AssetEvent[] {
  const events: AssetEvent[] = [];
  const push = (event: AssetEvent) => {
    if (Number.isFinite(Date.parse(event.at))) events.push(event);
  };
  for (const d of sources.downtime) {
    push({ key: `downtime_started:${d.id}`, type: "downtime_started", at: d.started_at, label: null, impact: d.impact_level ?? null, workOrderId: d.work_order_id ?? null });
    if (d.restored_at) push({ key: `downtime_restored:${d.id}`, type: "downtime_restored", at: d.restored_at, label: null, workOrderId: d.work_order_id ?? null });
  }
  for (const wo of sources.workOrders) {
    if (wo.created_at) push({ key: `work_order_created:${wo.id}`, type: "work_order_created", at: wo.created_at, label: wo.title, workOrderId: wo.id });
    if (wo.status === "completed" && wo.completed_at) push({ key: `repair_completed:${wo.id}`, type: "repair_completed", at: wo.completed_at, label: wo.title, workOrderId: wo.id });
  }
  for (const pm of sources.pmCompletions) {
    push({ key: `pm_completed:${pm.id}`, type: "pm_completed", at: pm.completed_at, label: pm.schedule_name, recordId: pm.id, scheduleId: pm.pm_schedule_id });
  }
  for (const r of sources.readings) {
    push({ key: `reading_recorded:${r.id}`, type: "reading_recorded", at: r.recorded_at, label: r.meter, recordId: r.id });
  }
  const seen = new Set<string>();
  return events
    .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/** Risk bands for the prediction signal only. They never change the service status. */
export function riskBand(score: number | null | undefined): "high" | "elevated" | "low" | null {
  if (score == null) return null;
  if (score >= 70) return "high";
  if (score >= 40) return "elevated";
  return "low";
}

/* ─── History filter ────────────────────────────────────────────────────────
   The History timeline mixes six kinds of event. Each belongs to exactly one group, so a chip shows precisely the events
   that group names and nothing is counted twice. Pure functions over the events already loaded: nothing is fetched. */

export const ASSET_HISTORY_GROUPS = ["all", "pm", "repairs", "downtime", "readings"] as const;
export type AssetHistoryGroup = (typeof ASSET_HISTORY_GROUPS)[number];

const GROUP_BY_EVENT: Record<AssetEventType, Exclude<AssetHistoryGroup, "all">> = {
  pm_completed: "pm",
  work_order_created: "repairs",
  repair_completed: "repairs",
  downtime_started: "downtime",
  downtime_restored: "downtime",
  reading_recorded: "readings",
};

export function historyGroupOf(type: AssetEventType): Exclude<AssetHistoryGroup, "all"> {
  return GROUP_BY_EVENT[type];
}

export function filterAssetEvents<T extends { type: AssetEventType }>(events: readonly T[], group: AssetHistoryGroup): readonly T[] {
  return group === "all" ? events : events.filter((event) => GROUP_BY_EVENT[event.type] === group);
}

/** How many events each group holds. `all` is the total, so the chips always add up. */
export function historyGroupCounts(events: readonly { type: AssetEventType }[]): Record<AssetHistoryGroup, number> {
  const counts: Record<AssetHistoryGroup, number> = { all: events.length, pm: 0, repairs: 0, downtime: 0, readings: 0 };
  for (const event of events) counts[GROUP_BY_EVENT[event.type]] += 1;
  return counts;
}

/* ─── Equipment detail deep link + directory quick actions ───────────────── */

export const ASSET_SECTIONS = ["overview", "maintenance", "readings", "history"] as const;
export type AssetSectionKey = (typeof ASSET_SECTIONS)[number];

/** The `section` link parameter, accepted only when it names a real section: anything else opens Overview. */
export function parseAssetSection(value: unknown): AssetSectionKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return (ASSET_SECTIONS as readonly unknown[]).includes(raw) ? (raw as AssetSectionKey) : "overview";
}

export type AssetQuickAction = "open" | "report" | "reading" | "maintenance" | "label";

export interface QuickActionContext {
  isOnline: boolean;
  /** The person's role may record readings (the same rule the detail screen applies). */
  canRecordReading: boolean;
}

export interface QuickActionItem {
  action: AssetQuickAction;
  /** Shown but not usable, with the reason the label should give. */
  disabled: boolean;
}

/**
 * The actions offered for one directory row. Only things that can be done from what the row already says: opening the
 * record, reporting an issue (creating needs the network), jumping to its readings or maintenance, and its QR label.
 * Roles are never widened here; recording a reading is offered only when the detail screen would offer it too.
 */
export function assetQuickActions(row: Pick<AssetRow, "id">, context: QuickActionContext): QuickActionItem[] {
  if (!row.id) return [];
  const items: QuickActionItem[] = [
    { action: "open", disabled: false },
    { action: "report", disabled: !context.isOnline },
  ];
  if (context.canRecordReading) items.push({ action: "reading", disabled: false });
  items.push({ action: "maintenance", disabled: false }, { action: "label", disabled: false });
  return items;
}
