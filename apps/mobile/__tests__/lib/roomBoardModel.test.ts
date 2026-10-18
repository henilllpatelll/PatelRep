import {
  attachLateCheckouts,
  classifyRoomStatus,
  normalizeBoardRecords,
  planAssignmentRemoval,
  statusLabelKey,
  type BoardRoom,
} from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { normalizeBoard } from "@/lib/housekeeping/supervisorToday";
import { hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const byNumber = (rooms: BoardRoom[], number: string) => rooms.find((room) => room.roomNumber === number) as BoardRoom;

describe("classifyRoomStatus — every backend status", () => {
  it.each([
    ["DIRTY", "to_clean", false],
    ["OCCUPIED", "to_clean", false],
    ["PICKUP", "to_clean", false],
    ["IN_PROGRESS", "in_progress", false],
    ["CLEAN", "awaiting_inspection", false],
    ["INSPECTED", "guest_ready", true],
    ["OOO", "unavailable", false],
    ["OUT_OF_ORDER", "unavailable", false],
    ["OUT_OF_SERVICE", "unavailable", false],
  ])("%s → %s (guestReady=%s)", (status, stage, guestReady) => {
    const info = classifyRoomStatus(status);
    expect(info.stage).toBe(stage);
    expect(info.guestReady).toBe(guestReady);
    expect(info.code).toBe(status);
    expect(info.raw).toBe(status);
  });

  it("never treats CLEAN as guest-ready: only INSPECTED is", () => {
    expect(classifyRoomStatus("CLEAN").guestReady).toBe(false);
    expect(classifyRoomStatus("CLEAN").stage).toBe("awaiting_inspection");
    expect(classifyRoomStatus("INSPECTED").guestReady).toBe(true);
  });

  it("keeps OOO / out of order / out of service distinguishable", () => {
    expect(classifyRoomStatus("OOO").unavailable).toBe("OOO");
    expect(classifyRoomStatus("OUT_OF_ORDER").unavailable).toBe("OUT_OF_ORDER");
    expect(classifyRoomStatus("OUT_OF_SERVICE").unavailable).toBe("OUT_OF_SERVICE");
    expect(classifyRoomStatus("DIRTY").unavailable).toBeNull();
  });

  it("preserves an unrecognised status explicitly instead of folding it into another stage", () => {
    const info = classifyRoomStatus("DEEP_CLEAN_HOLD");
    expect(info).toEqual({ raw: "DEEP_CLEAN_HOLD", code: null, stage: "unknown", guestReady: false, unavailable: null });
    expect(statusLabelKey(info)).toBe("roomBoard.statusMeaning.UNKNOWN");
    expect(statusLabelKey(classifyRoomStatus("CLEAN"))).toBe("roomBoard.statusMeaning.CLEAN");
  });

  it("is case-exact (a lowercase status is not silently accepted) and tolerates non-strings", () => {
    expect(classifyRoomStatus("inspected").stage).toBe("unknown");
    for (const bad of [null, undefined, 42, {}, ""]) {
      const info = classifyRoomStatus(bad);
      expect(info.stage).toBe("unknown");
      expect(info.guestReady).toBe(false);
    }
  });
});

describe("normalizeBoardRecords — nested API room records", () => {
  it("flattens the room_status spread and the nested rooms join without inventing anything", () => {
    const { rooms, invalidRows, duplicateRows } = normalizeBoardRecords(hotelBoard(), "2026-10-16");
    expect(rooms).toHaveLength(10);
    expect(invalidRows).toBe(0);
    expect(duplicateRows).toBe(0);
    const r102 = byNumber(rooms, "102");
    expect(r102).toMatchObject({
      roomId: "room-102",
      building: "A",
      floor: 1,
      floorKnown: true,
      roomType: "K",
      occupancy: "occupied",
      foStatus: "OCC",
    });
    expect(r102.statusInfo.stage).toBe("to_clean");
    expect(byNumber(rooms, "201")).toMatchObject({ building: "B", floor: 2, vip: true });
  });

  it("stamps the snapshot with the hotel date it was requested for", () => {
    expect(normalizeBoardRecords([], "2026-10-16").forDate).toBe("2026-10-16");
    expect(normalizeBoardRecords([]).forDate).toBeUndefined();
  });

  it("reports unknown values as null / unknown, never as defaults that read as facts", () => {
    const { rooms } = normalizeBoardRecords([
      { room_id: "x1", status: "DIRTY", rooms: { room_number: "301" } },
    ]);
    const room = rooms[0];
    expect(room.building).toBeNull();
    expect(room.floorKnown).toBe(false);
    expect(room.occupancy).toBe("unknown");
    expect(room.foStatus).toBeNull();
    expect(room.priority).toBeNull();
    expect(room.inspectionRequired).toBeNull();
    expect(room.prediction).toBeNull();
    expect(room.cleanSession).toBeNull();
    expect(room.workOrder).toBeNull();
    expect(room.lateCheckout).toBeNull();
    expect(room.recleanRequestedAt).toBeNull();
    expect(room.actualCheckoutAt).toBeNull();
    expect(room.serviceDeclined).toEqual({ declined: false, reason: null, note: null, at: null });
    expect(room.assignment).toEqual({ source: "none", userId: null, assignmentId: null, assignmentDate: null, shiftId: null });
  });

  it("carries arrival, checkout, actual checkout, notes, work order, session and prediction when provided", () => {
    const { rooms } = normalizeBoardRecords([
      rawRoom("110", "CLEAN", {
        checkin_time: "2026-10-16T20:00:00Z",
        checkout_time: "2026-10-16T16:00:00Z",
        actual_checkout_at: "2026-10-16T15:40:00Z",
        latest_note: "Extra towels",
        latest_note_at: "2026-10-16T16:30:00Z",
        open_work_order_id: "wo-1",
        open_work_order_number: "WO-12",
        open_work_order_title: "Leaking faucet",
        open_work_order_status: "open",
        open_work_order_priority: "high",
        last_session_id: "sess-1",
        last_clean_minutes: 41,
        last_clean_base_minutes: 30,
        last_clean_checklist_done: 12,
        last_clean_checklist_total: 14,
        last_clean_photo_count: 3,
        last_clean_ended_at: "2026-10-16T16:20:00Z",
        reclean_requested_at: "2026-10-16T16:40:00Z",
        occupancy_discrepancy: true,
        updated_at: "2026-10-16T16:41:00Z",
        prediction: { risk_level: "HIGH", predicted_ready_at: "2026-10-16T21:00:00Z", confidence_score: "0.42", last_calculated_at: "2026-10-16T16:00:00Z" },
      }),
    ]);
    const room = rooms[0];
    expect(room.checkinTime).toBe("2026-10-16T20:00:00Z");
    expect(room.actualCheckoutAt).toBe("2026-10-16T15:40:00Z");
    expect(room.latestNote).toBe("Extra towels");
    expect(room.latestNoteAt).toBe("2026-10-16T16:30:00Z");
    expect(room.workOrder).toEqual({ id: "wo-1", number: "WO-12", title: "Leaking faucet", status: "open", priority: "high" });
    expect(room.cleanSession).toEqual({
      sessionId: "sess-1",
      minutes: 41,
      baseMinutes: 30,
      checklistDone: 12,
      checklistTotal: 14,
      photoCount: 3,
      endedAt: "2026-10-16T16:20:00Z",
    });
    expect(room.prediction).toEqual({ riskLevel: "HIGH", predictedReadyAt: "2026-10-16T21:00:00Z", confidence: 0.42, calculatedAt: "2026-10-16T16:00:00Z" });
    expect(room.highRisk).toBe(true);
    expect(room.recleanRequestedAt).toBe("2026-10-16T16:40:00Z");
    expect(room.occupancyDiscrepancy).toBe(true);
    expect(room.updatedAt).toBe("2026-10-16T16:41:00Z");
  });

  it("sanitises odd fo_status, priority and prediction values", () => {
    const { rooms } = normalizeBoardRecords([
      rawRoom("111", "DIRTY", { fo_status: "WEIRD" as never, priority: 99, prediction: { risk_level: "EXTREME" as never, confidence_score: 7 } }),
      rawRoom("112", "DIRTY", { priority: 0 }),
    ]);
    expect(rooms[0].occupancy).toBe("unknown");
    expect(rooms[0].foStatus).toBeNull();
    expect(rooms[0].priority).toBe(10);
    expect(rooms[0].prediction).toMatchObject({ riskLevel: null, confidence: 1 });
    expect(rooms[1].priority).toBe(1);
  });

  it("records service-declined state with its reason", () => {
    const { rooms } = normalizeBoardRecords([
      rawRoom("113", "OCCUPIED", { do_not_service: true, service_declined_reason: "guest_declined", service_declined_note: "Sleeping", service_declined_at: "2026-10-16T14:00:00Z" }),
    ]);
    expect(rooms[0].serviceDeclined).toEqual({ declined: true, reason: "guest_declined", note: "Sleeping", at: "2026-10-16T14:00:00Z" });
  });

  it("drops rows that cannot be tied to a room and counts them; first duplicate wins", () => {
    const rows = [
      rawRoom("101", "DIRTY"),
      rawRoom("101", "INSPECTED"),
      { room_id: "ghost", status: "DIRTY", rooms: null },
      { room_id: "", status: "DIRTY", rooms: { room_number: "999" } },
      { room_id: "blank", status: "DIRTY", rooms: { room_number: "   " } },
      null,
      "garbage",
    ] as unknown as BoardRoomRaw[];
    const { rooms, invalidRows, duplicateRows } = normalizeBoardRecords(rows);
    expect(rooms.map((room) => room.roomNumber)).toEqual(["101"]);
    expect(rooms[0].status).toBe("DIRTY");
    expect(invalidRows).toBe(5);
    expect(duplicateRows).toBe(1);
  });

  it("treats a non-array payload as no rows", () => {
    for (const bad of [null, undefined, {}, "x", 7]) {
      expect(normalizeBoardRecords(bad)).toMatchObject({ rooms: [], invalidRows: 0, duplicateRows: 0 });
    }
  });

  it("keeps a missing/odd status as an unknown room rather than dropping it", () => {
    const { rooms } = normalizeBoardRecords([{ room_id: "r", rooms: { room_number: "401" } } as unknown as BoardRoomRaw]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].statusInfo.stage).toBe("unknown");
  });

  it("is the SAME normaliser Supervisor Today uses (identical rooms, counts and stamp)", () => {
    const raw = [...hotelBoard(), rawRoom("101", "CLEAN"), { room_id: "bad", status: "DIRTY" } as BoardRoomRaw];
    expect(normalizeBoard(raw, "2026-10-16")).toEqual(normalizeBoardRecords(raw, "2026-10-16"));
  });
});

