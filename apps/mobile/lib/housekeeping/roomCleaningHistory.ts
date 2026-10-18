import type { CleanSessionDetailRaw, CleanSessionRaw, RoomHistoryRow } from "@/lib/api/roomPanels";
import { formatHotelTime, hotelDateKey, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { classifyRoomStatus } from "@/lib/housekeeping/roomBoardModel";
import { isNoteEntry } from "@/lib/housekeeping/roomNote";

/* ─── Cleaning history & room activity — view layer (pure) ──────────────────
   Two DIFFERENT records, never blended:
     - cleaning history = `room_clean_sessions` (GET /clean-sessions): who cleaned, how long, what was checked;
     - activity         = `room_status_history` (GET /rooms/{id}/history): status changes and staff notes.
   Nothing is invented. A housekeeper is named only when the verified staff list names them (an id is never a
   name). A missing duration is "not recorded", never zero minutes. A session that is not completed is never
   shown as completed. A photo count is only what the detail endpoint actually returned. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface HistoryContext {
  now: number;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  /** A verified display name for a user id, or null. Never the id itself. */
  nameOf: (userId: string | null | undefined) => string | null;
}

/** How many sessions the list shows at first, and how many each "Load more" adds. */
export const HISTORY_PAGE_SIZE = 10;

function localeOf(language: string): string {
  return language.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "OCT 18" (the year is added only when it is not the current one). */
export function dayLabel(date: Date, ctx: Pick<HistoryContext, "now" | "timeZone" | "language">): string {
  const zone = resolveTimeZone(ctx.timeZone);
  const yearOf = (value: Date) => value.toLocaleDateString("en-US", { year: "numeric", timeZone: zone });
  const sameYear = yearOf(date) === yearOf(new Date(ctx.now));
  return date
    .toLocaleDateString(localeOf(ctx.language), { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: zone })
    .replace(/\./g, "")
    .toUpperCase();
}

/** "Today, 10:42 AM" / "Oct 17, 11:18 AM" — null when the instant is missing or unreadable. */
export function momentLabel(iso: string | null | undefined, ctx: HistoryContext): string | null {
  const date = parse(iso);
  if (!date) return null;
  const time = formatHotelTime(date, ctx.timeZone, ctx.language);
  if (!time) return null;
  if (hotelDateKey(date, ctx.timeZone) === hotelDateKey(new Date(ctx.now), ctx.timeZone)) return ctx.t("roomBoard.detail.todayAt", { time });
  const day = date.toLocaleDateString(localeOf(ctx.language), { month: "short", day: "numeric", timeZone: resolveTimeZone(ctx.timeZone) });
  return ctx.t("roomBoard.detail.dayAt", { day, time });
}

/* ─── Cleaning sessions ───────────────────────────────────────────────────── */

export type SessionState = "completed" | "in_progress" | "abandoned" | "unknown";

export function sessionStateOf(status: string | null | undefined): SessionState {
  if (status === "completed") return "completed";
  if (status === "active") return "in_progress";
  if (status === "abandoned") return "abandoned";
  return "unknown";
}

const CLEAN_TYPES = new Set(["DEP", "FULL", "LIGHT"]);

/** A clean type is named only when it is one of the three the system defines; anything else is left out. */
function typeLabelOf(type: string | null | undefined, t: Translate): string | null {
  const code = (type ?? "").toUpperCase();
  return CLEAN_TYPES.has(code) ? t(`roomBoard.panel.cleaning.type.${code}`) : null;
}

/** "31 min" for a recorded, plausible duration; null otherwise (zero or missing means "not recorded"). */
export function durationLabel(seconds: number | null | undefined, t: Translate): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return t("roomBoard.detail.cleaning.minutes", { minutes: Math.max(1, Math.round(seconds / 60)) });
}

function checklistLabel(done: number | null | undefined, total: number | null | undefined): string | null {
  const count = typeof total === "number" && total > 0 ? total : 0;
  if (count === 0) return null;
  const finished = typeof done === "number" && done >= 0 ? Math.min(done, count) : 0;
  return `${finished} / ${count}`;
}

