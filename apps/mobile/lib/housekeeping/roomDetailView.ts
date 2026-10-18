import { formatHotelTime, hotelDateKey, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { DEFAULT_ROOM_PRIORITY, planAssignmentRemoval } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView, BoardStaffMember, MutationGate, RosterTrust } from "@/lib/housekeeping/roomBoardState";
import { isActionable } from "@/lib/housekeeping/supervisor";

/* ─── Room detail — view layer (pure) ───────────────────────────────────────
   Everything the Room Detail drawer shows, derived from ONE verified `BoardRoomView` (the Phase 1 model).
   No React, no I/O, no fetching. Strings come through a caller-supplied `translate`, so the rules here —
   what is shown, in what order, what is left out — are unit-testable in one place.

   Nothing is invented. A fact the board did not record is omitted or labelled "not available"; a person
   is never inferred from today's assignment; a pending late checkout is never presented as approved;
   CLEAN (submitted, awaiting inspection) is never presented as guest-ready. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type DetailFlagKey = "vip" | "dnd" | "declined" | "reclean" | "cleanType" | "arrival" | "lateCheckout" | "priority" | "risk";
export type DetailTone = "alert" | "warn" | "neutral";

export interface DetailFlag {
  key: DetailFlagKey;
  label: string;
  tone: DetailTone;
}

export interface DetailRow {
  key: string;
  label: string;
  value: string;
  /** The value is a "not available / unknown" fallback, drawn muted. */
  muted?: boolean;
}

export type DetailAssignmentKind = "named" | "unnamed" | "none" | "not_applicable";

export interface DetailAssignment {
  kind: DetailAssignmentKind;
  /** The person's name; null when unassigned or when the staff list has no name for them. */
  name: string | null;
  /** What the card says: the name, "Assigned · Name unavailable", "Unassigned", or nothing for unavailable rooms. */
  headline: string;
  /** "8 rooms assigned today" — only when the staff list is verified and has this person. */
  workload: string | null;
  /** Shift status — "Shift status unavailable" unless a verified roster says otherwise. */
  shift: string | null;
}

export type DetailCleaningKind = "completed" | "in_progress" | "none";

export interface DetailCleaning {
  kind: DetailCleaningKind;
  /** A sentence for the kinds with no session to list. */
  message: string | null;
  rows: DetailRow[];
}

export interface DetailNote {
  text: string;
  /** Hotel-local "Today, 9:40 AM"; null when the board has no timestamp for the note. */
  at: string | null;
}

export interface DetailWorkOrder {
  title: string;
  number: string | null;
  status: string | null;
  priority: string | null;
}

export type DetailExceptionKey = "dnd" | "declined" | "risk";

export interface DetailException {
  key: DetailExceptionKey;
  title: string;
  body: string;
}

export type DetailActionKey = "assign" | "reassign" | "remove" | "inspect";

export interface DetailAction {
  key: DetailActionKey;
  label: string;
  hint: string;
  destructive: boolean;
  /** True when the action needs a fresh, verified board and the board is not one. */
  disabled: boolean;
}

export interface RoomDetailModel {
  roomId: string;
  roomNumber: string;
  roomType: string | null;
  /** "Floor 2 · Building A" — only the parts the backend sent. */
  location: string;
  /** The status as the backend sent it — drives the protected status colours. */
  rawStatus: string;
  statusLabel: string;
  flags: DetailFlag[];
  statusRows: DetailRow[];
  assignment: DetailAssignment;
  cleaning: DetailCleaning;
  note: DetailNote | null;
  workOrder: DetailWorkOrder | null;
  exceptions: DetailException[];
  /** DND is on: the (confirmed) wellness-check task may be offered. */
  wellnessCheck: boolean;
  primary: DetailAction | null;
  menu: DetailAction[];
  /** Why changes are paused ("Changes are paused: offline…"); null when they are allowed. */
  paused: string | null;
  accessibilityLabel: string;
}

export interface RoomDetailContext {
  now: number;
  timeZone: string | null | undefined;
  language: string;
  gate: MutationGate;
  /** The board's last verified clock time, formatted, for stale wording. */
  verifiedClock: string | null;
  /** True only while the board is freshly verified (`ready` / `verified_empty`). */
  live: boolean;
  rosterTrust: RosterTrust;
  staff: readonly BoardStaffMember[];
  staffNamesKnown: boolean;
  lateCheckoutsKnown: boolean;
  t: Translate;
}

