import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoardVerified: jest.fn(),
  saveAssignments: jest.fn(),
  removeAssignmentGuarded: jest.fn(),
}));

import { fetchBoardVerified, removeAssignmentGuarded, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { useAssignmentFlow, type UseAssignmentFlowInput } from "@/lib/housekeeping/useAssignmentFlow";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const readBoard = fetchBoardVerified as jest.Mock;
const save = saveAssignments as jest.Mock;
const remove = removeAssignmentGuarded as jest.Mock;
const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
const apiError = (status: number, code?: string) => Object.assign(new Error("x"), { status, ...(code ? { code } : {}) });

const everyone = rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);
const modelOf = (raw = hotelBoard()): AssignmentsModel => assignmentsOf({ raw, roster: everyone });

function setup(overrides: Partial<UseAssignmentFlowInput> = {}) {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const initial: UseAssignmentFlowInput = {
    model: modelOf(),
    gate: { allowed: true, blockedBy: null },
    isOnline: true,
    refresh,
    scopeKey: "h1:sup-1",
    t,
    toast,
    settle: async () => undefined,
    ...overrides,
  };
  const hook = renderHook((props: UseAssignmentFlowInput) => useAssignmentFlow(props), { initialProps: initial });
  return { ...hook, refresh, initial, update: (next: Partial<UseAssignmentFlowInput>) => hook.rerender({ ...initial, ...next }) };
}

const reviewing = (hook: ReturnType<typeof setup>, roomId = "room-101", userId = "hk-2") => {
  act(() => hook.result.current.openAssign(roomId));
  act(() => hook.result.current.select(userId));
  act(() => hook.result.current.toReview());
};

beforeEach(() => {
  jest.clearAllMocks();
  readBoard.mockImplementation(async () => hotelBoard());
  save.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

describe("useAssignmentFlow — guards", () => {
  it("opens only for a room on the verified board, and never writes on open or select", () => {
    const hook = setup();
    act(() => hook.result.current.openAssign("room-999"));
    expect(hook.result.current.flow).toBeNull();
    act(() => hook.result.current.openAssign("room-101"));
    expect(hook.result.current.flow?.step).toBe("picker");
    act(() => hook.result.current.select("hk-2"));
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.canContinue).toBe(true);
  });

  it("opens straight at the review for an employee-first start, but only for a valid person", () => {
    const hook = setup();
    act(() => hook.result.current.openAssign("room-101", { employeeId: "nobody" }));
    expect(hook.result.current.flow?.step).toBe("picker");
    act(() => hook.result.current.close());
    act(() => hook.result.current.openAssign("room-101", { employeeId: "hk-2" }));
    expect(hook.result.current.flow).toMatchObject({ step: "review", selectedId: "hk-2", reviewedOwnerId: null });
    expect(hook.result.current.review?.to.userId).toBe("hk-2");
  });

  it("another hotel or person closes the flow", () => {
    const hook = setup();
    reviewing(hook);
    hook.update({ scopeKey: "h2:sup-1" });
    expect(hook.result.current.flow).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("assignments.v2.assign.scopeChanged");
  });

  it("the next hotel day closes the flow, so a stale-date review is never written", () => {
    const hook = setup();
    reviewing(hook);
    expect(hook.result.current.flow?.hotelDate).toBe(HOTEL_DATE);
    const tomorrow = assignmentsOf({ raw: hotelBoard(), roster: everyone, boardDate: "2026-10-17" });
    hook.update({ model: { ...tomorrow, hotelDate: "2026-10-17" } });
    expect(hook.result.current.flow).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("assignments.v2.assign.scopeChanged");
    expect(save).not.toHaveBeenCalled();
  });

  it("a room that leaves the board closes the flow and says so", () => {
    const hook = setup();
    reviewing(hook);
    hook.update({ model: modelOf(hotelBoard().filter((room) => room.room_id !== "room-101")) });
    expect(hook.result.current.flow).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("assignments.v2.assign.roomGone");
  });

  it("stale or paused data blocks the write: Confirm is off and a forced call only reports 'paused'", async () => {
    const hook = setup({ gate: { allowed: false, blockedBy: "stale" } });
    reviewing(hook);
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => hook.result.current.confirm());
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("paused");
  });

  it("offline blocks the write the same way", async () => {
    const hook = setup({ isOnline: false });
    reviewing(hook);
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => hook.result.current.confirm());
    expect(save).not.toHaveBeenCalled();
  });

  it("Back goes review → picker → closed, and an unclear outcome ignores Back", async () => {
    const hook = setup();
    reviewing(hook);
    act(() => hook.result.current.back());
    expect(hook.result.current.flow?.step).toBe("picker");
    expect(hook.result.current.flow?.selectedId).toBe("hk-2");
    act(() => hook.result.current.back());
    expect(hook.result.current.flow).toBeNull();

    reviewing(hook);
    save.mockRejectedValueOnce(new Error("Network request failed"));
    readBoard.mockRejectedValue(new Error("Network request failed"));
    await act(async () => hook.result.current.confirm());
    expect(hook.result.current.flow?.outcome?.kind).toBe("unknown");
    act(() => hook.result.current.back());
    expect(hook.result.current.flow?.outcome?.kind).toBe("unknown");
  });
});

