import { build, room, session } from "../helpers/homeModelFixture";
import { resolveMarkCleanReadiness, rejectionNeedsRoom } from "@/lib/housekeeping/markCleanReadiness";
import { nextRoomAfter } from "@/lib/housekeeping/postCompletion";
import type { ChecklistItem } from "@/lib/housekeeping/cleanSession";

const done = (id: string): ChecklistItem => ({ item_id: id, section: "Bed", label: `Item ${id}`, is_required: true, checked: true, checked_at: null });
const open = (id: string): ChecklistItem => ({ ...done(id), checked: false });

function ready(overrides: Record<string, unknown> = {}) {
  const r = room("208", { status: "IN_PROGRESS", clean_type: "LIGHT", ...overrides });
  return { r, s: session("208", { cleanType: "LIGHT", checklist: [done("a"), done("b")] }) };
}

const resolve = (rooms: ReturnType<typeof room>[], s: ReturnType<typeof session> | undefined, roomId = "208", online = true) =>
  resolveMarkCleanReadiness({ model: build(rooms, { sessions: s ? { "208": s } : {} }), roomId, session: s, isOnline: online });

describe("resolveMarkCleanReadiness", () => {
  it("is ready when the room is assigned, in progress and every required item is done", () => {
    const { r, s } = ready();
    expect(resolve([r], s)).toEqual({ state: "ready", roomNumber: "208", done: 2, total: 2, willQueue: false });
  });

  it("will only queue the completion when offline", () => {
    const { r, s } = ready();
    expect(resolve([r], s, "208", false)).toMatchObject({ state: "ready", willQueue: true });
  });

  it("explains an incomplete checklist, names what is open and routes to finishing it", () => {
    const { r } = ready();
    const s = session("208", { cleanType: "LIGHT", checklist: [done("a"), open("b"), open("c")] });
    expect(resolve([r], s)).toMatchObject({
      state: "blocked",
      reason: "checklist_incomplete",
      action: "finish_checklist",
      done: 1,
      total: 3,
      missing: ["Item b", "Item c"],
    });
  });

  it("will not offer a departure from Home: linen counts are entered on the room screen", () => {
    const { r } = ready({ clean_type: "DEP" });
    const s = session("208", { cleanType: "DEP", checklist: [done("a")] });
    expect(resolve([r], s)).toMatchObject({ state: "blocked", reason: "departure", action: "open_room" });
  });

  it("is blocked when the room is no longer on this person's list (reassigned)", () => {
    const { s } = ready();
    expect(resolve([room("999", { status: "DIRTY" })], s)).toMatchObject({ state: "blocked", reason: "not_assigned", action: "none" });
  });

  it("is blocked without a session, and with a conflict", () => {
    const { r, s } = ready();
    expect(resolve([r], undefined)).toMatchObject({ state: "blocked", reason: "no_session", action: "open_room" });
    const conflicted = { ...s, conflict: { code: "SESSION_ABANDONED" as const, message: "closed", at: "2026-10-14T14:00:00.000Z" } };
    expect(resolve([r], conflicted)).toMatchObject({ state: "blocked", reason: "conflict", action: "open_room" });
  });

  it("will not resubmit a completion that is already waiting to send, or one already confirmed", () => {
    const { r, s } = ready();
    expect(resolve([r], { ...s, completeRequestedAt: "2026-10-14T14:58:00.000Z" })).toMatchObject({ state: "blocked", reason: "already_pending", action: "none" });
    expect(resolve([{ ...r, status: "CLEAN" }], { ...s, completionConfirmed: true })).toMatchObject({ state: "blocked", reason: "already_done" });
  });

  it("is blocked when the room is not in progress", () => {
    const { s } = ready();
    expect(resolve([room("208", { status: "DIRTY", clean_type: "LIGHT" })], s)).toMatchObject({ state: "blocked", reason: "not_in_progress" });
  });

  it("does not call a checklist that has not loaded yet 'complete'", () => {
    const { r } = ready();
    const s = session("208", { cleanType: "LIGHT", checklist: [], startConfirmed: false });
    expect(resolve([r], s)).toMatchObject({ state: "blocked", reason: "checklist_incomplete" });
  });
});

describe("rejectionNeedsRoom", () => {
  it("sends validation and session problems to the room screen, not a retry loop", () => {
    expect(rejectionNeedsRoom("REQUIRED_ITEMS_INCOMPLETE")).toBe(true);
    expect(rejectionNeedsRoom("SESSION_GONE")).toBe(true);
    expect(rejectionNeedsRoom("ROOM_STATE_CHANGED")).toBe(true);
    expect(rejectionNeedsRoom("NO_SESSION")).toBe(true);
    expect(rejectionNeedsRoom("UNKNOWN")).toBe(false);
  });
});

describe("nextRoomAfter", () => {
  it("offers the next eligible room and never the one just finished", () => {
    const model = build([room("208", { status: "CLEAN" }), room("215"), room("216")]);
    expect(nextRoomAfter(model, "208")?.room.room_number).toBe("215");
  });

  it("skips the completed room even if it still ranks first", () => {
    const model = build([room("208"), room("215")]);
    expect(nextRoomAfter(model, "208")?.room.room_number).toBe("215");
  });

  it("respects new rush priority and never offers a restricted room", () => {
    const model = build([room("208", { status: "CLEAN" }), room("215"), room("216", { dnd_flag: true }), room("220", { priority: 1 } as never)]);
    const next = nextRoomAfter(model, "208");
    expect(next?.room.room_number).not.toBe("216");
    expect(next).not.toBeNull();
  });

  it("is null when nothing else is ready", () => {
    expect(nextRoomAfter(build([room("208", { status: "CLEAN" }), room("216", { dnd_flag: true })]), "208")).toBeNull();
  });
});
