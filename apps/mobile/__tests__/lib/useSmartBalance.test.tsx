import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  requestSmartBalancePlan: jest.fn(),
  fetchAssignmentPreferences: jest.fn(),
}));

import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { DEFAULT_PROPERTY_PREFERENCES } from "@/lib/housekeeping/smartBalancePolicy";
import { useAssignmentDraft } from "@/lib/housekeeping/useAssignmentDraft";
import { useSmartBalance } from "@/lib/housekeeping/useSmartBalance";
import { toBatchRequest } from "@/lib/housekeeping/assignmentBatch";
import { draftChanges } from "@/lib/housekeeping/assignmentPlan";
import { bulkModel } from "../helpers/bulkFixtures";
import { SCOPE_KEY, answerFor, inputOf } from "../helpers/smartBalanceFixtures";

const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;

interface Props {
  model: AssignmentsModel;
  scopeKey: string | null;
  online: boolean;
  allowed: boolean;
}

/** The server's answer for the request the hook sends: 101 to hk-2, 102 to hk-3, the rest left out. */
function answering(body: ReturnType<typeof inputOf>["body"], model: AssignmentsModel) {
  const input = inputOf(model);
  const numbers = body.rooms.map((room) => room.room_number);
  const unallocated = numbers.filter((n) => n !== "101" && n !== "102").map((n) => [n, "insufficient_capacity"] as [string, "insufficient_capacity"]);
  const response = answerFor(input, { assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated });
  return {
    data: {
      read_only: true,
      plan_id: response.planId,
      date: response.date,
      scope: response.scope,
      generated_at: response.generatedAt,
      snapshot_verified_at: response.snapshotVerifiedAt,
      status: response.status,
      assignments: response.assignments,
      unallocated: response.unallocated,
      staff: response.staff,
      rejected_rooms: [],
      rejected_staff: [],
      assumptions: [],
      warnings: [],
    },
  };
}

function setup(initial: Partial<Props> = {}, overrides: { requestPlan?: jest.Mock } = {}) {
  const model = initial.model ?? bulkModel();
  const requestPlan = overrides.requestPlan ?? jest.fn(async (body) => answering(body, model));
  const showReview = jest.fn();
  const onAdded = jest.fn();
  const refresh = jest.fn().mockResolvedValue(undefined);
  const start: Props = { model, scopeKey: SCOPE_KEY, online: true, allowed: true, ...initial };
  const hook = renderHook(
    (props: Props) => {
      const draft = useAssignmentDraft({ model: props.model, scopeKey: props.scopeKey });
      const smart = useSmartBalance({
        model: props.model,
        gate: { allowed: props.allowed, blockedBy: props.allowed ? null : "stale" },
        isOnline: props.online,
        scopeKey: props.scopeKey,
        hotelId: "tenant-1",
        draft,
        selectedRoomIds: new Set(["room-101", "room-102"]),
        showReview,
        onAdded,
        refresh,
        t,
        toast,
        requestPlan,
        loadPreferences: async () => DEFAULT_PROPERTY_PREFERENCES,
        settle: async () => undefined,
      });
      return { draft, smart };
    },
    { initialProps: start },
  );
  return { ...hook, requestPlan, showReview, onAdded, refresh, update: (next: Partial<Props>) => hook.rerender({ ...start, ...next }) };
}

const open = async (hook: ReturnType<typeof setup>) => {
  act(() => hook.result.current.smart.open());
  await waitFor(() => expect(hook.result.current.smart.preferencesSource).toBe("property"));
};
const generate = async (hook: ReturnType<typeof setup>) => {
  await act(async () => {
    await hook.result.current.smart.generate();
  });
};

beforeEach(() => jest.clearAllMocks());

describe("setup", () => {
  it("opens on the setup sheet, reads the property's preferences as defaults, and requests nothing", async () => {
    const hook = setup();
    await open(hook);
    expect(hook.result.current.smart.panel).toBe("setup");
    expect(hook.result.current.smart.scope).toBe("unassigned");
    expect(hook.result.current.smart.setup).toMatchObject({ blocked: null, rooms: 7, people: 3, heldBack: 2, selectedCount: 2 });
    expect(hook.requestPlan).not.toHaveBeenCalled();
  });

  it("temporary choices change the request and are never written anywhere", async () => {
    const hook = setup();
    await open(hook);
    act(() => hook.result.current.smart.toggle("balanceWorkload"));
    await generate(hook);
    expect(hook.requestPlan.mock.calls[0][0].preferences.balance_workload).toBe(false);
  });

  it("explains why a plan cannot be made instead of generating one", async () => {
    const hook = setup({ online: false });
    await open(hook);
    expect(hook.result.current.smart.setup.blocked).toBe("offline");
    await generate(hook);
    expect(hook.requestPlan).not.toHaveBeenCalled();
    expect(hook.result.current.smart.generation).toEqual({ kind: "failed", failure: "offline" });
  });
});

