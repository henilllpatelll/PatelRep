import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  publishAssignmentBatch: jest.fn(),
  fetchBatchPublication: jest.fn(),
}));

import { fetchBatchPublication, publishAssignmentBatch } from "@/lib/api/housekeepingSupervisor";
import { stageAllocation } from "@/lib/housekeeping/assignmentDraft";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { draftChanges, emptyDraft, type PlannedChange } from "@/lib/housekeeping/assignmentPlan";
import { readPending, writePending } from "@/lib/housekeeping/publishJournal";
import { useBatchPublication } from "@/lib/housekeeping/useBatchPublication";
import { HOTEL_DATE, NOW, bulkBoard, bulkModel, room } from "../helpers/bulkFixtures";

const publish = publishAssignmentBatch as jest.Mock;
const check = fetchBatchPublication as jest.Mock;
const SCOPE = "h1:sup-1";
const apiError = (status: number, detail?: unknown) => Object.assign(new Error("x"), { status, detail });

const model = bulkModel();
const changes = (): PlannedChange[] => draftChanges(stageAllocation(model, emptyDraft(SCOPE, HOTEL_DATE, NOW), { "room-101": "hk-2", "room-102": "hk-3" }, "bulk").draft);

/** What the server answers for a batch it committed. */
function committedFor(request: { operation_id: string; date: string; changes: { room_id: string; kind: string; housekeeper_id?: string; expected_assigned_to?: string }[] }, replayed = false) {
  const rooms = request.changes.map((c) => ({ room_id: c.room_id, room_number: c.room_id.replace("room-", ""), kind: c.kind, previous_assigned_to: c.expected_assigned_to ?? null, assigned_to: c.housekeeper_id ?? null }));
  return {
    operation_id: request.operation_id,
    status: "committed",
    assignment_date: request.date,
    counts: { total: rooms.length, assign: rooms.filter((r) => r.kind === "assign").length, reassign: 0, remove: 0 },
    rooms,
    affected_room_ids: rooms.map((r) => r.room_id),
    affected_housekeeper_ids: [...new Set(rooms.map((r) => r.assigned_to).filter(Boolean))],
    replayed,
  };
}
/** The board AFTER the commit, as a refresh would bring it. */
const afterCommit = (): AssignmentsModel => bulkModel({ raw: bulkBoard().map((raw) => (raw.room_id === "room-101" ? room("101", "DIRTY", { owner: "hk-2" }) : raw.room_id === "room-102" ? room("102", "DIRTY", { owner: "hk-3" }) : raw)) });

interface Props {
  model: AssignmentsModel;
  allowed: boolean;
  online: boolean;
  scopeKey: string | null;
}

function setup(overrides: Partial<Props> = {}, refresh: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  const onCommitted = jest.fn();
  const initial: Props = { model, allowed: true, online: true, scopeKey: SCOPE, ...overrides };
  const render = (props: Props) => useBatchPublication({ model: props.model, gate: { allowed: props.allowed, blockedBy: props.allowed ? null : "stale" }, isOnline: props.online, refresh, scopeKey: props.scopeKey, onCommitted, settle: async () => undefined });
  const hook = renderHook((props: Props) => render(props), { initialProps: initial });
  return { ...hook, refresh, onCommitted, update: (next: Partial<Props>) => hook.rerender({ ...initial, ...next }) };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  check.mockResolvedValue({ status: "not_found" });
});

