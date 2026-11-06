import { shiftDateKeyOf } from "@/lib/housekeeping/hotelTime";

/* ─── Guest requests: the real API contract ───────────────────────────────────
   `GET /guest-requests` returns table rows (`title`, nested `rooms.room_number`, a nine-state `status`, `priority`
   normal|urgent, `due_at`, `resolved_at`...). Older mobile code (and its test fixtures) read a flat shape with
   `room_number`, `request_type`, `assigned_to_name` and statuses `new` / `escalated`. `normalizeGuestRequest`
   accepts BOTH, so nothing breaks while the screens move to the real contract. The API has no assignee and no
   priority above `urgent`; neither is invented here. */

export type RawGuestRequest = {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  category?: string | null;
  created_at?: string | null;
  due_at?: string | null;
  resolved_at?: string | null;
  guest_name?: string | null;
  rooms?: { room_number?: string | null } | null;
  work_orders?: { id?: string; status?: string | null; work_order_number?: string | number | null } | { id?: string }[] | null;
  /** Legacy flat fields. */
  room_number?: string | null;
  request_type?: string | null;
  assigned_to_name?: string | null;
};

/** The nine real statuses plus the two legacy names; anything else is "unknown" (never guessed into a bucket). */
export type RequestStage = "open" | "inProgress" | "resolved" | "cancelled" | "unknown";

const OPEN = new Set(["open", "reopened", "new"]);
const IN_PROGRESS = new Set(["acknowledged", "dispatched", "arrived", "guest_contacted", "in_progress", "escalated"]);
const RESOLVED = new Set(["resolved", "verified"]);

export function stageOf(status: string | null | undefined): RequestStage {
  const s = (status ?? "").toLowerCase();
  if (OPEN.has(s)) return "open";
  if (IN_PROGRESS.has(s)) return "inProgress";
  if (RESOLVED.has(s)) return "resolved";
  if (s === "cancelled") return "cancelled";
  return "unknown";
}

export interface GuestRequestView {
  id: string;
  status: string;
  stage: RequestStage;
  title: string;
  description: string;
  roomNumber: string | null;
  guestName: string | null;
  urgent: boolean;
  /** The raw priority string (`normal`, `urgent`; legacy payloads may also carry `low` / `emergency`). */
  priority: string;
  category: string | null;
  createdAt: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  /** Only present on legacy payloads; the real API has no assignee. */
  assignedToName: string | null;
  linkedWorkOrder: boolean;
}

export function normalizeGuestRequest(raw: RawGuestRequest): GuestRequestView {
  const status = (raw.status ?? "").toLowerCase();
  const priority = (raw.priority ?? "").toLowerCase();
  const wo = raw.work_orders;
  return {
    id: raw.id,
    status,
    stage: stageOf(status),
    title: (raw.title ?? raw.request_type ?? "").trim(),
    description: (raw.description ?? "").trim(),
    roomNumber: raw.rooms?.room_number ?? raw.room_number ?? null,
    guestName: raw.guest_name?.trim() || null,
    urgent: priority === "urgent" || priority === "emergency",
    priority,
    category: raw.category ?? null,
    createdAt: raw.created_at ?? null,
    dueAt: raw.due_at ?? null,
    resolvedAt: raw.resolved_at ?? null,
    assignedToName: raw.assigned_to_name ?? null,
    linkedWorkOrder: Array.isArray(wo) ? wo.length > 0 : Boolean(wo && (wo as { id?: string }).id),
  };
}

export function normalizeGuestRequests(rows: unknown): GuestRequestView[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is RawGuestRequest => Boolean(r && typeof r === "object" && (r as RawGuestRequest).id))
    .map(normalizeGuestRequest);
}

export const GUEST_REQUEST_PAGE_SIZE = 100;

export interface GuestRequestSummary {
  /** Counts over the rows actually loaded. */
  open: number;
  inProgress: number;
  urgentActive: number;
  resolvedToday: number;
  loaded: number;
  /** True when the page was full: more requests may exist, so every count is a lower bound ("12+"). */
  partial: boolean;
  /** Urgent first, then the longest-waiting open request, then the longest-running one. Null when nothing needs attention. */
  next: GuestRequestView | null;
}

function ms(iso: string | null): number {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

export function pickNextRequest(rows: readonly GuestRequestView[]): GuestRequestView | null {
  const active = rows.filter((r) => r.stage === "open" || r.stage === "inProgress");
  if (active.length === 0) return null;
  const rank = (r: GuestRequestView) => (r.urgent ? 0 : 2) + (r.stage === "open" ? 0 : 1);
  return [...active].sort((a, b) => rank(a) - rank(b) || ms(a.createdAt) - ms(b.createdAt))[0];
}

export function summarizeGuestRequests(
  rows: readonly GuestRequestView[],
  opts: { pageSize?: number; now?: Date; timeZone?: string | null } = {},
): GuestRequestSummary {
  const pageSize = opts.pageSize ?? GUEST_REQUEST_PAGE_SIZE;
  const today = shiftDateKeyOf(opts.now ?? new Date(), opts.timeZone);
  let open = 0;
  let inProgress = 0;
  let urgentActive = 0;
  let resolvedToday = 0;
  for (const r of rows) {
    if (r.stage === "open") open += 1;
    else if (r.stage === "inProgress") inProgress += 1;
    if ((r.stage === "open" || r.stage === "inProgress") && r.urgent) urgentActive += 1;
    if (r.stage === "resolved" && r.resolvedAt && today && shiftDateKeyOf(r.resolvedAt, opts.timeZone) === today) resolvedToday += 1;
  }
  return { open, inProgress, urgentActive, resolvedToday, loaded: rows.length, partial: rows.length >= pageSize, next: pickNextRequest(rows) };
}

/** The server's lifecycle, mirrored read-only so the UI only offers moves the API will accept. The API remains the
 *  authority (it validates again and returns 422 for anything else). */
const ALLOWED: Record<string, readonly string[]> = {
  open: ["acknowledged", "cancelled"],
  acknowledged: ["dispatched", "cancelled"],
  dispatched: ["arrived", "resolved", "cancelled"],
  arrived: ["guest_contacted", "resolved", "cancelled"],
  guest_contacted: ["resolved", "cancelled"],
  resolved: ["verified", "reopened"],
  verified: ["reopened"],
  reopened: ["acknowledged", "cancelled"],
  cancelled: [],
};

/** Cancelling is a management action on the server (`MANAGER_ROLES`). */
const CANCEL_ROLES = new Set(["gm", "housekeeping_supervisor", "chief_engineer"]);

export function allowedTransitions(status: string, role: string | null | undefined): string[] {
  return (ALLOWED[status] ?? []).filter((next) => next !== "cancelled" || (role ? CANCEL_ROLES.has(role) : false));
}

export function formatCount(count: number, partial: boolean): string {
  return partial ? `${count}+` : String(count);
}
