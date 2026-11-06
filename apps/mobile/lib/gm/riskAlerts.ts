/* ─── Risk alerts: the real API contract ─────────────────────────────────────
   `GET /ai/risk-alerts` is a deterministic exception feed (no AI credit cost) shaped as an OBJECT of six lists,
   not an array, and it has no severity field. Older mobile code (and its fixtures) read an array of alerts with a
   `severity`. `adaptRiskAlerts` accepts both. For the real shape, nothing is scored: an item's tier follows the
   server's own selection rule for its list (the server only returns room predictions whose level is HIGH, and only
   work orders already past their due time), and the label names the source. */

export type AlertKind = "room_risk" | "sla_breach" | "asset_risk" | "low_stock" | "guest_issue" | "recurring" | "legacy";

/** "attention" = the server already judged it overdue / high-risk; "watch" = surfaced for awareness. */
export type AlertTier = "attention" | "watch";

export interface AlertItem {
  id: string;
  kind: AlertKind;
  tier: AlertTier;
  /** Legacy payloads only: the original severity. Real payloads carry none. */
  severity: "low" | "medium" | "high" | "critical" | null;
  title: string;
  description: string;
  roomNumber: string | null;
  assetName: string | null;
  /** SLA breaches: when the work order was due. Legacy: when the alert was created. */
  timestamp: string | null;
  /** Source facts, rendered through translated templates (never pre-formatted English). */
  facts: {
    workOrderNumber?: string;
    score?: number;
    onHand?: number;
    minimum?: number;
    woCount?: number;
    windowDays?: number;
    minutesToCheckin?: number;
    factors?: string[];
  };
  /** Existing in-app destination for this item, or null when none exists. */
  href: string | null;
}

type Dict = Record<string, unknown>;
const asList = (v: unknown): Dict[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Dict[]) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null ? null : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export const ASSET_RISK_CAP = 5;
export const GUEST_ISSUE_CAP = 10;

export interface RiskAlertsResult {
  items: AlertItem[];
  /** Lists the server truncates (asset risks to 5, guest issues to 10): when full, more may exist. */
  cappedKinds: AlertKind[];
}

const EMPTY_FACTS = {};

export function adaptRiskAlerts(data: unknown): RiskAlertsResult {
  if (Array.isArray(data)) {
    const items = asList(data).map((a, i): AlertItem => {
      const severity = (str(a.severity) as AlertItem["severity"]) ?? null;
      return {
        id: str(a.id) ?? `legacy-${i}`,
        kind: "legacy",
        tier: severity === "critical" || severity === "high" ? "attention" : "watch",
        severity,
        title: str(a.title) ?? "",
        description: str(a.description) ?? "",
        roomNumber: str(a.room_number),
        assetName: str(a.asset_name),
        timestamp: str(a.created_at),
        facts: EMPTY_FACTS,
        href: null,
      };
    });
    return { items, cappedKinds: [] };
  }
  if (!data || typeof data !== "object") return { items: [], cappedKinds: [] };
  const d = data as Dict;
  const items: AlertItem[] = [];
  const capped: AlertKind[] = [];
  const base = { severity: null, assetName: null, roomNumber: null, timestamp: null, description: "", href: null } as const;

  asList(d.sla_breaches).forEach((w, i) => {
    const number = str(w.work_order_number) ?? undefined;
    items.push({ ...base, id: `sla-${number ?? i}`, kind: "sla_breach", tier: "attention", title: str(w.title) ?? "", timestamp: str(w.due_at), facts: { workOrderNumber: number }, href: "/(app)/work-orders" });
  });
  asList(d.housekeeping_risks).forEach((r, i) => {
    const room = str((r.rooms as Dict | null)?.room_number);
    const factors = Array.isArray(r.risk_factors) ? (r.risk_factors as unknown[]).filter((f): f is string => typeof f === "string") : undefined;
    items.push({
      ...base,
      id: `room-${str(r.room_id) ?? i}`,
      kind: "room_risk",
      tier: "attention",
      title: room ?? "",
      roomNumber: room,
      facts: { minutesToCheckin: num(r.minutes_to_checkin), factors },
      href: "/(app)/room-status",
    });
  });
  const assets = asList(d.maintenance_risks);
  if (assets.length >= ASSET_RISK_CAP) capped.push("asset_risk");
  assets.forEach((a, i) => {
    const id = str(a.id);
    items.push({ ...base, id: `asset-${id ?? i}`, kind: "asset_risk", tier: "watch", title: str(a.name) ?? "", assetName: str(a.name), facts: { score: num(a.failure_risk_score) }, href: id ? `/(app)/assets/${id}` : "/(app)/assets" });
  });
  asList(d.low_stock_parts).forEach((p, i) => {
    items.push({ ...base, id: `part-${str(p.id) ?? i}`, kind: "low_stock", tier: "watch", title: str(p.name) ?? "", facts: { onHand: num(p.on_hand), minimum: num(p.minimum_stock) } });
  });
  const issues = asList(d.pending_guest_issues);
  if (issues.length >= GUEST_ISSUE_CAP) capped.push("guest_issue");
  issues.forEach((g, i) => {
    const id = str(g.id);
    items.push({
      ...base,
      id: `guest-${id ?? i}`,
      kind: "guest_issue",
      tier: "watch",
      title: str(g.title) ?? "",
      description: str(g.description) ?? "",
      roomNumber: str((g.rooms as Dict | null)?.room_number),
      facts: EMPTY_FACTS,
      href: id ? `/(app)/guest-requests/${id}` : "/(app)/guest-requests",
    });
  });
  asList(d.recurring_issues).forEach((r, i) => {
    items.push({
      ...base,
      id: `recurring-${str(r.key) ?? i}`,
      kind: "recurring",
      tier: "watch",
      title: str(r.asset_name) ?? (str(r.room_number) ? "" : str(r.category) ?? ""),
      assetName: str(r.asset_name),
      roomNumber: str(r.room_number),
      facts: { woCount: num(r.wo_count), windowDays: num(r.window_days) },
    });
  });
  return { items, cappedKinds: capped };
}

export function countByTier(items: readonly AlertItem[]): { attention: number; watch: number } {
  let attention = 0;
  for (const i of items) if (i.tier === "attention") attention += 1;
  return { attention, watch: items.length - attention };
}