/* ─── Time ────────────────────────────────────────────────────────────────── */

/** "Today, 11:00 AM" / "Oct 17, 2:00 PM" in the hotel's zone; null when the instant is missing or unreadable. */
export function formatMoment(iso: string | null | undefined, ctx: Pick<RoomDetailContext, "now" | "timeZone" | "language" | "t">): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const time = formatHotelTime(date, ctx.timeZone, ctx.language);
  if (!time) return null;
  if (hotelDateKey(date, ctx.timeZone) === hotelDateKey(new Date(ctx.now), ctx.timeZone)) return ctx.t("roomBoard.detail.todayAt", { time });
  const day = date.toLocaleDateString(ctx.language.toLowerCase().startsWith("es") ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: resolveTimeZone(ctx.timeZone),
  });
  return ctx.t("roomBoard.detail.dayAt", { day, time });
}

/* ─── Pieces ──────────────────────────────────────────────────────────────── */

function statusLabelOf(code: string | null, t: Translate): string {
  return t(`roomBoard.card.status.${code ?? "UNKNOWN"}`);
}

function locationOf(view: BoardRoomView, t: Translate): string {
  const { room } = view;
  const parts: string[] = [];
  if (room.floorKnown) parts.push(t("roomBoard.floor", { floor: room.floor }));
  if (room.building) parts.push(t("roomBoard.building", { building: room.building }));
  return parts.length > 0 ? parts.join(" · ") : t("roomBoard.floorUnknown");
}

function arrivalToday(view: BoardRoomView, ctx: RoomDetailContext): string | null {
  const { room } = view;
  if (room.statusInfo.stage === "unavailable" || room.statusInfo.stage === "guest_ready" || !room.checkinTime) return null;
  const at = Date.parse(room.checkinTime);
  if (Number.isNaN(at) || hotelDateKey(new Date(at), ctx.timeZone) !== hotelDateKey(new Date(ctx.now), ctx.timeZone)) return null;
  return formatHotelTime(new Date(at), ctx.timeZone, ctx.language);
}

/** The few badges worth a supervisor's first glance, most important first. The sections below carry the rest. */
export const MAX_DETAIL_FLAGS = 4;

function buildFlags(view: BoardRoomView, ctx: RoomDetailContext): DetailFlag[] {
  const { room } = view;
  const { t } = ctx;
  const flags: DetailFlag[] = [];
  if (room.vip) flags.push({ key: "vip", label: t("roomBoard.detail.flag.vip"), tone: "warn" });
  if (room.dnd) flags.push({ key: "dnd", label: t("roomBoard.detail.flag.dnd"), tone: "neutral" });
  if (room.serviceDeclined.declined) flags.push({ key: "declined", label: t("roomBoard.detail.flag.declined"), tone: "neutral" });
  if (room.recleanRequestedAt !== null && room.statusInfo.stage !== "unavailable") {
    flags.push({ key: "reclean", label: t("roomBoard.detail.flag.reclean"), tone: "alert" });
  }
  if (room.statusInfo.stage === "to_clean" || room.statusInfo.stage === "in_progress") {
    if (room.cleanType === "DEP") flags.push({ key: "cleanType", label: t("roomBoard.detail.flag.departure"), tone: "alert" });
    else if (room.cleanTypeLabel) flags.push({ key: "cleanType", label: room.cleanTypeLabel, tone: "warn" });
  }
  const arrival = arrivalToday(view, ctx);
  if (arrival) flags.push({ key: "arrival", label: t("roomBoard.detail.flag.arrival", { time: arrival }), tone: "warn" });
  if (room.lateCheckout) {
    flags.push({
      key: "lateCheckout",
      label: t(room.lateCheckout.status === "approved" ? "roomBoard.detail.flag.lateApproved" : "roomBoard.detail.flag.latePending"),
      tone: "neutral",
    });
  }
  if (room.priority !== null && room.priority < DEFAULT_ROOM_PRIORITY && room.statusInfo.stage !== "unavailable") {
    flags.push({ key: "priority", label: t("roomBoard.detail.flag.priority"), tone: "alert" });
  }
  if (room.prediction?.riskLevel === "HIGH" && room.statusInfo.stage !== "unavailable") {
    flags.push({ key: "risk", label: t("roomBoard.detail.flag.risk"), tone: "alert" });
  }
  return flags.slice(0, MAX_DETAIL_FLAGS);
}

