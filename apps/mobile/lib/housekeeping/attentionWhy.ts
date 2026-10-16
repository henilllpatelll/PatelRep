import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { AttentionCenterItem } from "@/lib/housekeeping/homeAttention";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";

/**
 * Why an item is on the Needs-attention list, in the records' own words. Every line here is a fact read
 * off the room the server gave this person (an arrival time, a recorded deadline, an open work order, the
 * place in their own assignment order). Nothing is estimated, scored or written by a model, and a line is
 * only returned when the record actually carries the fact. The wording lives in the locale files under
 * `home.attentionCenter.why.<code>`; this module returns codes and values so it stays pure and testable.
 */

export type WhyCode = "arrival" | "deadline" | "workOrder" | "nextInOrder" | "retry";

export interface WhyLine {
  code: WhyCode;
  values: Record<string, string>;
}

const MAX_LINES = 2;

export function attentionWhyLines(row: AttentionCenterItem, model: HomeModel, ctx: TextContext, now: Date = new Date()): WhyLine[] {
  const entry = row.entry;
  if (!entry || row.item.kind !== "room") return [];
  const room = entry.room;
  const lines: WhyLine[] = [];

  // A time the record itself holds for a restriction that will be tried again.
  if ((row.item.code === "dnd" || row.item.code === "come_back_later") && row.item.at) {
    const time = formatClock(row.item.at, ctx);
    if (time) lines.push({ code: "retry", values: { time } });
  }

  // The supervisor's recorded deadline (Rush priority), not an inferred one.
  if (row.item.code !== "rush_overdue" && entry.rush && entry.neededBy) {
    const time = formatClock(entry.neededBy, ctx);
    if (time) lines.push({ code: "deadline", values: { time } });
  }

  // The arrival time on the reservation, only when it is today in the hotel's own calendar and the room is not done.
  const notDone = entry.category !== "submitted" && entry.category !== "inspected" && entry.category !== "unavailable";
  if (notDone && room.checkin_time && hotelDateKey(room.checkin_time, ctx.timeZone) === hotelDateKey(now, ctx.timeZone)) {
    const time = formatClock(room.checkin_time, ctx);
    if (time) lines.push({ code: "arrival", values: { time } });
  }

  if (room.open_work_order_id && row.item.code !== "work_order") {
    lines.push({ code: "workOrder", values: { status: (room.open_work_order_status ?? "").replace(/_/g, " ") } });
  }

  // Next in this person's verified order, and not a room they must wait on.
  if (!entry.classification.restricted && model.dashboard.upNext[0]?.room.id === room.id) {
    lines.push({ code: "nextInOrder", values: {} });
  }

  return lines.slice(0, MAX_LINES);
}
