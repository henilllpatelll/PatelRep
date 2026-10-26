import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { Attendance, AssignmentTeamMember, StaffConcern } from "@/lib/housekeeping/assignmentStaff";
import { selectTeamCounts, type TeamCounts } from "@/lib/housekeeping/assignmentSelectors";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { BoardRoom, RoomStage } from "@/lib/housekeeping/roomBoardModel";

/* ─── Supervisor Assignments — the Team tab, as the screen shows it ─────────
   Pure view layer over `AssignmentsModel` / `AssignmentTeamMember`. It decides what is said and what is left
   unsaid; the components only draw it. Strings come through a caller-supplied `translate`.

   RULES THAT SHAPE EVERY LINE
   - Attendance, schedule and room ownership are three separate facts (see assignmentStaff.ts). A badge states
     the one fact it is built from and never borrows from another.
   - Minutes, credits and capacity are different measurements. A percentage is drawn only when the Phase 1
     capacity says it is reliable (`utilization !== null`); otherwise the line says "unavailable" and why.
   - A total that is only a lower bound is labelled "At least …"; it is never presented as the whole figure.
   - A warning needs evidence (`concerns` / `warnings` from Phase 1). Having more rooms than a colleague is not one. */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Attendance ──────────────────────────────────────────────────────────── */

export type AttendanceTone = "ok" | "break" | "neutral" | "unknown";

export interface AttendanceBadge {
  attendance: Attendance;
  label: string;
  /** Text AND icon always accompany the tone: colour is never the only signal. */
  tone: AttendanceTone;
  icon: string;
}

const ATTENDANCE_STYLE: Record<Attendance, { tone: AttendanceTone; icon: string }> = {
  on_shift: { tone: "ok", icon: "radio-button-on" },
  on_break: { tone: "break", icon: "cafe-outline" },
  shift_ended: { tone: "neutral", icon: "log-out-outline" },
  scheduled_not_clocked_in: { tone: "neutral", icon: "time-outline" },
  not_clocked_in: { tone: "neutral", icon: "remove-circle-outline" },
  unknown: { tone: "unknown", icon: "help-circle-outline" },
};

export function attendanceBadge(attendance: Attendance, t: Translate): AttendanceBadge {
  return { attendance, label: t(`assignments.v2.team.attendance.${attendance}`), ...ATTENDANCE_STYLE[attendance] };
}

/* ─── Header ──────────────────────────────────────────────────────────────── */

export interface TeamHeaderMetrics extends TeamCounts {}

export function buildTeamHeaderMetrics(model: AssignmentsModel): TeamHeaderMetrics {
  return selectTeamCounts(model);
}

/* ─── Notices ─────────────────────────────────────────────────────────────── */

export type TeamNoticeKey = "staffListUnavailable" | "availabilityUnverified" | "nobodyOnShift" | "capacityUnavailable";

export interface TeamNotice {
  key: TeamNoticeKey;
  /** Whether the notice offers a retry (the missing source can be re-requested). */
  retry: boolean;
}

/**
 * What the supervisor must know about how far the Team list can be trusted. Each notice names one missing or
 * surprising fact; none of them hides people or rooms, which stay on screen.
 */
export function teamNotices(model: AssignmentsModel): TeamNotice[] {
  if (!model.team) return [];
  const notices: TeamNotice[] = [];
  if (!model.staffListKnown) notices.push({ key: "staffListUnavailable", retry: true });
  if (model.rosterTrust !== "verified") notices.push({ key: "availabilityUnverified", retry: true });
  else if (model.staffListKnown) {
    const counts = selectTeamCounts(model);
    // Said only for a roster that answered: a failed roster must never read as "nobody is working".
    if (counts.onShift === 0 && counts.onBreak === 0) notices.push({ key: "nobodyOnShift", retry: false });
  }
  if (model.settings.value === null) notices.push({ key: "capacityUnavailable", retry: false });
  return notices;
}

export type TeamEmptyKind = "unavailable" | "noStaff" | "staffListUnavailable" | "search" | "filters";