describe("a confirmed publication", () => {
  it("reports the SERVER's counts, clears the journal, and tells the draft once", async () => {
    publish.mockImplementation(async (request) => committedFor(request));
    const hook = setup();
    let refusal: unknown = "unset";
    await act(async () => {
      refusal = await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(refusal).toBeNull();
    expect(hook.result.current.state).toMatchObject({ kind: "committed", publication: { counts: { total: 2, assign: 2 }, replayed: false }, refresh: "failed" });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(hook.onCommitted).toHaveBeenCalledTimes(1);
    expect(await readPending(SCOPE)).toBeNull();
    expect(publish.mock.calls[0][0]).toMatchObject({ date: HOTEL_DATE, changes: [{ room_id: "room-101", kind: "assign", housekeeper_id: "hk-2", expect_unassigned: true }, { room_id: "room-102", kind: "assign", housekeeper_id: "hk-3", expect_unassigned: true }] });
  });

  it("is 'refreshed' once the board shows the new owners, and a failed refresh is reported separately", async () => {
    publish.mockImplementation(async (request) => committedFor(request));
    const hook = setup({}, jest.fn().mockResolvedValue(undefined));
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(hook.result.current.state).toMatchObject({ kind: "committed", refresh: "failed" }); // the model has not moved
    // The next snapshot arrives carrying the new owners.
    publish.mockClear();
    const caught = setup({ model: afterCommit() }, jest.fn().mockResolvedValue(undefined));
    publish.mockImplementation(async (request) => committedFor(request));
    await act(async () => {
      await caught.result.current.publish(changes(), HOTEL_DATE);
    });
    // `changes()` were planned against the old board, but the result is judged against the NEW model.
    expect(caught.result.current.state).toMatchObject({ kind: "committed", refresh: "ok" });
    const failing = setup({}, jest.fn().mockRejectedValue(new Error("offline")));
    await act(async () => {
      await failing.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(failing.result.current.state).toMatchObject({ kind: "committed", refresh: "failed" });
  });

  it("a replayed answer is still a confirmation of the same operation", async () => {
    publish.mockImplementation(async (request) => committedFor(request, true));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(hook.result.current.state).toMatchObject({ kind: "committed", publication: { replayed: true } });
  });
});

describe("nothing is sent when it should not be", () => {
  it.each([
    ["the board is not verified", { allowed: false }],
    ["the phone is offline", { online: false }],
  ])("%s", async (_name, overrides) => {
    const hook = setup(overrides);
    let refusal: unknown;
    await act(async () => {
      refusal = await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(refusal).toBe("paused");
    expect(publish).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({ kind: "idle" });
    expect(await readPending(SCOPE)).toBeNull();
  });

  it("refuses an empty draft and a draft that carries a room acknowledgement", async () => {
    const hook = setup();
    await act(async () => {
      expect(await hook.result.current.publish([], HOTEL_DATE)).toBe("empty");
      expect(await hook.result.current.publish(changes().map((c) => ({ ...c, acknowledged: ["dnd" as const] })), HOTEL_DATE)).toBe("acknowledgement_not_allowed");
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("two presses in the same tick send ONE request", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    publish.mockImplementation((request) => gate.then(() => committedFor(request)));
    const hook = setup();
    let second: unknown;
    let first: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = hook.result.current.publish(changes(), HOTEL_DATE);
      second = await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(second).toBe("busy");
    expect(hook.result.current.working).toBe(true);
    await act(async () => {
      open();
      await first;
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.kind).toBe("committed");
  });
});

describe("a refusal from the server: nothing was written", () => {
  it("keeps everything for correction, clears the journal, and the next attempt is a NEW operation", async () => {
    publish.mockRejectedValueOnce(
      apiError(409, { code: "assignment_batch_conflict", applied: false, conflicts: [{ room_id: "room-101", room_number: "101", code: "assignment_changed", current_assigned_to: "hk-3" }] }),
    );
    const refresh = jest.fn().mockResolvedValue(undefined);
    const hook = setup({}, refresh);
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(hook.result.current.state).toMatchObject({ kind: "rejected", failure: { reason: "conflict" }, conflicts: [{ roomId: "room-101", code: "assignment_changed", currentOwnerId: "hk-3" }] });
    expect(refresh).toHaveBeenCalled(); // read-only: so the conflict view shows who has the room now
    expect(hook.onCommitted).not.toHaveBeenCalled();
    expect(await readPending(SCOPE)).toBeNull();

    publish.mockImplementation(async (request) => committedFor(request));
    await act(async () => {
      hook.result.current.dismiss();
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(publish.mock.calls[1][0].operation_id).not.toBe(publish.mock.calls[0][0].operation_id);
    expect(hook.result.current.state.kind).toBe("committed");
  });

  it.each([[422], [403], [404], [429]])("HTTP %s is a definite refusal", async (status) => {
    publish.mockRejectedValueOnce(apiError(status));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(hook.result.current.state.kind).toBe("rejected");
    expect(check).not.toHaveBeenCalled();
  });

  it("a database failure that rolled back is a refusal too", async () => {
    publish.mockRejectedValueOnce(apiError(500, { code: "publish_failed", applied: false }));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(hook.result.current.state).toMatchObject({ kind: "rejected", failure: { reason: "database" } });
  });
});

describe("an unclear outcome", () => {
  it("is read back (read-only), never retried blindly, and a commit it finds is shown as published", async () => {
    let asked: Parameters<typeof committedFor>[0] | null = null;
    publish.mockImplementation(async (request) => {
      asked = request;
      throw new Error("Network request failed");
    });
    check.mockImplementation(async () => ({ status: "committed", result: committedFor(asked!, true) }));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state.kind).toBe("committed"));
    expect(publish).toHaveBeenCalledTimes(1); // no second write
    expect(check).toHaveBeenCalledWith(asked!.operation_id);
    expect(hook.result.current.state).toMatchObject({ publication: { counts: { total: 2 } } });
    expect(hook.onCommitted).toHaveBeenCalledTimes(1);
    expect(await readPending(SCOPE)).toBeNull();
  });

  it("keeps the journal and stays unknown when the server cannot be asked", async () => {
    publish.mockRejectedValue(Object.assign(new Error("timeout"), { name: "AbortError" }));
    check.mockRejectedValue(new Error("offline"));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ kind: "unknown", check: "failed", checking: false }));
    expect(await readPending(SCOPE)).toMatchObject({ operationId: publish.mock.calls[0][0].operation_id, hotelDate: HOTEL_DATE, changeCount: 2 });
    expect(hook.result.current.working).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("will not start a DIFFERENT publication while unresolved, and ignores a stray dismiss", async () => {
    publish.mockRejectedValue(new Error("Network request failed"));
    check.mockRejectedValue(new Error("offline"));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ kind: "unknown", check: "failed" }));
    let refusal: unknown;
    await act(async () => {
      refusal = await hook.result.current.publish(changes().slice(0, 1), HOTEL_DATE);
      hook.result.current.dismiss();
    });
    expect(refusal).toBe("unresolved");
    expect(hook.result.current.state.kind).toBe("unknown");
    expect(hook.result.current.lockedToOperation).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("'not published yet' sends the SAME operation again: same id, same body", async () => {
    publish.mockRejectedValueOnce(new Error("Network request failed"));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ kind: "unknown", check: "not_found" }));
    publish.mockImplementation(async (request) => committedFor(request));
    await act(async () => {
      expect(await hook.result.current.sendAgain()).toBeNull();
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0]).toEqual(publish.mock.calls[0][0]);
    expect(hook.result.current.state.kind).toBe("committed");
  });

  it("a 200 that is not a committed answer for this request is NOT success", async () => {
    publish.mockResolvedValueOnce({ status: "pending" });
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state.kind).toBe("unknown"));
    expect(hook.onCommitted).not.toHaveBeenCalled();
  });

  it("a committed answer for DIFFERENT rooms is not success either", async () => {
    publish.mockImplementationOnce(async (request) => committedFor({ ...request, changes: request.changes.slice(0, 1) }));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state.kind).toBe("unknown"));
    expect(hook.onCommitted).not.toHaveBeenCalled();
  });

  it("a check that finds a commit for different rooms than we hold is not trusted", async () => {
    publish.mockRejectedValueOnce(new Error("Network request failed"));
    check.mockImplementation(async () => ({ status: "committed", result: committedFor({ operation_id: publish.mock.calls[0][0].operation_id, date: HOTEL_DATE, changes: [{ room_id: "room-999", kind: "assign", housekeeper_id: "hk-1" }] }) }));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ kind: "unknown", check: "unreadable" }));
  });
});