describe("assignment — three separate concepts", () => {
  it("a dated row, a status mirror and nobody are told apart", () => {
    const { rooms } = normalizeBoardRecords([
      rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-1", assignment_date: "2026-10-16", assignment_shift_id: "shift-1" }),
      rawRoom("102", "DIRTY", { assigned_to: "hk-2", assignment_id: null }),
      rawRoom("103", "DIRTY"),
    ]);
    expect(byNumber(rooms, "101").assignment).toEqual({ source: "dated", userId: "hk-1", assignmentId: "as-1", assignmentDate: "2026-10-16", shiftId: "shift-1" });
    expect(byNumber(rooms, "102").assignment).toEqual({ source: "status_mirror", userId: "hk-2", assignmentId: null, assignmentDate: null, shiftId: null });
    expect(byNumber(rooms, "103").assignment.source).toBe("none");
  });

  it("does not change status or assignment during normalisation", () => {
    const raw = [rawRoom("102", "DIRTY", { assigned_to: "hk-2", assignment_id: null })];
    const before = JSON.stringify(raw);
    const { rooms } = normalizeBoardRecords(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(rooms[0].status).toBe("DIRTY");
    expect(rooms[0].assignedTo).toBe("hk-2");
  });

  it("plans removal through the right existing endpoint", () => {
    const { rooms } = normalizeBoardRecords([
      rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-1" }),
      rawRoom("102", "DIRTY", { assigned_to: "hk-2", assignment_id: null }),
      rawRoom("103", "DIRTY"),
    ]);
    expect(planAssignmentRemoval(byNumber(rooms, "101"))).toEqual({ kind: "assignment", assignmentId: "as-1" });
    expect(planAssignmentRemoval(byNumber(rooms, "102"))).toEqual({ kind: "mirror", roomId: "room-102" });
    expect(planAssignmentRemoval(byNumber(rooms, "103"))).toEqual({ kind: "none" });
  });
});

describe("attachLateCheckouts", () => {
  const { rooms } = normalizeBoardRecords([rawRoom("101", "OCCUPIED"), rawRoom("102", "OCCUPIED")]);

  it("joins open requests; approved beats pending; denied/unknown are ignored", () => {
    const joined = attachLateCheckouts(rooms, [
      { id: "l1", room_id: "room-101", status: "pending", requested_time: "2026-10-16T18:00:00Z" },
      { id: "l2", room_id: "room-101", status: "approved", requested_time: "2026-10-16T19:00:00Z" },
      { id: "l3", room_id: "room-102", status: "denied", requested_time: null },
    ]);
    expect(byNumber(joined, "101").lateCheckout).toEqual({ requestId: "l2", status: "approved", requestedTime: "2026-10-16T19:00:00Z" });
    expect(byNumber(joined, "102").lateCheckout).toBeNull();
  });

  it("leaves rooms untouched when the source is unknown or empty", () => {
    expect(attachLateCheckouts(rooms, null)).toBe(rooms);
    expect(attachLateCheckouts(rooms, [])).toBe(rooms);
  });
});
