import type { Room } from "@/stores/appStore";
import { isMessageNotification, resolveNotificationLink, roomIdFromNotificationData, senderOf } from "@/lib/housekeeping/notificationLinks";

const ROOMS = [{ id: "room-310", room_number: "310" }, { id: "room-208", room_number: "208" }] as unknown as Room[];
const TASK = "3f2b9c1e-6a4d-4e8b-9c3a-1d2e3f4a5b6c";

describe("notification links", () => {
  it("links a task through the existing task-link contract", () => {
    expect(resolveNotificationLink({ type: "task_assigned", data: { task_id: TASK } }, ROOMS)).toEqual({ kind: "task", taskId: TASK });
  });

  it("ignores a task id on a notification type that is not a task alert", () => {
    expect(resolveNotificationLink({ type: "direct_message", data: { task_id: TASK } }, ROOMS)).toEqual({ kind: "none" });
  });

  it("links a room only when it is on this person's own list", () => {
    expect(resolveNotificationLink({ type: "direct_message", data: { room_id: "room-310" } }, ROOMS)).toEqual({
      kind: "room",
      roomId: "room-310",
      roomNumber: "310",
    });
    expect(resolveNotificationLink({ type: "direct_message", data: { room_id: "room-999" } }, ROOMS)).toEqual({ kind: "none" });
  });

  it("never infers a link from the message wording", () => {
    expect(resolveNotificationLink({ type: "direct_message", data: {} }, ROOMS)).toEqual({ kind: "none" });
    expect(resolveNotificationLink({ type: "direct_message", data: null }, ROOMS)).toEqual({ kind: "none" });
    expect(resolveNotificationLink({ type: "direct_message" }, ROOMS)).toEqual({ kind: "none" });
  });

  it("reads a room id only from a well-formed payload", () => {
    expect(roomIdFromNotificationData({ room_id: "  r-1 " })).toBe("r-1");
    expect(roomIdFromNotificationData({ roomId: "r-2" })).toBe("r-2");
    expect(roomIdFromNotificationData({ room_id: 5 })).toBeNull();
    expect(roomIdFromNotificationData("room")).toBeNull();
    expect(roomIdFromNotificationData(undefined)).toBeNull();
  });

  it("shows a sender only when the record carries one", () => {
    expect(senderOf({ type: "direct_message", data: { sender_name: "Dana Ruiz" } })).toBe("Dana Ruiz");
    expect(senderOf({ type: "direct_message", data: {} })).toBeNull();
    expect(senderOf({ type: "direct_message", data: { sender_name: "   " } })).toBeNull();
  });

  it("recognises supervisor and team messages", () => {
    expect(isMessageNotification("direct_message")).toBe(true);
    expect(isMessageNotification("broadcast")).toBe(true);
    expect(isMessageNotification("task_assigned")).toBe(false);
  });
});