function buildStatusRows(view: BoardRoomView, ctx: RoomDetailContext): DetailRow[] {
  const { room } = view;
  const { t } = ctx;
  const info = room.statusInfo;
  const unavailable = t("roomBoard.detail.notAvailable");
  const rows: DetailRow[] = [
    { key: "housekeeping", label: t("roomBoard.detail.row.housekeeping"), value: t(`roomBoard.statusMeaning.${info.code ?? "UNKNOWN"}`) },
    {
      key: "occupancy",
      label: t("roomBoard.detail.row.occupancy"),
      value: t(`roomBoard.detail.occupancy.${room.occupancy}`),
      ...(room.occupancy === "unknown" ? { muted: true } : {}),
    },
  ];
  if (room.occupancyDiscrepancy) {
    rows.push({ key: "discrepancy", label: t("roomBoard.detail.row.frontDesk"), value: t("roomBoard.detail.discrepancy") });
  }
  if (room.cleanTypeLabel && (info.stage === "to_clean" || info.stage === "in_progress")) {
    rows.push({ key: "cleanType", label: t("roomBoard.detail.row.cleanType"), value: room.cleanType === "DEP" ? t("roomBoard.detail.flag.departure") : room.cleanTypeLabel });
  }

  if (info.stage !== "unavailable") {
    const checkout = formatMoment(room.checkoutTime, ctx);
    rows.push({ key: "checkout", label: t("roomBoard.detail.row.checkout"), value: checkout ?? unavailable, ...(checkout ? {} : { muted: true }) });
    const actual = formatMoment(room.actualCheckoutAt, ctx);
    if (actual) rows.push({ key: "actualCheckout", label: t("roomBoard.detail.row.checkedOut"), value: actual });
    const arrival = formatMoment(room.checkinTime, ctx);
    rows.push({ key: "arrival", label: t("roomBoard.detail.row.arrival"), value: arrival ?? unavailable, ...(arrival ? {} : { muted: true }) });
  }

  if (room.lateCheckout) {
    const requested = room.lateCheckout.requestedTime ? formatMoment(room.lateCheckout.requestedTime, ctx) : null;
    const base = t(room.lateCheckout.status === "approved" ? "roomBoard.detail.late.approved" : "roomBoard.detail.late.pending");
    rows.push({ key: "late", label: t("roomBoard.detail.row.lateCheckout"), value: requested ? `${base} · ${requested}` : base });
  } else if (!ctx.lateCheckoutsKnown && info.stage !== "unavailable" && info.stage !== "guest_ready") {
    rows.push({ key: "late", label: t("roomBoard.detail.row.lateCheckout"), value: t("roomBoard.detail.late.unknown"), muted: true });
  }

  if (info.stage === "awaiting_inspection") {
    const value =
      room.inspectionRequired === true
        ? t("roomBoard.detail.inspection.required")
        : room.inspectionRequired === false
          ? t("roomBoard.detail.inspection.notRequired")
          : t("roomBoard.detail.inspection.unknown");
    rows.push({ key: "inspection", label: t("roomBoard.detail.row.inspection"), value, ...(room.inspectionRequired === null ? { muted: true } : {}) });
  } else if (info.stage === "guest_ready") {
    const at = formatMoment(room.lastInspectedAt, ctx);
    rows.push({
      key: "inspection",
      label: t("roomBoard.detail.row.inspection"),
      value: at ? t("roomBoard.detail.inspection.doneAt", { at }) : t("roomBoard.detail.inspection.done"),
    });
  }
  if (room.recleanRequestedAt !== null && info.stage !== "unavailable") {
    const at = formatMoment(room.recleanRequestedAt, ctx);
    rows.push({ key: "reclean", label: t("roomBoard.detail.row.reclean"), value: at ? t("roomBoard.detail.recleanAt", { at }) : t("roomBoard.detail.flag.reclean") });
  }
  return rows;
}

