/* ─── Engineering work-order domain helpers ─────────────────────────────────
   Pure logic shared by the Orders tab and the work-order detail screen.
   No i18n here — components translate; helpers return data. */

export type WorkOrderStatus = "open" | "in_progress" | "on_hold" | "completed" | "cancelled";
export type WorkOrderPriority = "urgent" | "normal" | "low";
export type WorkOrderCategory =
  | "plumbing"
  | "electrical"
  | "hvac"
  | "furniture"
  | "appliance"
  | "structural"
  | "safety"
  | "general";

export interface WorkOrderPhoto {
  id: string;
  storage_path: string;
  photo_type?: string;
  caption?: string | null;
  created_at?: string;
}

export interface WorkOrderComment {
  id: string;
  comment: string;
  user_id?: string;
  is_system?: boolean;
  created_at?: string;
}

export interface WorkOrder {
  id: string;
  title: string;
  description?: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  category?: WorkOrderCategory | null;
  rooms?: { room_number?: string | null; floor?: number | null } | null;
  assets?: { id?: string; name?: string | null; location_text?: string | null } | null;
  location_text?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  guest_reported?: boolean;
  notes?: string | null;
  parts_used?: string | null;
  work_order_photos?: WorkOrderPhoto[];
  work_order_comments?: WorkOrderComment[];
}

/** Room ref like "204" when the WO is tied to a room, else free-text location. */
export function workOrderLocation(wo: WorkOrder): { room: string | null; text: string | null } {
  const room = wo.rooms?.room_number ?? null;
  if (room) return { room, text: wo.location_text ?? null };
  return { room: null, text: wo.location_text ?? wo.assets?.location_text ?? null };
}

export function minutesSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
}

/** "45m" / "2h 05m" — compact elapsed/duration label. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

export function formatClock(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export type DueState =
  | { kind: "overdue"; minutes: number }
  | { kind: "due"; clock: string }
  | null;

/** SLA state for active work; silent for completed/cancelled orders. */
export function dueState(wo: WorkOrder, locale: string, now: Date = new Date()): DueState {
  if (wo.status === "completed" || wo.status === "cancelled") return null;
  if (!wo.due_at) return null;
  const due = new Date(wo.due_at);
  if (Number.isNaN(due.getTime())) return null;
  const diffMin = Math.floor((now.getTime() - due.getTime()) / 60_000);
  if (diffMin >= 1) return { kind: "overdue", minutes: diffMin };
  const clock = formatClock(wo.due_at, locale);
  return clock ? { kind: "due", clock } : null;
}

/** Bench order: urgent first, then SLA-overdue, then newest first. */
export function sortQueue(orders: WorkOrder[], now: Date = new Date()): WorkOrder[] {
  const rank = (wo: WorkOrder): number => {
    if (wo.priority === "urgent") return 0;
    const due = wo.due_at ? new Date(wo.due_at).getTime() : NaN;
    if (!Number.isNaN(due) && due < now.getTime()) return 1;
    return 2;
  };
  return [...orders].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });
}