export function teamEmptyKind(model: AssignmentsModel, emptyReason: "search" | "filters" | null): TeamEmptyKind | null {
  if (!model.team) return "unavailable";
  if (model.team.length === 0) return model.staffListKnown ? "noStaff" : "staffListUnavailable";
  return emptyReason;
}

/* ─── Workload text ───────────────────────────────────────────────────────── */

/** One line for the remaining estimated time, honest about what is known. */
export function remainingText(member: AssignmentTeamMember, t: Translate): string {
  const { minutes } = member.load;
  if (member.rooms.length === 0) return t("assignments.v2.team.noWorkload");
  if (minutes.remainingRooms === 0) return t("assignments.v2.team.nothingLeft");
  const rounded = Math.round(minutes.remainingMinutes);
  if (minutes.minutesComplete) return t("assignments.v2.team.remaining", { minutes: rounded });
  if (minutes.roomsWithoutEstimate === minutes.remainingRooms) return t("assignments.v2.team.estimateUnavailable");
  return t("assignments.v2.team.remainingAtLeast", { minutes: rounded, count: minutes.roomsWithoutEstimate });
}

export interface CapacityLine {
  /** Reliable percentage of the planned capacity used (NOT capped: 140 means 140%). null = nothing honest to draw. */
  percent: number | null;
  /** 0..1 fill for a bar; only meaningful when `percent` is. */
  fill: number;
  text: string;
  /** "Near capacity" / "At capacity" / "Over planned capacity" next to a reliable percentage. */
  qualifier: string | null;
  state: "under" | "on" | "at" | "over" | null;
}

/** The capacity indicator. A percentage and a bar exist only when Phase 1 says both credits and target are reliable. */
export function capacityLine(member: AssignmentTeamMember, t: Translate): CapacityLine {
  const { capacity, credits } = member.load;
  if (capacity.utilization !== null && capacity.state !== null) {
    const percent = Math.round(capacity.utilization * 100);
    const qualifier =
      capacity.state === "over" ? t("assignments.v2.team.capacity.over") : capacity.state === "at" ? t("assignments.v2.team.capacity.at") : capacity.state === "on" ? t("assignments.v2.team.capacity.near") : null;
    return { percent, fill: Math.max(0, Math.min(1, capacity.utilization)), text: t("assignments.v2.team.capacity.used", { percent }), qualifier, state: capacity.state };
  }
  const reason = !credits.available ? "noSettings" : !credits.complete ? "missingCredits" : "unavailable";
  return { percent: null, fill: 0, text: t(`assignments.v2.team.capacity.${reason}`), qualifier: null, state: capacity.state };
}

/* ─── Notes (warnings and context) ────────────────────────────────────────── */

export interface TeamNote {
  key: string;
  text: string;
  /** "warn" is an actionable concern backed by evidence; "info" is context. */
  tone: "warn" | "info";
}

function notesOf(member: AssignmentTeamMember, t: Translate): TeamNote[] {
  const notes: TeamNote[] = [];
  const open = member.load.minutes.remainingRooms;
  const started = member.load.minutes.inProgress;
  const unstarted = Math.max(0, open - started);
  const capacity = member.load.capacity;
  // Rooms already being cleaned stay with the person, so when both kinds are open the note says how many can still move.
  const mixed = started > 0 && unstarted > 0;
  for (const concern of member.concerns as readonly StaffConcern[]) {
    if (concern === "shift_ended_with_open_rooms") {
      notes.push({ key: concern, tone: "warn", text: mixed ? t("assignments.v2.team.note.shiftEndedMixed", { unstarted, inProgress: started }) : t("assignments.v2.team.note.shiftEndedOpen", { count: open }) });
    } else if (concern === "not_clocked_in_with_open_rooms") {
      notes.push({ key: concern, tone: "warn", text: mixed ? t("assignments.v2.team.note.notClockedInMixed", { unstarted, inProgress: started }) : t("assignments.v2.team.note.notClockedInOpen", { count: open }) });
    }
  }
  const { warnings } = member.load;
  // With a reliable percentage the capacity line already says "Over planned capacity"; this covers the lower-bound case.
  if (warnings.includes("over_credit_target") && capacity.utilization === null) notes.push({ key: "over_credit_target", tone: "warn", text: t("assignments.v2.team.capacity.over") });
  if (warnings.includes("exceeds_shift_time")) notes.push({ key: "exceeds_shift_time", tone: "warn", text: t("assignments.v2.team.note.exceedsShift") });
  if (warnings.includes("exceeds_full_day")) notes.push({ key: "exceeds_full_day", tone: "warn", text: t("assignments.v2.team.note.exceedsDay") });
  if (member.attendance === "on_break") notes.push({ key: "on_break", tone: "info", text: t("assignments.v2.team.note.onBreak") });
  return notes;
}

