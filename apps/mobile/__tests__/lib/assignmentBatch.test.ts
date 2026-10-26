import {
  MAX_BATCH_CHANGES,
  classifyBatchFailure,
  matchesRequest,
  newOperationId,
  parseBatchPublication,
  readBatchCheck,
  toBatchRequest,
} from "@/lib/housekeeping/assignmentBatch";
import type { PlannedChange } from "@/lib/housekeeping/assignmentPlan";

const OP = "7f0f6a3e-2b1c-4d57-9a41-0c5d6a9b8e11";
const DATE = "2026-10-16";

const change = (over: Partial<PlannedChange> = {}): PlannedChange => ({
  roomId: "room-101",
  roomNumber: "101",
  kind: "assign",
  fromUserId: null,
  toUserId: "hk-1",
  expected: { expect_unassigned: true },
  acknowledged: [],
  removal: { kind: "none" },
  source: "bulk",
  ...over,
});
const reassign = (over: Partial<PlannedChange> = {}) => change({ roomId: "room-102", roomNumber: "102", kind: "reassign", fromUserId: "hk-2", toUserId: "hk-1", expected: { expected_assigned_to: "hk-2" }, ...over });
const removal = (over: Partial<PlannedChange> = {}) =>
  change({ roomId: "room-103", roomNumber: "103", kind: "remove", fromUserId: "hk-2", toUserId: null, expected: { expected_assigned_to: "hk-2" }, removal: { kind: "assignment", assignmentId: "a" }, ...over });

