import fs from "fs";
import path from "path";
import type { AppNotification } from "@/lib/api/notifications";
import { buildFeedItems, groupByDay, kindOf, mergeFeed, previewOf } from "@/lib/notifications/feed";
import { notificationLinkIssue, resolveNotificationLink } from "@/lib/housekeeping/notificationLinks";
import type { Room } from "@/stores/appStore";

const row = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: "n1",
  type: "direct_message",
  title: "Title",
  body: "Body",
  data: {},
  is_read: false,
  created_at: "2026-10-15T16:00:00.000Z",
  ...over,
});

describe("kindOf", () => {
  it("classifies only from the producer's reviewed event type", () => {
    expect(kindOf("task_assigned_urgent")).toBe("priority");
    expect(kindOf("wo_assignment")).toBe("maintenance");
    expect(kindOf("task_reassigned")).toBe("task");
    expect(kindOf("room_assignment")).toBe("room");
    expect(kindOf("direct_message")).toBe("message");
    expect(kindOf("something_new")).toBe("other");
    expect(kindOf(undefined)).toBe("other");
  });

  it("is not fooled by urgent-sounding wording in the type or text", () => {
    expect(kindOf("my_critical_urgent_alert")).toBe("other");
    expect(buildFeedItems([row({ type: "x", title: "URGENT CRITICAL", body: "emergency" })], "all")[0].kind).toBe("other");
  });
});

describe("previewOf", () => {
  it("masks contact details, flattens whitespace and shortens, keeping room numbers", () => {
    const text = previewOf("Guest in 412 called\n  from +1 (555) 123-4567 or guest@example.com about 413 and 414");
    expect(text).not.toMatch(/555|guest@example/);
    expect(text).toContain("412");
    expect(text).toContain("413 and 414");
    expect(text).not.toContain("\n");
  });

  it("truncates a long body with an ellipsis", () => {
    const text = previewOf("a".repeat(400));
    expect(text.length).toBeLessThanOrEqual(140);
    expect(text.endsWith("…")).toBe(true);
  });

  it("copes with a missing body", () => {
    expect(previewOf(undefined)).toBe("");
    expect(previewOf(null)).toBe("");
  });
});

describe("mergeFeed", () => {
  it("keeps one row per id, newest first, and a row either list knows is unread stays unread", () => {
    const unread = [row({ id: "a", created_at: "2026-10-15T10:00:00.000Z" })];
    const all = [
      row({ id: "b", is_read: true, created_at: "2026-10-15T12:00:00.000Z" }),
      row({ id: "a", is_read: true, created_at: "2026-10-15T10:00:00.000Z" }),
    ];
    const merged = mergeFeed(unread, all);
    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
    expect(merged.find((item) => item.id === "a")?.is_read).toBe(false);
  });

  it("never hides an unread notification for resembling another one", () => {
    const twins = [row({ id: "x1" }), row({ id: "x2" })];
    expect(mergeFeed(twins, null).map((item) => item.id).sort()).toEqual(["x1", "x2"]);
  });

  it("works with only the unread list", () => {
    expect(mergeFeed([row()], null)).toHaveLength(1);
    expect(mergeFeed([], null)).toEqual([]);
  });
});

describe("buildFeedItems", () => {
  const rows = [row({ id: "u", is_read: false }), row({ id: "r", is_read: true })];
  it("filters to unread", () => {
    expect(buildFeedItems(rows, "unread").map((item) => item.notification.id)).toEqual(["u"]);
    expect(buildFeedItems(rows, "all").map((item) => item.notification.id)).toEqual(["u", "r"]);
  });
});

describe("groupByDay", () => {
  const now = new Date("2026-10-15T18:00:00.000Z"); // 1 PM in Chicago
  const items = (...times: string[]) => buildFeedItems(times.map((created_at, n) => row({ id: `n${n}`, created_at })), "all");

  it("groups by the hotel's calendar day, not the device's", () => {
    // 03:30Z on the 16th is 10:30 PM on the 15th in Chicago: still "today" for a night-shift hotel.
    const groups = groupByDay(items("2026-10-16T03:30:00.000Z", "2026-10-15T14:00:00.000Z", "2026-10-14T20:00:00.000Z", "2026-10-10T20:00:00.000Z"), "America/Chicago", now);
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([["today", 2], ["yesterday", 1], ["earlier", 1]]);
  });

  it("omits empty groups and falls back safely for a bad zone", () => {
    expect(groupByDay(items("2026-10-15T14:00:00.000Z"), "Not/AZone", now).map((g) => g.day)).toEqual(["today"]);
    expect(groupByDay([], "America/Chicago", now)).toEqual([]);
  });
});

describe("notification destinations", () => {
  const room = { id: "room-310", room_number: "310" } as unknown as Room;
  const TASK = "3f2b9c1e-6a4d-4e8b-9c3a-1d2e3f4a5b6c";

  it("links only rooms on this person's list and flags a room that has left it", () => {
    expect(resolveNotificationLink({ type: "room_assignment", data: { room_id: "room-310" } }, [room])).toEqual({ kind: "room", roomId: "room-310", roomNumber: "310" });
    expect(resolveNotificationLink({ type: "room_assignment", data: { room_id: "room-999" } }, [room])).toEqual({ kind: "none" });
    expect(notificationLinkIssue({ type: "room_assignment", data: { room_id: "room-999" } }, [room])).toBe("room_not_on_list");
    expect(notificationLinkIssue({ type: "room_assignment", data: { room_id: "room-310" } }, [room])).toBeNull();
    expect(notificationLinkIssue({ type: "broadcast", data: {} }, [room])).toBeNull();
  });

  it("links a task by the task-link contract only, and rejects a malformed id", () => {
    expect(resolveNotificationLink({ type: "task_assigned", data: { task_id: TASK } }, [])).toEqual({ kind: "task", taskId: TASK });
    expect(resolveNotificationLink({ type: "task_assigned", data: { task_id: "not-a-uuid" } }, [])).toEqual({ kind: "none" });
    expect(resolveNotificationLink({ type: "broadcast", data: { task_id: TASK } }, [])).toEqual({ kind: "none" });
  });

  it("does not turn a tasks link into a room-missing complaint", () => {
    expect(notificationLinkIssue({ type: "task_assigned", data: { task_id: TASK } }, [])).toBeNull();
  });
});

describe("rendering the inbox makes no AI calls", () => {
  it("no notification code imports an AI client", () => {
    const root = path.resolve(__dirname, "../..");
    const files = [
      "app/(app)/notifications/index.tsx",
      "lib/notifications/feed.ts",
      "lib/api/notifications.ts",
      "lib/housekeeping/notificationLinks.ts",
      "components/home/SupervisorMessageSheet.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).not.toMatch(/sendCopilotMessage|from "@\/lib\/ai\/copilotChat"|["'`]\/ai\/|fetchShiftRecap|fetchShiftBriefing|querySOPs/);
    }
  });
});
