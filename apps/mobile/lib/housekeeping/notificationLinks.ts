import type { Room } from "@/stores/appStore";
import { resolveScheduleTarget, type ScheduleTarget } from "@/lib/scheduling/scheduleLink";
import { taskIdFromNotification } from "@/lib/tasks/taskLink";

/**
 * What a notification can link to. A link is only offered when the record is
 * verifiable on this phone: a task through the existing task-link contract (the
 * Tasks screen re-reads it as the signed-in person), a room only if it is on
 * this person's own list. Anything else is shown as plain text — nothing is
 * inferred from the message wording.
 */
export type NotificationLink =
  | { kind: "task"; taskId: string }
  | { kind: "room"; roomId: string; roomNumber: string }
  | { kind: "schedule"; target: ScheduleTarget }
  | { kind: "none" };

interface LinkableNotification {
  type: string;
  data?: Record<string, unknown> | null;
}

export function roomIdFromNotificationData(data: unknown): string | null {
  const record = data as { room_id?: unknown; roomId?: unknown } | null | undefined;
  if (!record || typeof record !== "object") return null;
  const id = record.room_id ?? record.roomId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function resolveNotificationLink(notification: LinkableNotification, rooms: readonly Room[], role?: string | null): NotificationLink {
  const data = notification.data ?? null;
  if (notification.type.startsWith("schedule_")) {
    const target = resolveScheduleTarget(data, role);
    return target ? { kind: "schedule", target } : { kind: "none" };
  }
  const taskId = taskIdFromNotification({ ...(data ?? {}), type: notification.type });
  if (taskId) return { kind: "task", taskId };
  const roomId = roomIdFromNotificationData(data);
  if (roomId) {
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (room) return { kind: "room", roomId: room.id, roomNumber: room.room_number };
  }
  return { kind: "none" };
}

/**
 * Why a notification that names a room offers no way in: the room is not on this person's list now
 * (reassigned, finished for the day, or never theirs). Said out loud so a missing button is not a mystery.
 * Tasks are not judged here: the Tasks screen re-reads the task as the signed-in person.
 */
export type NotificationLinkIssue = "room_not_on_list";

export function notificationLinkIssue(notification: LinkableNotification, rooms: readonly Room[], role?: string | null): NotificationLinkIssue | null {
  const link = resolveNotificationLink(notification, rooms, role);
  if (link.kind !== "none") return null;
  return roomIdFromNotificationData(notification.data ?? null) ? "room_not_on_list" : null;
}

/** Types written for supervisor / team messages (the Home instruction card and its drawer). */
export function isMessageNotification(type: string): boolean {
  return type === "direct_message" || type === "broadcast";
}

/** An optional sender name, only when the notification record actually carries one. */
export function senderOf(notification: LinkableNotification): string | null {
  const data = notification.data;
  const name = data && typeof data === "object" ? (data as { sender_name?: unknown }).sender_name : null;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