describe("generating", () => {
  it("shows the preview and changes nothing on the board or in the draft", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    const { smart, draft } = hook.result.current;
    expect(smart.panel).toBe("preview");
    expect(smart.preview?.counts).toMatchObject({ planned: 2, newRooms: 2 });
    expect(draft.draft).toBeNull();
    expect(hook.showReview).not.toHaveBeenCalled();
  });

  it("is single-flight: a second tap while the request is out does nothing", async () => {
    let release: (value: unknown) => void = () => undefined;
    const requestPlan = jest.fn((_body: unknown) => new Promise((resolve) => (release = resolve)));
    const hook = setup({}, { requestPlan });
    await open(hook);
    await act(async () => {
      void hook.result.current.smart.generate();
      void hook.result.current.smart.generate();
    });
    expect(requestPlan).toHaveBeenCalledTimes(1);
    await act(async () => release(answering(requestPlan.mock.calls[0][0] as never, bulkModel())));
  });

  it("ignores an answer that arrives after the hotel was switched", async () => {
    let release: (value: unknown) => void = () => undefined;
    const requestPlan = jest.fn((_body: unknown) => new Promise((resolve) => (release = resolve)));
    const hook = setup({}, { requestPlan });
    await open(hook);
    await act(async () => {
      void hook.result.current.smart.generate();
    });
    hook.update({ scopeKey: "tenant-2:sup-1" });
    await act(async () => release(answering(requestPlan.mock.calls[0][0] as never, bulkModel())));
    expect(hook.result.current.smart.plan).toBeNull();
    expect(hook.result.current.smart.panel).toBeNull();
  });

  it.each([
    [{ status: 409 }, "day_changed"],
    [{ status: 403 }, "permission"],
    [{ status: 422 }, "invalid"],
    [{ status: 503 }, "unavailable"],
  ])("maps a failed request %j to %s and keeps no plan", async (error, failure) => {
    const { ApiError } = jest.requireActual("@/lib/api/client") as typeof import("@/lib/api/client");
    const requestPlan = jest.fn().mockRejectedValue(new ApiError("x", (error as { status: number }).status));
    const hook = setup({}, { requestPlan });
    await open(hook);
    await generate(hook);
    expect(hook.result.current.smart.generation).toEqual({ kind: "failed", failure });
    expect(hook.result.current.smart.plan).toBeNull();
  });

  it("an answer that is not the documented shape is 'unverified', never half shown", async () => {
    const hook = setup({}, { requestPlan: jest.fn().mockResolvedValue({ data: { read_only: false } }) });
    await open(hook);
    await generate(hook);
    expect(hook.result.current.smart.generation).toEqual({ kind: "failed", failure: "unverified" });
    expect(hook.result.current.smart.plan).toBeNull();
  });
});