describe("after the app restarts mid-publication", () => {
  it("finds the journal, asks the server, and shows the committed result", async () => {
    await writePending({ operationId: "9b1d0000-0000-4000-8000-000000000001", scopeKey: SCOPE, hotelDate: HOTEL_DATE, changeCount: 2, startedAt: NOW });
    check.mockResolvedValue({
      status: "committed",
      result: committedFor({ operation_id: "9b1d0000-0000-4000-8000-000000000001", date: HOTEL_DATE, changes: [{ room_id: "room-101", kind: "assign", housekeeper_id: "hk-2" }, { room_id: "room-102", kind: "assign", housekeeper_id: "hk-3" }] }, true),
    });
    const hook = setup();
    await waitFor(() => expect(hook.result.current.state.kind).toBe("committed"));
    expect(check).toHaveBeenCalledWith("9b1d0000-0000-4000-8000-000000000001");
    expect(publish).not.toHaveBeenCalled();
    expect(await readPending(SCOPE)).toBeNull();
  });

  it("with nothing found it says 'not published yet' and never claims it was applied", async () => {
    await writePending({ operationId: "9b1d0000-0000-4000-8000-000000000002", scopeKey: SCOPE, hotelDate: HOTEL_DATE, changeCount: 3, startedAt: NOW });
    const hook = setup();
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ kind: "unknown", recovered: true, check: "not_found", changeCount: 3 }));
    expect(publish).not.toHaveBeenCalled();
    let refusal: unknown;
    await act(async () => {
      refusal = await hook.result.current.sendAgain(); // no changes are held after a restart: nothing can be re-sent
    });
    expect(refusal).toBe("unresolved");
  });

  it("another person on the same phone never sees it", async () => {
    await writePending({ operationId: "9b1d0000-0000-4000-8000-000000000003", scopeKey: SCOPE, hotelDate: HOTEL_DATE, changeCount: 2, startedAt: NOW });
    const hook = setup({ scopeKey: "h2:sup-9" });
    await act(async () => undefined);
    expect(hook.result.current.state.kind).toBe("idle");
    expect(check).not.toHaveBeenCalled();
  });

  it("a person switching hotels drops the previous publication state", async () => {
    publish.mockImplementation(async (request) => committedFor(request));
    const hook = setup();
    await act(async () => {
      await hook.result.current.publish(changes(), HOTEL_DATE);
    });
    expect(hook.result.current.state.kind).toBe("committed");
    hook.update({ scopeKey: "h2:sup-1" });
    expect(hook.result.current.state.kind).toBe("idle");
  });
});