export interface CleanSessionRow {
  id: string;
  state: SessionState;
  /** "Departure clean"; null when the type is not recorded or not one of ours. */
  typeLabel: string | null;
  stateLabel: string;
  /** "Completed 10:42 AM" / "Started 9:15 AM" / "Stopped 9:50 AM"; null when the session has no readable time. */
  timeLine: string | null;
  /** "31 min"; null when not recorded or the session is not complete. */
  duration: string | null;
  /** The session is complete but the server never recorded a usable duration. */
  durationMissing: boolean;
  checklist: string | null;
  housekeeper: string | null;
  note: string | null;
  dayKey: string;
}

export interface CleanSessionGroup {
  dayKey: string;
  label: string;
  rows: CleanSessionRow[];
}

function clock(iso: string | null | undefined, ctx: HistoryContext): string | null {
  const date = parse(iso);
  return date ? formatHotelTime(date, ctx.timeZone, ctx.language) : null;
}

export function buildSessionRow(raw: CleanSessionRaw, ctx: HistoryContext): CleanSessionRow {
  const { t } = ctx;
  const state = sessionStateOf(raw.status);
  // The instant a session belongs to: when it finished, or — if it never did — when it began.
  const anchor = state === "completed" || state === "abandoned" ? (raw.ended_at ?? raw.started_at) : raw.started_at;
  const at = clock(anchor, ctx);
  const timeLine =
    at === null
      ? null
      : state === "completed"
        ? t("roomBoard.panel.cleaning.completedAt", { time: at })
        : state === "abandoned"
          ? t("roomBoard.panel.cleaning.stoppedAt", { time: at })
          : t("roomBoard.panel.cleaning.startedAt", { time: at });
  const duration = state === "completed" ? durationLabel(raw.duration_seconds, t) : null;
  const note = raw.notes?.trim() ? raw.notes.trim() : null;
  return {
    id: raw.id,
    state,
    typeLabel: typeLabelOf(raw.clean_type, t),
    stateLabel: t(`roomBoard.panel.cleaning.state.${state}`),
    timeLine,
    duration,
    durationMissing: state === "completed" && duration === null,
    checklist: checklistLabel(raw.checklist_done, raw.checklist_total),
    housekeeper: ctx.nameOf(raw.housekeeper_id),
    note,
    dayKey: hotelDateKey(anchor, ctx.timeZone) ?? "unknown",
  };
}

