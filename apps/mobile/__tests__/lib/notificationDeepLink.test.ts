import { resolveNotificationTarget, routeForTarget } from "@/lib/notifications/deepLink";

const ROOM = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const WO = "0b8e1c52-3c3a-4f0e-9d64-1a6a8f6a2b11";
const TASK = "11111111-1111-4111-8111-111111111111";

describe("resolveNotificationTarget", () => {
  it("opens a task alert for any signed-in role, by id only", () => {
    for (const role of ["housekeeper", "engineer", "gm", "front_desk", "housekeeping_supervisor", "inspector"] as const) {
      expect(resolveNotificationTarget({ type: "task_assigned", task_id: TASK }, role)).toEqual({ kind: "task", taskId: TASK });
    }
  });

  it("opens a room alert only for roles that have rooms, and only for a well-formed id", () => {
    const data = { type: "room_assignment", url: `/(app)/my-rooms/${ROOM}` };
    expect(resolveNotificationTarget(data, "housekeeper")).toEqual({ kind: "room", roomId: ROOM });
    expect(resolveNotificationTarget(data, "housekeeping_supervisor")).toEqual({ kind: "room", roomId: ROOM });
    expect(resolveNotificationTarget(data, "engineer")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget(data, "gm")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ url: "/(app)/my-rooms/not-a-uuid" }, "housekeeper")).toEqual({ kind: "none" });
  });

  it("opens the room list for the bare list url", () => {
    expect(resolveNotificationTarget({ url: "/(app)/my-rooms" }, "housekeeper")).toEqual({ kind: "myRooms" });
  });

  it("opens a work order only for engineers", () => {
    const data = { type: "wo_assignment", url: `/(app)/work-orders/${WO}`, wo_id: WO };
    expect(resolveNotificationTarget(data, "engineer")).toEqual({ kind: "workOrder", workOrderId: WO });
    expect(resolveNotificationTarget(data, "housekeeper")).toEqual({ kind: "none" });
  });

  it.each([
    "https://evil.example/phish",
    "javascript:alert(1)",
    "patelrep://auth/callback",
    "/(app)/profile/security",
    "/(app)/staff",
    "/(app)/my-rooms/../profile",
    `/(app)/my-rooms/${ROOM}/extra`,
    `/(app)/my-rooms/${ROOM}?x=1`,
    `//(app)/my-rooms/${ROOM}`,
    `/my-rooms/${ROOM}`,
    "",
    42,
    null,
  ])("never navigates to an arbitrary payload url: %p", (url) => {
    expect(resolveNotificationTarget({ url }, "housekeeper")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ url }, "engineer")).toEqual({ kind: "none" });
  });

  it("ignores payloads it cannot read, a missing role, and legacy types no producer writes", () => {
    expect(resolveNotificationTarget(null, "housekeeper")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget("room", "housekeeper")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ url: `/(app)/my-rooms/${ROOM}` }, undefined)).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ type: "guest_request", requestId: ROOM }, "front_desk")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ type: "room_inspection" }, "housekeeping_supervisor")).toEqual({ kind: "none" });
  });

  it("rejects a task payload whose type is not a task type or whose id is malformed", () => {
    expect(resolveNotificationTarget({ type: "direct_message", task_id: TASK }, "housekeeper")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ type: "task_assigned", task_id: "1; DROP" }, "housekeeper")).toEqual({ kind: "none" });
  });
});

describe("routeForTarget", () => {
  it("maps each validated target to a router call and nothing else to null", () => {
    expect(routeForTarget({ kind: "task", taskId: TASK })).toEqual({ pathname: "/(app)/tasks", params: { taskId: TASK } });
    expect(routeForTarget({ kind: "room", roomId: ROOM })).toEqual({ pathname: `/(app)/my-rooms/${ROOM}` });
    expect(routeForTarget({ kind: "myRooms" })).toEqual({ pathname: "/(app)/my-rooms" });
    expect(routeForTarget({ kind: "workOrder", workOrderId: WO })).toEqual({ pathname: `/(app)/work-orders/${WO}` });
    expect(routeForTarget({ kind: "none" })).toBeNull();
  });
});
