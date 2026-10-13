import type { Task, TaskActivityEvent } from "@/lib/api/tasks";
import { formatHotelTime, hotelDateKey, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { isClaimable, type Viewer } from "@/lib/tasks/taskActions";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Room 214" — only for a verified room. A free-text place stays a plain location. */
export function roomLabel(task: Task, t: Translate): string | null {
  return task.room_number ? t("tasks.hk.sheet.room", { room: task.room_number }) : null;
}

/** "Room 214" or the free-text location (no floor) — the short form used in sheet subtitles. */
export function shortPlace(task: Task, t: Translate): string | null {
  return roomLabel(task, t) ?? task.location_text;
}

/** "Room 214 · Floor 2", or the free-text location, or null when the task has neither. */
export function placeLabel(task: Task, t: Translate): string | null {
  const room = roomLabel(task, t);
  if (room) return task.room_floor !== null ? `${room} · ${t("tasks.hk.sheet.floor", { floor: task.room_floor })}` : room;
  return task.location_text;
}

/** Friendly status; an unclaimed pool task reads "Available" rather than "Not started". */
export function statusLabel(task: Task, viewer: Viewer, t: Translate): string {
  if (isClaimable(task, viewer)) return t("tasks.hk.sheet.status.available");
  if (task.blocker && (task.status === "open" || task.status === "in_progress" || task.status === "escalated")) {
    return t("tasks.hk.sheet.status.blocked");
  }
  return t(`tasks.hk.sheet.status.${task.status}`);
}

export type DayBucket = "today" | "yesterday" | string;

/** Which hotel-local day an instant falls on: "today", "yesterday", or its YYYY-MM-DD key. */
export function dayBucket(iso: string, now: Date, zone: string | null): DayBucket {
  const key = hotelDateKey(iso, zone);
  if (!key) return "";
  if (key === hotelDateKey(now, zone)) return "today";
  if (key === hotelDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), zone)) return "yesterday";
  return key;
}

export interface DayGroup {
  bucket: DayBucket;
  events: TaskActivityEvent[];
}

/** Group a chronological feed into hotel-local days, keeping order (oldest first). */
export function groupByDay(events: TaskActivityEvent[], now: Date, zone: string | null): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    const bucket = dayBucket(event.at, now, zone);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) last.events.push(event);
    else groups.push({ bucket, events: [event] });
  }
  return groups;
}

/** Who did it, from the viewer's side: "You", the person's name, or null when unknown. */
export function actorLabel(event: TaskActivityEvent, viewer: Viewer, t: Translate): string | null {
  if (event.actor_id && viewer.userId && event.actor_id === viewer.userId) return t("tasks.hk.sheet.you");
  return event.actor_name;
}

/** "11:45 AM" for today in the hotel's zone, otherwise "Oct 14, 11:45 AM". */
export function formatWhen(iso: string | null, now: Date, zone: string | null, language: string): string | null {
  const time = formatHotelTime(iso, zone, language);
  if (!iso || !time) return null;
  if (hotelDateKey(iso, zone) === hotelDateKey(now, zone)) return time;
  const day = new Date(iso).toLocaleDateString(language.startsWith("es") ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: resolveTimeZone(zone),
  });
  return `${day}, ${time}`;
}