/** Sessions grouped by hotel-local day, newest first, `visible` rows in all. */
export function buildCleaningHistory(
  raw: readonly CleanSessionRaw[],
  ctx: HistoryContext,
  visible: number,
): { groups: CleanSessionGroup[]; total: number; shown: number } {
  const rows = raw.map((session) => ({
    row: buildSessionRow(session, ctx),
    anchor: session.status === "completed" || session.status === "abandoned" ? (session.ended_at ?? session.started_at ?? null) : (session.started_at ?? null),
  }));
  const shown = rows.slice(0, Math.max(0, visible));
  const today = hotelDateKey(new Date(ctx.now), ctx.timeZone);
  const groups: CleanSessionGroup[] = [];
  for (const { row, anchor } of shown) {
    let group = groups[groups.length - 1];
    if (!group || group.dayKey !== row.dayKey) {
      const date = parse(anchor);
      const base = date ? dayLabel(date, ctx) : ctx.t("roomBoard.panel.cleaning.dateUnknown");
      group = {
        dayKey: row.dayKey,
        label: row.dayKey === today && date ? ctx.t("roomBoard.panel.cleaning.todayHeading", { date: base }) : base,
        rows: [],
      };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return { groups, total: rows.length, shown: shown.length };
}

/* ─── One session ─────────────────────────────────────────────────────────── */

export interface SessionChecklistItem {
  key: string;
  section: string | null;
  label: string;
  checked: boolean;
  required: boolean;
}

export interface SessionPhoto {
  id: string;
  kind: "proof" | "issue" | "other";
  /** A signed link, or null when the server could not produce one. */
  url: string | null;
  takenAt: string | null;
}

export interface SessionDetail {
  row: CleanSessionRow;
  /** Started / finished / duration lines, only those the record has. */
  facts: Array<{ key: string; label: string; value: string }>;
  checklist: SessionChecklistItem[];
  photos: SessionPhoto[];
}

export function buildSessionDetail(raw: CleanSessionDetailRaw, ctx: HistoryContext): SessionDetail {
  const { t } = ctx;
  const row = buildSessionRow(raw, ctx);
  const facts: SessionDetail["facts"] = [];
  const started = momentLabel(raw.started_at, ctx);
  if (started) facts.push({ key: "started", label: t("roomBoard.panel.cleaning.row.started"), value: started });
  const ended = momentLabel(raw.ended_at, ctx);
  if (ended && row.state !== "in_progress") {
    facts.push({
      key: "ended",
      label: t(row.state === "abandoned" ? "roomBoard.panel.cleaning.row.stopped" : "roomBoard.panel.cleaning.row.completed"),
      value: ended,
    });
  }
  if (row.state === "completed") {
    facts.push({ key: "duration", label: t("roomBoard.detail.cleaning.duration"), value: row.duration ?? t("roomBoard.panel.cleaning.notRecorded") });
  }
  if (row.housekeeper) facts.push({ key: "housekeeper", label: t("roomBoard.panel.cleaning.row.housekeeper"), value: row.housekeeper });

  const checklist = (Array.isArray(raw.checklist) ? raw.checklist : []).flatMap((item, index): SessionChecklistItem[] => {
    const label = item?.label?.trim();
    if (!label) return [];
    return [{ key: item.item_id ?? `item-${index}`, section: item.section?.trim() || null, label, checked: item.checked === true, required: item.is_required === true }];
  });

  const photos = (Array.isArray(raw.photos) ? raw.photos : []).map(
    (photo): SessionPhoto => ({
      id: photo.id,
      kind: photo.kind === "proof" || photo.kind === "issue" ? photo.kind : "other",
      url: photo.url && photo.url.trim() ? photo.url : null,
      takenAt: momentLabel(photo.created_at, ctx),
    }),
  );
  return { row, facts, checklist, photos };
}

/* ─── Activity (room_status_history) ──────────────────────────────────────── */

export type ActivityKind = "note" | "status";

export interface ActivityEntry {
  key: string;
  kind: ActivityKind;
  /** The note's text, or "Dirty → Clean". */
  text: string;
  at: string | null;
  /** Who recorded it; null when the record has no verified actor. */
  actor: string | null;
}

function statusName(code: string | null | undefined, t: Translate): string {
  return t(`roomBoard.card.status.${classifyRoomStatus(code).code ?? "UNKNOWN"}`);
}

/**
 * Notes and status changes. A status-change row's own `notes` field is deliberately NOT shown: the server also
 * stores machine text there (e.g. "Guest checked out|prev_clean_type=DEP"). Rows that are neither a note nor a
 * status change are skipped.
 */
export function buildActivity(rows: readonly RoomHistoryRow[], ctx: HistoryContext): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  rows.forEach((row, index) => {
    const key = row.id ?? `row-${index}`;
    const at = momentLabel(row.created_at, ctx);
    const actor = row.actor_name?.trim() || null;
    if (isNoteEntry(row)) {
      out.push({ key, kind: "note", text: (row.notes ?? "").trim(), at, actor });
    } else if (row.from_status && row.to_status && row.from_status !== row.to_status) {
      out.push({
        key,
        kind: "status",
        text: ctx.t("roomBoard.panel.activity.statusChange", { from: statusName(row.from_status, ctx.t), to: statusName(row.to_status, ctx.t) }),
        at,
        actor,
      });
    }
  });
  return out;
}
