import type { UserRole } from "@/lib/supabase";
import { ENGINEERING_ROLES } from "@/lib/engineering/roles";
import { resolveScheduleTarget, type ScheduleTarget } from "@/lib/scheduling/scheduleLink";
import { taskIdFromNotification } from "@/lib/tasks/taskLink";

/**
 * Where tapping a push may take the person. The payload is data from the network, so it is never used as
 * a route: it is matched against this closed list, each entry needs a well-formed id and a role that has
 * that screen, and anything else opens nothing. The destination screens still re-read their record as the
 * signed-in person, so a stale tap, another hotel's id or another account's alert shows nothing.
 *
 * Only payloads the API really sends are recognised (`url` for room and work-order alerts, `task_id` for
 * task alerts). Legacy guesses for event types that no producer writes were removed.
 */
export type NotificationTarget =
  | { kind: "task"; taskId: string }
  | { kind: "room"; roomId: string }
  | { kind: "myRooms" }
  | { kind: "workOrder"; workOrderId: string }
  | { kind: "schedule"; target: ScheduleTarget }
  | { kind: "none" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROOM_URL = new RegExp(`^/\\(app\\)/my-rooms/(${UUID})$`, "i");
const WORK_ORDER_URL = new RegExp(`^/\\(app\\)/work-orders/(${UUID})$`, "i");

const ROOM_ROLES: ReadonlySet<UserRole> = new Set(["housekeeper", "housekeeping_supervisor"]);
const WORK_ORDER_ROLES: ReadonlySet<UserRole> = new Set(ENGINEERING_ROLES);

export function resolveNotificationTarget(data: unknown, role: UserRole | null | undefined): NotificationTarget {
  if (!data || typeof data !== "object" || !role) return { kind: "none" };
  const record = data as { url?: unknown };

  const schedule = resolveScheduleTarget(data, role);
  if (schedule) return { kind: "schedule", target: schedule };

  const taskId = taskIdFromNotification(data);
  if (taskId) return { kind: "task", taskId };

  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) return { kind: "none" };

  if (ROOM_ROLES.has(role)) {
    if (url === "/(app)/my-rooms") return { kind: "myRooms" };
    const room = ROOM_URL.exec(url);
    if (room) return { kind: "room", roomId: room[1].toLowerCase() };
  }
  if (WORK_ORDER_ROLES.has(role)) {
    const workOrder = WORK_ORDER_URL.exec(url);
    if (workOrder) return { kind: "workOrder", workOrderId: workOrder[1].toLowerCase() };
  }
  return { kind: "none" };
}

/** The router call for a validated target, or null when there is nothing to open. */
export function routeForTarget(target: NotificationTarget): { pathname: string; params?: Record<string, string> } | null {
  switch (target.kind) {
    case "task":
      return { pathname: "/(app)/tasks", params: { taskId: target.taskId } };
    case "room":
      return { pathname: `/(app)/my-rooms/${target.roomId}` };
    case "myRooms":
      return { pathname: "/(app)/my-rooms" };
    case "workOrder":
      return { pathname: `/(app)/work-orders/${target.workOrderId}` };
    case "schedule":
      return Object.keys(target.target.params).length > 0 ? { pathname: target.target.pathname, params: target.target.params } : { pathname: target.target.pathname };
    default:
      return null;
  }
}