describe("toBatchRequest", () => {
  it("builds the three kinds, each carrying the owner the supervisor saw", () => {
    const result = toBatchRequest(OP, DATE, [removal(), change(), reassign()]);
    expect(result).toEqual({
      ok: true,
      request: {
        operation_id: OP,
        date: DATE,
        changes: [
          { room_id: "room-101", kind: "assign", housekeeper_id: "hk-1", expect_unassigned: true },
          { room_id: "room-102", kind: "reassign", housekeeper_id: "hk-1", expected_assigned_to: "hk-2" },
          { room_id: "room-103", kind: "remove", expected_assigned_to: "hk-2" },
        ],
      },
    });
  });

  it("sends changes in room order, so a retry of the same draft is identical", () => {
    const forward = toBatchRequest(OP, DATE, [change(), reassign(), removal()]);
    const backward = toBatchRequest(OP, DATE, [removal(), reassign(), change()]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("refuses an empty draft and one past a publication's capacity", () => {
    expect(toBatchRequest(OP, DATE, [])).toEqual({ ok: false, refusal: "empty" });
    const many = Array.from({ length: MAX_BATCH_CHANGES + 1 }, (_, i) => change({ roomId: `room-${i}`, roomNumber: String(i) }));
    expect(toBatchRequest(OP, DATE, many)).toEqual({ ok: false, refusal: "too_many" });
    expect(toBatchRequest(OP, DATE, many.slice(0, MAX_BATCH_CHANGES)).ok).toBe(true);
  });

  it("refuses a room twice", () => {
    expect(toBatchRequest(OP, DATE, [change(), change({ toUserId: "hk-3" })])).toEqual({ ok: false, refusal: "duplicate_room", roomId: "room-101" });
  });

  it("never carries a room acknowledgement: a soft-blocked room cannot be bulk-published", () => {
    expect(toBatchRequest(OP, DATE, [change({ acknowledged: ["dnd"] })])).toEqual({ ok: false, refusal: "acknowledgement_not_allowed", roomId: "room-101" });
  });

  it.each([
    ["an expectation that is not the owner seen", change({ expected: { expected_assigned_to: "hk-9" } })],
    ["an assignment with an owner", change({ fromUserId: "hk-2", expected: { expected_assigned_to: "hk-2" } })],
    ["an assignment with no target", change({ toUserId: null })],
    ["a reassignment to the same person", reassign({ toUserId: "hk-2" })],
    ["a reassignment of an unassigned room", reassign({ fromUserId: null, expected: { expect_unassigned: true } })],
    ["a removal that names a person", removal({ toUserId: "hk-1" })],
    ["a removal of an unassigned room", removal({ fromUserId: null, expected: { expect_unassigned: true } })],
  ])("refuses %s", (_name, bad) => {
    expect(toBatchRequest(OP, DATE, [bad])).toMatchObject({ ok: false, refusal: "inconsistent_change" });
  });
});

const committed = (over: Record<string, unknown> = {}) => ({
  operation_id: OP,
  status: "committed",
  assignment_date: DATE,
  counts: { total: 3, assign: 1, reassign: 1, remove: 1 },
  rooms: [
    { room_id: "room-101", room_number: "101", kind: "assign", previous_assigned_to: null, assigned_to: "hk-1" },
    { room_id: "room-102", room_number: "102", kind: "reassign", previous_assigned_to: "hk-2", assigned_to: "hk-1" },
    { room_id: "room-103", room_number: "103", kind: "remove", previous_assigned_to: "hk-2", assigned_to: null },
  ],
  affected_room_ids: ["room-101", "room-102", "room-103"],
  affected_housekeeper_ids: ["hk-1", "hk-2"],
  replayed: false,
  ...over,
});

describe("parseBatchPublication", () => {
  it("reads a committed answer", () => {
    expect(parseBatchPublication(committed(), OP)).toEqual({
      operationId: OP,
      assignmentDate: DATE,
      replayed: false,
      counts: { total: 3, assign: 1, reassign: 1, remove: 1 },
      rooms: [
        { roomId: "room-101", roomNumber: "101", kind: "assign", previousAssignedTo: null, assignedTo: "hk-1" },
        { roomId: "room-102", roomNumber: "102", kind: "reassign", previousAssignedTo: "hk-2", assignedTo: "hk-1" },
        { roomId: "room-103", roomNumber: "103", kind: "remove", previousAssignedTo: "hk-2", assignedTo: null },
      ],
      affectedRoomIds: ["room-101", "room-102", "room-103"],
      affectedHousekeeperIds: ["hk-1", "hk-2"],
    });
    expect(parseBatchPublication(committed({ replayed: true }), OP)?.replayed).toBe(true);
  });

  it.each([
    ["not an object", "ok"],
    ["null", null],
    ["a pending status", committed({ status: "pending" })],
    ["no status", committed({ status: undefined })],
    ["another operation's answer", committed({ operation_id: "11111111-1111-4111-8111-111111111111" })],
    ["no operation id", committed({ operation_id: undefined })],
    ["no date", committed({ assignment_date: undefined })],
    ["counts that disagree with the rooms", committed({ counts: { total: 3, assign: 2, reassign: 1, remove: 0 } })],
    ["a total that is not the room count", committed({ counts: { total: 4, assign: 1, reassign: 1, remove: 1 } })],
    ["a negative count", committed({ counts: { total: 3, assign: -1, reassign: 3, remove: 1 } })],
    ["a fractional count", committed({ counts: { total: 3, assign: 1.5, reassign: 1, remove: 1 } })],
    ["no rooms", committed({ rooms: [], counts: { total: 0, assign: 0, reassign: 0, remove: 0 } })],
    ["a room of an unknown kind", committed({ rooms: [{ room_id: "room-101", kind: "swap" }], counts: { total: 1, assign: 0, reassign: 0, remove: 0 } })],
    ["a room without an id", committed({ rooms: [{ kind: "assign" }], counts: { total: 1, assign: 1, reassign: 0, remove: 0 } })],
    ["no affected rooms", committed({ affected_room_ids: undefined })],
    ["affected people that are not ids", committed({ affected_housekeeper_ids: [1, 2] })],
  ])("is null for %s (never shown as published)", (_name, raw) => {
    expect(parseBatchPublication(raw, OP)).toBeNull();
  });

  it("does not need an expected operation id, but enforces one when given", () => {
    expect(parseBatchPublication(committed())).not.toBeNull();
    expect(parseBatchPublication(committed(), "other")).toBeNull();
  });
});

describe("matchesRequest", () => {
  const publication = parseBatchPublication(committed(), OP)!;
  const asked = [change(), reassign(), removal()];

  it("accepts the answer to exactly what was asked", () => {
    expect(matchesRequest(publication, asked)).toBe(true);
  });
  it.each([
    ["a missing room", asked.slice(0, 2)],
    ["a different target", [change({ toUserId: "hk-3" }), reassign(), removal()]],
    ["a different kind", [change(), reassign({ kind: "assign", fromUserId: null, expected: { expect_unassigned: true } }), removal()]],
    ["a different previous owner", [change(), reassign({ fromUserId: "hk-9", expected: { expected_assigned_to: "hk-9" } }), removal()]],
    ["an extra room", [...asked, change({ roomId: "room-999", roomNumber: "999" })]],
  ])("rejects %s", (_name, changes) => {
    expect(matchesRequest(publication, changes)).toBe(false);
  });
});

describe("classifyBatchFailure: what a thrown error proves", () => {
  const api = (status: number, detail: unknown, code?: string) => Object.assign(new Error("x"), { status, detail, code });

  it("treats an error with no HTTP status as UNKNOWN: the write may have been applied", () => {
    expect(classifyBatchFailure(new Error("Network request failed"))).toEqual({ kind: "unknown" });
    expect(classifyBatchFailure(Object.assign(new Error("timeout"), { name: "AbortError" }))).toEqual({ kind: "unknown" });
    expect(classifyBatchFailure(null)).toEqual({ kind: "unknown" });
    expect(classifyBatchFailure("boom")).toEqual({ kind: "unknown" });
  });

  it("treats a lapsed session, which fails before anything is sent, as not applied", () => {
    expect(classifyBatchFailure(new Error("Session expired"))).toEqual({ kind: "not_applied", reason: "session", conflicts: [] });
  });

  it("reads a conflict with its rooms", () => {
    const failure = classifyBatchFailure(
      api(409, {
        code: "assignment_batch_conflict",
        applied: false,
        conflicts: [
          { room_id: "room-101", room_number: "101", code: "assignment_changed", current_assigned_to: "hk-9" },
          { room_id: "room-102", code: "room_not_assignable" },
          { room_id: "room-103", code: "room_blocked", blocks: ["dnd", "bogus"] },
          { room_id: "room-104", code: "assignment_changed", current_assigned_to: null },
          { room_id: "room-105", code: "mystery" },
          { code: "room_not_found" },
        ],
      }),
    );
    expect(failure).toEqual({
      kind: "not_applied",
      reason: "conflict",
      conflicts: [
        { roomId: "room-101", roomNumber: "101", code: "assignment_changed", currentOwnerId: "hk-9", blocks: [] },
        { roomId: "room-102", roomNumber: null, code: "room_not_assignable", currentOwnerId: undefined, blocks: [] },
        { roomId: "room-103", roomNumber: null, code: "room_blocked", currentOwnerId: undefined, blocks: ["dnd"] },
        { roomId: "room-104", roomNumber: null, code: "assignment_changed", currentOwnerId: null, blocks: [] },
      ],
    });
  });

  it.each([
    [409, { code: "operation_id_reused" }, "operation_reused"],
    [409, { code: "date_mismatch" }, "date_changed"],
    [409, "plain string", "conflict"],
    [422, { code: "invalid_request" }, "invalid_request"],
    [401, undefined, "forbidden"],
    [403, "Role 'housekeeper' is not authorized", "forbidden"],
    [404, "Not Found", "unavailable"],
    [429, "slow down", "invalid_request"],
    [500, { code: "publish_failed", applied: false }, "database"],
  ])("HTTP %s %j is definitely not applied (%s)", (status, detail, reason) => {
    expect(classifyBatchFailure(api(status as number, detail))).toMatchObject({ kind: "not_applied", reason });
  });

  it.each([
    [500, undefined],
    [500, { code: "publish_unverified" }],
    [500, { code: "publish_failed", applied: true }],
    [502, undefined],
    [503, { applied: false }],
    [504, "Gateway Timeout"],
  ])("HTTP %s %j is UNKNOWN: it may have committed behind the proxy", (status, detail) => {
    expect(classifyBatchFailure(api(status as number, detail))).toEqual({ kind: "unknown" });
  });
});

describe("readBatchCheck", () => {
  it("reads a committed operation", () => {
    const check = readBatchCheck({ status: "committed", result: committed({ replayed: true }) }, OP);
    expect(check).toMatchObject({ kind: "committed", publication: { operationId: OP, replayed: true, counts: { total: 3 } } });
  });
  it("reads not_found as 'not committed as of this read'", () => {
    expect(readBatchCheck({ status: "not_found" }, OP)).toEqual({ kind: "not_found" });
  });
  it.each([["garbage", "x"], ["null", null], ["unknown status", { status: "maybe" }], ["committed without a result", { status: "committed" }], ["another operation's result", { status: "committed", result: committed({ operation_id: "other" }) }]])(
    "is unreadable for %s, never a guess",
    (_name, raw) => {
      expect(readBatchCheck(raw, OP)).toEqual({ kind: "unreadable" });
    },
  );
});

describe("newOperationId", () => {
  it("is a version-4 uuid and different every time", () => {
    const a = newOperationId();
    const b = newOperationId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
  it("still makes a v4 uuid where the runtime has no crypto.randomUUID", () => {
    const g = globalThis as { crypto?: unknown };
    const saved = g.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(newOperationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: saved, configurable: true });
    }
  });
});