describe("useAssignmentFlow — writes", () => {
  it("sends one conditional item carrying the reviewed owner and the soft blocks acknowledged", async () => {
    const hook = setup({ model: modelOf([rawRoom("101", "DIRTY", { dnd_flag: true }), ...hotelBoard().slice(1)]) });
    reviewing(hook);
    expect(hook.result.current.review?.requiredAcks).toEqual(["dnd"]);
    expect(hook.result.current.canConfirm).toBe(false);
    act(() => hook.result.current.toggleAck("dnd"));
    expect(hook.result.current.canConfirm).toBe(true);
    await act(async () => hook.result.current.confirm());
    expect(save).toHaveBeenCalledWith(HOTEL_DATE, [{ room_id: "room-101", housekeeper_id: "hk-2", expect_unassigned: true, acknowledged_blocks: ["dnd"] }], false);
    expect(hook.result.current.flow?.outcome).toMatchObject({ kind: "applied", action: "assign" });
  });

  it("two confirms in one tick write once", async () => {
    const hook = setup();
    reviewing(hook);
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => {
      void hook.result.current.confirm();
      void hook.result.current.confirm();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.busy).toBe(true);
    await act(async () => finish());
    expect(hook.result.current.busy).toBe(false);
  });

  it("removal asserts the reviewed owner and keeps the status untouched", async () => {
    const hook = setup();
    act(() => hook.result.current.openRemove("room-102"));
    expect(hook.result.current.removal).toMatchObject({ roomNumber: "102", source: "dated", owner: { userId: "hk-1" } });
    await act(async () => hook.result.current.confirm());
    expect(remove).toHaveBeenCalledWith(HOTEL_DATE, "room-102", "hk-1");
    expect(hook.result.current.flow?.outcome).toMatchObject({ kind: "applied", action: "remove" });
  });

  it("removal of a room that is being cleaned cannot be confirmed", async () => {
    const hook = setup();
    act(() => hook.result.current.openRemove("room-104"));
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => hook.result.current.confirm());
    expect(remove).not.toHaveBeenCalled();
  });

  it("a 409 never reads as 'saved' and is never retried", async () => {
    const hook = setup();
    reviewing(hook);
    save.mockRejectedValueOnce(apiError(409, "room_not_assignable"));
    await act(async () => hook.result.current.confirm());
    expect(hook.result.current.flow?.outcome).toEqual({ kind: "conflict", reason: "not_assignable" });
    expect(hook.result.current.canConfirm).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a read-back that proves the write applied reports it; one that proves it did not reports a failure", async () => {
    const applied = hotelBoard();
    applied[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-101" });
    const first = setup();
    reviewing(first);
    save.mockRejectedValueOnce(new Error("Network request failed"));
    readBoard.mockResolvedValue(applied);
    await act(async () => first.result.current.confirm());
    expect(first.result.current.flow?.outcome).toMatchObject({ kind: "applied" });
    expect(save).toHaveBeenCalledTimes(1);

    const second = setup();
    reviewing(second);
    save.mockRejectedValueOnce(new Error("Network request failed"));
    readBoard.mockResolvedValue(hotelBoard());
    await act(async () => second.result.current.confirm());
    expect(second.result.current.flow?.outcome).toBeNull();
    expect(second.result.current.error).toBe("save_failed");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("Check result reads only: it can never call a write", async () => {
    const hook = setup();
    reviewing(hook);
    save.mockRejectedValueOnce(new Error("Network request failed"));
    readBoard.mockRejectedValue(new Error("offline"));
    await act(async () => hook.result.current.confirm());
    for (let i = 0; i < 3; i += 1) await act(async () => hook.result.current.checkResult());
    expect(save).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("still_unknown");
  });
});