/* ─── Coverage ────────────────────────────────────────────────────────────── */

/** "Floor 3", "Floors 2, 3", plus the building when the property has several. Null when no known floor/building. */
export function coverageText(member: AssignmentTeamMember, t: Translate): string | null {
  const floors = member.floors;
  const level =
    floors.length === 0 ? null : floors.length === 1 ? t("roomBoard.floor", { floor: floors[0] }) : t("assignments.v2.team.floors", { floors: floors.join(", ") });
  const buildings = member.buildings.length > 0 ? member.buildings.map((building) => t("roomBoard.building", { building })).join(", ") : null;
  if (level && buildings) return `${buildings} · ${level}`;
  return level ?? buildings;
}

/* ─── Room stage (shared by the card chips and the drawer) ────────────────── */

export type StaffRoomPhase = "in_progress" | "not_started" | "completed" | "unavailable" | "unknown";

export function phaseOf(stage: RoomStage): StaffRoomPhase {
  switch (stage) {
    case "in_progress":
      return "in_progress";
    case "to_clean":
      return "not_started";
    case "awaiting_inspection":
    case "guest_ready":
      return "completed";
    case "unavailable":
      return "unavailable";
    case "unknown":
      return "unknown";
  }
}

/** In-progress first (what is happening now), then not started, then done, then rooms that are not work. */
const PHASE_ORDER: Record<StaffRoomPhase, number> = { in_progress: 0, not_started: 1, completed: 2, unavailable: 3, unknown: 4 };

export function sortStaffRooms(rooms: readonly BoardRoom[]): BoardRoom[] {
  const numeric = new Intl.Collator(undefined, { numeric: true });
  return [...rooms].sort(
    (a, b) => PHASE_ORDER[phaseOf(a.statusInfo.stage)] - PHASE_ORDER[phaseOf(b.statusInfo.stage)] || numeric.compare(a.roomNumber, b.roomNumber) || a.roomId.localeCompare(b.roomId),
  );
}

export function phaseLabel(room: BoardRoom, t: Translate): string {
  return t(`assignments.v2.team.phase.${phaseOf(room.statusInfo.stage)}`);
}

/* ─── Card ────────────────────────────────────────────────────────────────── */

export const CARD_ROOM_PREVIEW = 5;

export interface PreviewRoom {
  roomId: string;
  number: string;
  phase: StaffRoomPhase;
  /** "204, in progress" for assistive technology. */
  label: string;
}

export interface TeamCardModel {
  userId: string;
  name: string;
  /** No usable name on file: the fallback is shown, and the avatar uses a neutral glyph. */
  unnamed: boolean;
  /** The person is known only because rooms are assigned to them (not in the staff list). */
  unlisted: boolean;
  attendance: AttendanceBadge;
  /** "5 rooms · 2 completed · 1 in progress". */
  stats: string;
  remaining: string;
  capacity: CapacityLine | null;
  /** "High load" — present only with evidence. */
  badge: string | null;
  notes: TeamNote[];
  coverage: string | null;
  preview: PreviewRoom[];
  more: number;
  a11yLabel: string;
  counts: { assigned: number; completed: number; inProgress: number; notStarted: number };
}

