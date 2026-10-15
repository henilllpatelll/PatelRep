import { answerRoomQuestion, buildReadinessFacts, buildRoomGuidance, roomQuestionIds } from "@/lib/housekeeping/roomAssist";
import { classifyRoom } from "@/lib/housekeeping/needsAttention";
import { estimateBasisOf } from "@/lib/housekeeping/cleaningEstimate";
import type { Room } from "@/stores/appStore";
import { room, session } from "../helpers/homeModelFixture";

const withBaseline = (id: string, minutes: number, extra: Partial<Room> = {}) =>
  room(id, { rooms: { room_types: { name: "King", code: "K", base_clean_minutes: minutes } } as Room["rooms"], ...extra });

describe("cleaning estimate basis", () => {
  it("is the hotel's room-type baseline only when one is set", () => {
    expect(estimateBasisOf(withBaseline("101", 30))).toBe("room_type");
    expect(estimateBasisOf(room("101"))).toBe("general");
    expect(estimateBasisOf(withBaseline("101", 0))).toBe("general");
  });
});

describe("room readiness facts", () => {
  it("reports the estimate with where it comes from", () => {
    expect(buildReadinessFacts(withBaseline("218", 30)).estimate).toEqual({ minutes: 30, basis: "room_type" });
    expect(buildReadinessFacts(room("218")).estimate.basis).toBe("general");
  });

  it("says a work order is open only when the list carries one, and never counts them", () => {
    expect(buildReadinessFacts(room("218")).workOrder).toEqual({ state: "none" });
    const open = buildReadinessFacts(room("218", { open_work_order_id: "wo-1", open_work_order_number: "1042", open_work_order_title: "Leaking faucet" }));
    expect(open.workOrder).toEqual({ state: "open", label: "#1042 · Leaking faucet", status: null });
  });
});

describe("room guidance", () => {
  const input = (r: Room, extra: Partial<Parameters<typeof buildRoomGuidance>[0]> = {}) => ({
    room: r,
    session: undefined,
    classification: classifyRoom(r, { hasLiveSession: false }),
    isNext: false,
    ...extra,
  });

  it("is silent when there is nothing true and actionable to say", () => {
    expect(buildRoomGuidance(input(room("218")))).toBeNull();
  });

  it("names an active access restriction before anything else", () => {
    const dnd = room("412", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, open_work_order_id: "wo" });
    expect(buildRoomGuidance(input(dnd, { isNext: true }))).toEqual({ key: "rooms.guidance.restricted" });
  });

  it("counts what is left on the checklist from the live session, never from a model", () => {
    const r = room("312", { status: "IN_PROGRESS" });
    const s = session("312");
    expect(buildRoomGuidance({ room: r, session: s, classification: classifyRoom(r, { hasLiveSession: true }), isNext: false })).toEqual({
      key: "rooms.guidance.itemsLeft",
      params: { count: 1 },
    });
  });

  it("flags changes that have not reached the server, ahead of the checklist count", () => {
    const r = room("312", { status: "IN_PROGRESS" });
    const s = session("312", { pendingItems: { b: { item_id: "b", section: "Bath", label: "Bathroom", is_required: true, checked: true, checked_at: null } } });
    expect(buildRoomGuidance({ room: r, session: s, classification: classifyRoom(r, { hasLiveSession: true }), isNext: false })?.key).toBe("rooms.guidance.pending");
  });

  it("mentions a recorded maintenance follow-up, then 'next' only before cleaning has started", () => {
    const r = room("306", { open_work_order_id: "wo-9" });
    expect(buildRoomGuidance(input(r, { isNext: true }))?.key).toBe("rooms.guidance.workOrder");
    expect(buildRoomGuidance(input(room("306"), { isNext: true }))?.key).toBe("rooms.guidance.next");
  });
});

describe("questions about a room", () => {
  it("offers the checklist question only while a clean is open", () => {
    expect(roomQuestionIds(false)).toEqual(["reportProblem", "openWorkOrders", "findProcedure"]);
    expect(roomQuestionIds(true)[0]).toBe("checklistLeft");
  });

  it("answers from the room on the phone, and says so plainly when the room is gone", () => {
    const answer = answerRoomQuestion("openWorkOrders", { room: null, session: undefined });
    expect(answer.type).toBe("gone");
    expect(answer.type === "gone" && answer.lines[0].key).toBe("assistant.roomQ.gone");
  });

  it("tells what is left on the checklist, naming the next few and the required count", () => {
    const r = room("312", { status: "IN_PROGRESS" });
    const answer = answerRoomQuestion("checklistLeft", { room: r, session: session("312") });
    if (answer.type !== "answer") throw new Error("expected an answer");
    expect(answer.lines[0]).toEqual({ key: "assistant.roomQ.checklist.left", params: { count: 1, required: 1 } });
    expect(answer.lines[1].params).toMatchObject({ names: "Bathroom", more: 0 });
  });

  it("does not invent a checklist when no clean is open", () => {
    const answer = answerRoomQuestion("checklistLeft", { room: room("218"), session: undefined });
    expect(answer).toEqual({ type: "answer", lines: [{ key: "assistant.roomQ.checklist.none" }] });
  });

  it("says when every item is ticked, without claiming the room is clean", () => {
    const done = session("312", {
      checklist: [{ item_id: "a", section: "Bed", label: "Make bed", is_required: true, checked: true, checked_at: null }],
    });
    const answer = answerRoomQuestion("checklistLeft", { room: room("312", { status: "IN_PROGRESS" }), session: done });
    expect(answer.type === "answer" && answer.lines[0].key).toBe("assistant.roomQ.checklist.allDone");
  });

  it("mentions unsent ticks so the person does not assume the server has them", () => {
    const pending = session("312", { pendingItems: { b: { item_id: "b", section: "Bath", label: "Bathroom", is_required: true, checked: true, checked_at: null } } });
    const answer = answerRoomQuestion("checklistLeft", { room: room("312", { status: "IN_PROGRESS" }), session: pending });
    expect(answer.type === "answer" && answer.lines.map((line) => line.key)).toContain("assistant.roomQ.checklist.pending");
  });

  it("points reporting at the existing issue form for exactly this room", () => {
    const answer = answerRoomQuestion("reportProblem", { room: room("218"), session: undefined });
    expect(answer.type === "answer" && answer.href).toBe("/(app)/my-rooms/218?action=issue");
  });

  it("links the open work order, and treats none as 'none on record', not a guarantee", () => {
    const open = answerRoomQuestion("openWorkOrders", { room: room("306", { open_work_order_id: "wo-9", open_work_order_number: "9" }), session: undefined });
    expect(open.type === "answer" && open.href).toBe("/(app)/work-orders/wo-9");
    const none = answerRoomQuestion("openWorkOrders", { room: room("306"), session: undefined });
    expect(none.type === "answer" && none.lines[0].key).toBe("assistant.roomQ.workOrder.none");
    expect(none.type === "answer" && none.href).toBeUndefined();
  });

  it("hands procedure searches to the procedures intent", () => {
    expect(answerRoomQuestion("findProcedure", { room: room("218"), session: undefined })).toEqual({ type: "compose", hint: "sop_query" });
  });
});
