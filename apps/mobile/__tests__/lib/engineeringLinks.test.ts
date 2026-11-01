import { resolveNotificationTarget, routeForTarget } from "@/lib/notifications/deepLink";
import { resolveNotificationLink } from "@/lib/housekeeping/notificationLinks";

const ID = "3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b";

describe("engineering notification links", () => {
  it("opens a work order or a room record for an engineering role", () => {
    for (const role of ["engineer", "chief_engineer"] as const) {
      expect(resolveNotificationTarget({ url: `/(app)/work-orders/${ID}` }, role)).toEqual({ kind: "workOrder", workOrderId: ID });
      expect(resolveNotificationTarget({ url: `/(app)/room-status/${ID.toUpperCase()}` }, role)).toEqual({ kind: "engRoom", roomId: ID });
    }
    expect(routeForTarget({ kind: "engRoom", roomId: ID })).toEqual({ pathname: `/(app)/room-status/${ID}` });
  });

  it("never opens engineering screens for other roles, or anything that is not a validated in-app path", () => {
    expect(resolveNotificationTarget({ url: `/(app)/room-status/${ID}` }, "housekeeper")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ url: `/(app)/work-orders/${ID}` }, "front_desk")).toEqual({ kind: "none" });
    for (const url of ["https://evil.example/(app)/work-orders/" + ID, `/(app)/work-orders/${ID}/../../admin`, "/(app)/work-orders/not-a-uuid", `/(app)/assets/${ID}`, "javascript:alert(1)"]) {
      expect(resolveNotificationTarget({ url }, "engineer")).toEqual({ kind: "none" });
    }
    expect(resolveNotificationTarget(null, "engineer")).toEqual({ kind: "none" });
    expect(resolveNotificationTarget({ url: `/(app)/work-orders/${ID}` }, null)).toEqual({ kind: "none" });
  });

  it("offers the in-app link on the notification detail only when the url validates", () => {
    expect(resolveNotificationLink({ type: "wo_assignment", data: { url: `/(app)/work-orders/${ID}` } }, [], "engineer")).toEqual({ kind: "workOrder", workOrderId: ID });
    expect(resolveNotificationLink({ type: "room_availability_changed", data: { url: `/(app)/room-status/${ID}` } }, [], "chief_engineer")).toEqual({ kind: "engRoom", roomId: ID });
    expect(resolveNotificationLink({ type: "wo_reassigned", data: { wo_id: ID } }, [], "engineer")).toEqual({ kind: "none" });
    expect(resolveNotificationLink({ type: "wo_assignment", data: { url: `/(app)/work-orders/${ID}` } }, [], "housekeeper")).toEqual({ kind: "none" });
  });
});