export function statsText(member: AssignmentTeamMember, t: Translate): string {
  const { minutes } = member.load;
  if (member.rooms.length === 0) return t("assignments.v2.team.noRooms");
  const parts = [t("assignments.v2.team.roomsDone", { count: member.rooms.length, done: minutes.completed })];
  if (minutes.inProgress > 0) parts.push(t("assignments.v2.team.inProgressCount", { count: minutes.inProgress }));
  return parts.join(" · ");
}

export function buildTeamCard(member: AssignmentTeamMember, t: Translate): TeamCardModel {
  const { minutes } = member.load;
  const unnamed = member.name === null;
  const name = member.name ?? t("assignments.v2.team.nameUnavailable");
  const attendance = attendanceBadge(member.attendance, t);
  const stats = statsText(member, t);
  const remaining = remainingText(member, t);
  const capacity = member.rooms.length > 0 ? capacityLine(member, t) : null;
  const notes = notesOf(member, t).slice(0, 2);
  const coverage = coverageText(member, t);
  const ordered = sortStaffRooms(member.rooms);
  const preview = ordered.slice(0, CARD_ROOM_PREVIEW).map<PreviewRoom>((room) => ({
    roomId: room.roomId,
    number: room.roomNumber,
    phase: phaseOf(room.statusInfo.stage),
    label: `${room.roomNumber}, ${phaseLabel(room, t)}`,
  }));
  const badge = member.concerns.includes("overloaded") ? t("assignments.v2.team.highLoad") : null;
  const a11yLabel = [
    name,
    attendance.label,
    stats,
    remaining,
    capacity ? [capacity.text, capacity.qualifier].filter(Boolean).join(", ") : null,
    badge,
    ...notes.map((note) => note.text),
  ]
    .filter(Boolean)
    .join(". ");
  return {
    userId: member.userId,
    name,
    unnamed,
    unlisted: !member.listed,
    attendance,
    stats,
    remaining,
    capacity,
    badge,
    notes,
    coverage,
    preview,
    more: Math.max(0, ordered.length - CARD_ROOM_PREVIEW),
    a11yLabel,
    counts: { assigned: member.rooms.length, completed: minutes.completed, inProgress: minutes.inProgress, notStarted: Math.max(0, minutes.remainingRooms - minutes.inProgress) },
  };
}

/* ─── Staff detail ────────────────────────────────────────────────────────── */

export interface DetailRow {
  key: string;
  label: string;
  value: string;
  muted?: boolean;
}

export interface StaffDetailRoom {
  roomId: string;
  number: string;
  phase: StaffRoomPhase;
  /** "Completed", "In progress", "Not started", … */
  status: string;
  /** Extra operational context: "Awaiting inspection", "Inspected". */
  statusNote: string | null;
  /** "30 min" — only a recorded estimate, never a default. */
  estimate: string | null;
  /** "3 credits" — only where the property's workload settings give a value. */
  credits: string | null;
  location: string | null;
  a11yLabel: string;
}

export interface StaffDetailModel {
  userId: string;
  name: string;
  unnamed: boolean;
  unlisted: boolean;
  attendance: AttendanceBadge;
  /** "Started 8:02 AM" — the recorded clock-in from the verified roster, never inferred. */
  startedText: string | null;
  rows: DetailRow[];
  capacity: CapacityLine | null;
  notes: TeamNote[];
  coverage: string | null;
  rooms: StaffDetailRoom[];
  hasRooms: boolean;
}

export interface StaffDetailContext {
  language: string;
  timeZone: string;
  t: Translate;
}