function buildAssignment(view: BoardRoomView, ctx: RoomDetailContext): DetailAssignment {
  const { room, assignee } = view;
  const { t } = ctx;
  if (!assignee) {
    const unavailable = room.statusInfo.stage === "unavailable";
    return {
      kind: unavailable ? "not_applicable" : "none",
      name: null,
      headline: unavailable ? t("roomBoard.detail.assignment.notApplicable") : t("roomBoard.unassigned"),
      workload: null,
      shift: null,
    };
  }
  const member = ctx.staff.find((candidate) => candidate.userId === assignee.userId);
  const workload =
    member && ctx.staffNamesKnown ? t("roomBoard.detail.assignment.workload", { count: member.assignedRooms }) : null;
  const shift = t(`roomBoard.detail.shift.${assignee.availability}`);
  return assignee.name
    ? { kind: "named", name: assignee.name, headline: assignee.name, workload, shift }
    : { kind: "unnamed", name: null, headline: t("roomBoard.detail.assignment.nameUnavailable"), workload, shift };
}

function buildCleaning(view: BoardRoomView, ctx: RoomDetailContext): DetailCleaning {
  const { room } = view;
  const { t } = ctx;
  const session = room.cleanSession;
  if (session) {
    const rows: DetailRow[] = [];
    const completed = formatMoment(session.endedAt, ctx);
    rows.push({ key: "completed", label: t("roomBoard.detail.cleaning.completed"), value: completed ?? t("roomBoard.detail.notAvailable"), ...(completed ? {} : { muted: true }) });
    if (session.minutes !== null) {
      const base = session.baseMinutes !== null ? ` · ${t("roomBoard.detail.cleaning.baseline", { minutes: Math.round(session.baseMinutes) })}` : "";
      rows.push({ key: "duration", label: t("roomBoard.detail.cleaning.duration"), value: `${t("roomBoard.detail.cleaning.minutes", { minutes: Math.round(session.minutes) })}${base}` });
    } else {
      rows.push({ key: "duration", label: t("roomBoard.detail.cleaning.duration"), value: t("roomBoard.detail.notAvailable"), muted: true });
    }
    rows.push(
      session.checklistTotal > 0
        ? { key: "checklist", label: t("roomBoard.detail.cleaning.checklist"), value: `${session.checklistDone} / ${session.checklistTotal}` }
        : { key: "checklist", label: t("roomBoard.detail.cleaning.checklist"), value: t("roomBoard.detail.cleaning.checklistNone"), muted: true },
    );
    // A count the cleaner recorded — not photos this app has loaded.
    rows.push({ key: "photos", label: t("roomBoard.detail.cleaning.photos"), value: t("roomBoard.detail.cleaning.photosRecorded", { count: session.photoCount }) });
    return { kind: "completed", message: null, rows };
  }
  if (room.statusInfo.stage === "in_progress") {
    return { kind: "in_progress", message: t("roomBoard.detail.cleaning.inProgress"), rows: [] };
  }
  return {
    kind: "none",
    message: ctx.live
      ? t("roomBoard.detail.cleaning.none")
      : t("roomBoard.detail.cleaning.noneStale", { time: ctx.verifiedClock ?? "—" }),
    rows: [],
  };
}

const WORK_ORDER_STATUS = new Set(["open", "in_progress", "on_hold"]);
const WORK_ORDER_PRIORITY = new Set(["low", "medium", "normal", "high", "urgent", "critical", "emergency"]);

function buildWorkOrder(view: BoardRoomView, ctx: RoomDetailContext): DetailWorkOrder | null {
  const wo = view.room.workOrder;
  if (!wo) return null;
  const { t } = ctx;
  const status = wo.status ? (WORK_ORDER_STATUS.has(wo.status) ? t(`workOrders.status.${wo.status}`) : wo.status.replace(/_/g, " ")) : null;
  const priority = wo.priority ? (WORK_ORDER_PRIORITY.has(wo.priority) ? t(`roomBoard.detail.workOrder.priority.${wo.priority}`) : wo.priority) : null;
  return { title: wo.title ?? t("roomBoard.detail.workOrder.untitled"), number: wo.number, status, priority };
}