describe("editing and adding to the draft", () => {
  it("edits only the local proposal, with an undo", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    act(() => {
      expect(hook.result.current.smart.move("room-101", "hk-3")).toBeNull();
    });
    expect(hook.result.current.smart.preview?.counts.edited).toBe(1);
    expect(hook.result.current.draft.draft).toBeNull();
    act(() => hook.result.current.smart.undo());
    expect(hook.result.current.smart.preview?.counts.edited).toBe(0);
  });

  it("adds the plan to the Phase 5 draft with the right provenance, then opens the review - and publishes nothing", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    act(() => void hook.result.current.smart.move("room-101", "hk-3"));
    let outcome = "";
    act(() => {
      outcome = hook.result.current.smart.addToDraft();
    });
    expect(outcome).toBe("added");
    const changes = draftChanges(hook.result.current.draft.draft!);
    expect(Object.fromEntries(changes.map((c) => [c.roomId, [c.toUserId, c.source]]))).toEqual({ "room-101": ["hk-3", "ai_editor"], "room-102": ["hk-3", "smart_balance"] });
    expect(hook.showReview).toHaveBeenCalledTimes(1);
    expect(hook.onAdded).toHaveBeenCalledWith(expect.arrayContaining(["room-101", "room-102"]));
    expect(hook.result.current.smart.plan).toBeNull();
    const request = toBatchRequest("op", "2026-10-16", changes);
    expect(request.ok && request.request.changes.map((c) => !!c.is_ai_suggested)).toEqual([false, true]);
  });

  it("will not add a stale plan, and says why", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    hook.update({ model: bulkModel() });
    // The same board again is fine...
    expect(hook.result.current.smart.stale).toEqual([]);
    // ...a board where a planned room got an owner is not.
    const { room, bulkBoard } = jest.requireActual("../helpers/bulkFixtures") as typeof import("../helpers/bulkFixtures");
    hook.update({ model: bulkModel({ raw: bulkBoard().map((raw) => (raw.room_id === "room-101" ? room("101", "DIRTY", { owner: "hk-1" }) : raw)) }) });
    expect(hook.result.current.smart.stale.map((reason) => reason.kind)).toContain("rooms_changed");
    let outcome = "";
    act(() => {
      outcome = hook.result.current.smart.addToDraft();
    });
    expect(outcome).toBe("stale");
    expect(hook.result.current.draft.draft).toBeNull();
  });

  it("is blocked offline or while the board is not live", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    hook.update({ online: false });
    expect(hook.result.current.smart.paused).toBe("offline");
    let outcome = "";
    act(() => {
      outcome = hook.result.current.smart.addToDraft();
    });
    expect(outcome).toBe("blocked");
  });

  it("asks before touching rooms already in the draft, and merge keeps the supervisor's own choice", async () => {
    const hook = setup();
    await open(hook);
    act(() => void hook.result.current.draft.stage({ "room-101": "hk-1" }, "bulk"));
    await generate(hook);
    expect(hook.result.current.smart.draftOverlap).toBe(1);
    let outcome = "";
    act(() => {
      outcome = hook.result.current.smart.addToDraft();
    });
    expect(outcome).toBe("needs_resolution");
    expect(hook.result.current.smart.panel).toBe("conflict");
    expect(hook.showReview).not.toHaveBeenCalled();
    act(() => {
      outcome = hook.result.current.smart.addToDraft("merge");
    });
    expect(outcome).toBe("added");
    const owners = Object.fromEntries(draftChanges(hook.result.current.draft.draft!).map((c) => [c.roomId, c.toUserId]));
    expect(owners).toEqual({ "room-101": "hk-1", "room-102": "hk-3" });
  });

  it("replace discards the old draft first", async () => {
    const hook = setup();
    await open(hook);
    act(() => void hook.result.current.draft.stage({ "room-101": "hk-1", "room-202": "hk-1" }, "bulk"));
    await generate(hook);
    act(() => void hook.result.current.smart.addToDraft("replace"));
    const owners = Object.fromEntries(draftChanges(hook.result.current.draft.draft!).map((c) => [c.roomId, c.toUserId]));
    expect(owners).toEqual({ "room-101": "hk-2", "room-102": "hk-3" });
  });
});

describe("leaving", () => {
  it("back hides the sheet and keeps the plan; discard throws it away", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    act(() => hook.result.current.smart.back());
    expect(hook.result.current.smart.panel).toBeNull();
    expect(hook.result.current.smart.plan).not.toBeNull();
    act(() => hook.result.current.smart.open());
    expect(hook.result.current.smart.panel).toBe("preview");
    act(() => hook.result.current.smart.requestDiscard());
    expect(hook.result.current.smart.plan).toBeNull();
  });

  it("discarding an edited plan asks first", async () => {
    const hook = setup();
    await open(hook);
    await generate(hook);
    act(() => void hook.result.current.smart.move("room-101", "hk-3"));
    act(() => hook.result.current.smart.requestDiscard());
    expect(hook.result.current.smart.panel).toBe("discard");
    expect(hook.result.current.smart.plan).not.toBeNull();
    act(() => hook.result.current.smart.confirmDiscard());
    expect(hook.result.current.smart.plan).toBeNull();
  });

  it("refresh and replan replaces the plan and keeps the setup choices", async () => {
    const hook = setup();
    await open(hook);
    act(() => hook.result.current.smart.toggle("minimizeReassignment"));
    await generate(hook);
    await act(async () => {
      await hook.result.current.smart.refreshAndReplan();
    });
    expect(hook.refresh).toHaveBeenCalled();
    expect(hook.requestPlan).toHaveBeenCalledTimes(2);
    expect(hook.requestPlan.mock.calls[1][0].preferences.minimize_reassignment).toBe(false);
  });
});