function locationOf(room: BoardRoom, t: Translate): string | null {
  const parts = [room.building ? t("roomBoard.building", { building: room.building }) : null, room.floorKnown ? t("roomBoard.floor", { floor: room.floor }) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function buildStaffDetail(member: AssignmentTeamMember, entries: ReadonlyMap<string, AssignmentRoom>, context: StaffDetailContext): StaffDetailModel {
  const { t, language, timeZone } = context;
  const { minutes, credits } = member.load;
  const capacity = capacityLine(member, t);
  const attendance = attendanceBadge(member.attendance, t);
  const started = member.startedAt ? formatHotelTime(member.startedAt, timeZone, language) : null;

  const rows: DetailRow[] = [
    { key: "assigned", label: t("assignments.v2.team.detail.assigned"), value: t("assignments.v2.team.detail.rooms", { count: member.rooms.length }) },
    { key: "completed", label: t("assignments.v2.team.detail.completed"), value: t("assignments.v2.team.detail.rooms", { count: minutes.completed }) },
    { key: "inProgress", label: t("assignments.v2.team.detail.inProgress"), value: t("assignments.v2.team.detail.rooms", { count: minutes.inProgress }) },
    { key: "notStarted", label: t("assignments.v2.team.detail.notStarted"), value: t("assignments.v2.team.detail.rooms", { count: Math.max(0, minutes.remainingRooms - minutes.inProgress) }) },
    { key: "remaining", label: t("assignments.v2.team.detail.remaining"), value: remainingText(member, t), ...(minutes.remainingRooms > 0 && !minutes.minutesComplete ? { muted: true } : {}) },
  ];
  if (credits.available) {
    rows.push({
      key: "credits",
      label: t("assignments.v2.team.detail.credits"),
      value: credits.complete ? t("assignments.v2.team.detail.creditsValue", { credits: credits.remaining }) : t("assignments.v2.team.detail.creditsAtLeast", { credits: credits.remaining }),
      ...(credits.complete ? {} : { muted: true }),
    });
  }
  const { target } = member.load.capacity;
  if (target !== null) {
    rows.push({ key: "planned", label: t("assignments.v2.team.detail.plannedCapacity"), value: t(member.load.capacity.targetSource === "override" ? "assignments.v2.team.detail.targetOverride" : "assignments.v2.team.detail.target", { credits: target }) });
  }
  // A reliable percentage is drawn as the bar below the rows; the row exists only to say why there is none.
  if (capacity.percent === null) rows.push({ key: "capacity", label: t("assignments.v2.team.detail.capacity"), value: capacity.text, muted: true });

  const rooms = sortStaffRooms(member.rooms).map<StaffDetailRoom>((room) => {
    const entry = entries.get(room.roomId);
    const stage = room.statusInfo.stage;
    const note = stage === "awaiting_inspection" ? t("assignments.v2.team.phase.awaitingInspection") : stage === "guest_ready" ? t("assignments.v2.team.phase.inspected") : null;
    const estimate = entry?.estimate && stage !== "awaiting_inspection" && stage !== "guest_ready" ? t("assignments.v2.card.estimateShort", { minutes: Math.round(entry.estimate.minutes) }) : null;
    const roomCredits = entry?.credits.credits;
    const creditText = roomCredits !== null && roomCredits !== undefined && (stage === "to_clean" || stage === "in_progress") ? t("assignments.v2.team.detail.roomCredits", { credits: roomCredits }) : null;
    const status = phaseLabel(room, t);
    return {
      roomId: room.roomId,
      number: room.roomNumber,
      phase: phaseOf(stage),
      status,
      statusNote: note,
      estimate,
      credits: creditText,
      location: locationOf(room, t),
      a11yLabel: [t("assignments.v2.card.roomLabel", { room: room.roomNumber }), status, note, estimate, creditText].filter(Boolean).join(", "),
    };
  });

  return {
    userId: member.userId,
    name: member.name ?? t("assignments.v2.team.nameUnavailable"),
    unnamed: member.name === null,
    unlisted: !member.listed,
    attendance,
    startedText: started ? t("assignments.v2.team.detail.started", { time: started }) : null,
    rows,
    capacity,
    notes: notesOf(member, t),
    coverage: coverageText(member, t),
    rooms,
    hasRooms: rooms.length > 0,
  };
}