function buildExceptions(view: BoardRoomView, ctx: RoomDetailContext): DetailException[] {
  const { room } = view;
  const { t } = ctx;
  const out: DetailException[] = [];
  if (room.dnd) out.push({ key: "dnd", title: t("roomBoard.detail.exception.dndTitle"), body: t("roomBoard.detail.exception.dndBody") });
  if (room.serviceDeclined.declined) {
    const detail = [room.serviceDeclined.reason, room.serviceDeclined.note].filter(Boolean).join(" — ");
    out.push({
      key: "declined",
      title: t("roomBoard.detail.exception.declinedTitle"),
      body: detail || t("roomBoard.detail.exception.declinedBody"),
    });
  }
  if (room.prediction?.riskLevel === "HIGH" && room.statusInfo.stage !== "unavailable" && room.statusInfo.stage !== "guest_ready") {
    const ready = formatMoment(room.prediction.predictedReadyAt, ctx);
    out.push({
      key: "risk",
      title: t("roomBoard.detail.exception.riskTitle"),
      body: ready ? t("roomBoard.detail.exception.riskBodyAt", { at: ready }) : t("roomBoard.detail.exception.riskBody"),
    });
  }
  return out;
}

function action(key: DetailActionKey, ctx: RoomDetailContext, destructive = false): DetailAction {
  const mutates = key !== "inspect";
  return {
    key,
    label: ctx.t(`roomBoard.detail.action.${key}`),
    hint: ctx.t(`roomBoard.detail.action.${key}Hint`),
    destructive,
    disabled: mutates && !ctx.gate.allowed,
  };
}

/**
 * ONE primary action by verified state, plus the applicable secondary actions for the "More actions" drawer.
 *  to be cleaned     → Assign (unassigned) / Reassign (assigned)
 *  awaiting inspect  → Inspect (the existing inspection route; the inspection queue enforces its own rules)
 *  being cleaned / inspected / out of service / unknown → no primary: nothing safe to change from here
 * The menu lists only actions that currently apply — never disabled placeholders for later features.
 */
function buildActions(view: BoardRoomView, ctx: RoomDetailContext): { primary: DetailAction | null; menu: DetailAction[] } {
  const { room } = view;
  const stage = room.statusInfo.stage;
  const assigned = room.assignment.source !== "none";
  let primary: DetailAction | null = null;
  if (stage === "to_clean") primary = action(assigned ? "reassign" : "assign", ctx);
  else if (stage === "awaiting_inspection") primary = action("inspect", ctx);

  const candidates: DetailAction[] = [];
  if (assigned) candidates.push(action("reassign", ctx));
  else if (isActionable(room.status)) candidates.push(action("assign", ctx));
  if (planAssignmentRemoval(room).kind !== "none") candidates.push(action("remove", ctx, true));
  if (stage === "awaiting_inspection") candidates.push(action("inspect", ctx));
  return { primary, menu: candidates.filter((candidate) => candidate.key !== primary?.key) };
}

/* ─── Model ───────────────────────────────────────────────────────────────── */

export function buildRoomDetail(view: BoardRoomView, ctx: RoomDetailContext): RoomDetailModel {
  const { room } = view;
  const { t } = ctx;
  const info = room.statusInfo;
  const statusLabel = statusLabelOf(info.code, t);
  const assignment = buildAssignment(view, ctx);
  const location = locationOf(view, t);
  const { primary, menu } = buildActions(view, ctx);
  const paused = ctx.gate.allowed
    ? null
    : t(`roomBoard.detail.paused.${ctx.gate.blockedBy ?? "unavailable"}`, { time: ctx.verifiedClock ?? "—" });

  return {
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    roomType: room.roomType,
    location,
    rawStatus: info.raw,
    statusLabel,
    flags: buildFlags(view, ctx),
    statusRows: buildStatusRows(view, ctx),
    assignment,
    cleaning: buildCleaning(view, ctx),
    note: room.latestNote ? { text: room.latestNote, at: formatMoment(room.latestNoteAt, ctx) } : null,
    workOrder: buildWorkOrder(view, ctx),
    exceptions: buildExceptions(view, ctx),
    wellnessCheck: room.dnd,
    primary,
    menu,
    paused,
    accessibilityLabel: [
      t("roomBoard.card.roomLabel", { room: room.roomNumber }),
      statusLabel,
      assignment.kind === "named"
        ? t("roomBoard.detail.a11y.assignedTo", { name: assignment.name })
        : assignment.kind === "unnamed"
          ? t("roomBoard.detail.a11y.assignedUnnamed")
          : assignment.kind === "none"
            ? t("roomBoard.unassigned")
            : "",
    ]
      .filter(Boolean)
      .join(", "),
  };
}
