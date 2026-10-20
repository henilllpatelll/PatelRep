import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoardVerified: jest.fn(),
  saveAssignments: jest.fn(),
  removeAssignmentByPlan: jest.fn(),
}));
jest.mock("@/lib/housekeeping/estimateTable", () => ({ lookupLearned: jest.fn(() => null) }));

import { fetchBoardVerified, removeAssignmentByPlan, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import { composeRoomBoard, evaluateMutationGate, type RoomBoardModel } from "@/lib/housekeeping/roomBoardState";
import { useRoomAssignment, type UseRoomAssignmentInput } from "@/lib/housekeeping/useRoomAssignment";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

const readBoard = fetchBoardVerified as jest.Mock;
const save = saveAssignments as jest.Mock;
const remove = removeAssignmentByPlan as jest.Mock;

const STAFF = [
  { userId: "hk-1", name: "Ana Torres", role: "housekeeper" },
  { userId: "hk-2", name: "Ben Ortiz", role: "housekeeper" },
];

function modelOf(rows: BoardRoomRaw[], now = NOW): RoomBoardModel {
  const forDate = composeRoomBoard({ board: { status: "loading" }, staff: { status: "loading" }, roster: { status: "loading" }, lateCheckouts: { status: "loading" } }, { now, timeZone: ZONE }).hotelDate;
  return composeRoomBoard(
    {
      board: { status: "available", data: normalizeBoardRecords(rows, forDate), fetchedAt: now },
      staff: { status: "available", data: STAFF, fetchedAt: now },
      roster: { status: "available", data: [{ userId: "hk-1", availability: "on_shift", startedAt: null, onBreakSince: null }, { userId: "hk-2", availability: "on_shift", startedAt: null, onBreakSince: null }], fetchedAt: now },
      lateCheckouts: { status: "available", data: [], fetchedAt: now },
    },
    { now, timeZone: ZONE },
  );
}

const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function setup(rows: BoardRoomRaw[], overrides: Partial<UseRoomAssignmentInput> = {}) {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const initial: UseRoomAssignmentInput = {
    model: modelOf(rows),
    gate: { allowed: true, blockedBy: null },
    isOnline: true,
    refresh,
    scopeKey: "h1:sup-1",
    t,
    toast,
    settle: async () => undefined,
    ...overrides,
  };
  const hook = renderHook((props: UseRoomAssignmentInput) => useRoomAssignment(props), { initialProps: initial });
  return { ...hook, refresh, props: initial, update: (next: Partial<UseRoomAssignmentInput>) => hook.rerender({ ...initial, ...next }) };
}

const reviewing = (hook: ReturnType<typeof setup>, roomId = "room-101", userId = "hk-2") => {
  act(() => hook.result.current.openAssign(roomId));
  act(() => hook.result.current.select(userId));
  act(() => hook.result.current.toReview());
};

beforeEach(() => {
  jest.clearAllMocks();
  readBoard.mockImplementation(async () => [rawRoom("101", "DIRTY")]);
  save.mockResolvedValue(undefined);
  remove.mockResolvedValue(true);
});

describe("useRoomAssignment — guards", () => {
  it("opens only for a room that is on the verified board", () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    act(() => hook.result.current.openAssign("room-999"));
    expect(hook.result.current.flow).toBeNull();
    act(() => hook.result.current.openAssign("room-101"));
    expect(hook.result.current.flow?.step).toBe("picker");
    expect(hook.result.current.intent).toBe("assign");
  });

  it("a room that is being cleaned is blocked in the live view: the confirm is off and the write is refused", async () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    hook.update({ model: modelOf([rawRoom("101", "IN_PROGRESS")]) });
    expect(hook.result.current.block).toBe("in_progress");
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => hook.result.current.confirm());
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("in_progress");
  });

  it("a paused board (stale / offline) refuses the write", async () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    hook.update({ gate: evaluateMutationGate({ kind: "stale", reason: "age", verifiedAt: NOW, failure: null }, true) });
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => hook.result.current.confirm());
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("paused");
  });

  it("selecting someone then moving to review keeps exactly that person", () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook, "room-101", "hk-1");
    expect(hook.result.current.review?.employeeId).toBe("hk-1");
    expect(hook.result.current.review?.employeeName).toBe("Ana Torres");
  });
});

describe("useRoomAssignment — hotel and day changes", () => {
  it("the hotel day rolling over closes the open workflow instead of writing for yesterday", async () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    const nextDay = NOW + 24 * 60 * 60_000;
    hook.update({ model: modelOf([rawRoom("101", "DIRTY")], nextDay) });
    expect(hook.result.current.flow).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("roomBoard.assign.scopeChanged");
    expect(save).not.toHaveBeenCalled();
  });

  it("switching property or person closes it", () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    hook.update({ scopeKey: "h2:sup-1" });
    expect(hook.result.current.flow).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("roomBoard.assign.scopeChanged");
  });

  it("a write that lands after the property changed announces nothing to the new property", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = hook.result.current.confirm();
    });
    hook.update({ scopeKey: "h2:sup-1" });
    await act(async () => {
      finish();
      await pending;
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("useRoomAssignment — outcomes", () => {
  it("an expired session is reported as such", async () => {
    save.mockRejectedValue(new Error("Session expired. Please log in again."));
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    await act(async () => hook.result.current.confirm());
    expect(hook.result.current.error).toBe("session");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a success is announced with the room and the person, and the workflow closes", async () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    await act(async () => hook.result.current.confirm());
    expect(toast.success).toHaveBeenCalledWith('roomBoard.assign.success.assign:{"room":"101","name":"Ben Ortiz"}');
    expect(hook.result.current.flow).toBeNull();
    expect(hook.refresh).toHaveBeenCalled();
  });

  it("the write carries what the supervisor reviewed so the server can refuse a stale one", async () => {
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    await act(async () => hook.result.current.confirm());
    expect(save).toHaveBeenCalledWith(expect.any(String), [
      expect.objectContaining({ room_id: "room-101", expect_unassigned: true }),
    ]);
  });

  it("the write is never sent while another is in flight, however often confirm is called", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const hook = setup([rawRoom("101", "DIRTY")]);
    reviewing(hook);
    await act(async () => {
      void hook.result.current.confirm();
      void hook.result.current.confirm();
      void hook.result.current.confirm();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.busy).toBe(true);
    // Closing / backing out mid-write is ignored.
    act(() => hook.result.current.close());
    act(() => hook.result.current.back());
    expect(hook.result.current.flow).not.toBeNull();
    await act(async () => finish());
    expect(hook.result.current.busy).toBe(false);
  });

  it("removal asks the server for the room's CURRENT plan, so a stale assignment id is never deleted", async () => {
    // The screen showed assignment as-old; the fresh read shows it was re-created as as-new.
    readBoard.mockImplementation(async () => [rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-new" })]);
    const hook = setup([rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-old" })]);
    act(() => hook.result.current.openRemove("room-101"));
    await act(async () => hook.result.current.confirm());
    expect(remove).toHaveBeenCalledWith({ kind: "assignment", assignmentId: "as-new" });
    expect(toast.success).toHaveBeenCalledWith('roomBoard.assign.success.remove:{"room":"101"}');
  });
});
