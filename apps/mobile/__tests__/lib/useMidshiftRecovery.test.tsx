import { act, renderHook } from "@testing-library/react-native";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { draftChanges } from "@/lib/housekeeping/assignmentPlan";
import { useAssignmentDraft } from "@/lib/housekeeping/useAssignmentDraft";
import { useMidshiftRecovery, type MidshiftClosed } from "@/lib/housekeeping/useMidshiftRecovery";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { idsOf, midshiftBoard, midshiftModel } from "../helpers/midshiftFixtures";

const SCOPE = "h1:sup-1";
const MOVABLE = ["301", "302", "303", "304", "305", "306"];
const toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;

interface Props {
  model: AssignmentsModel;
  scopeKey: string | null;
  online: boolean;
  allowed: boolean;
}

function setup(initial: Partial<Props> = {}) {
  const showReview = jest.fn();
  const refresh = jest.fn().mockResolvedValue(undefined);
  const closed: [string, MidshiftClosed][] = [];
  const start: Props = { model: midshiftModel(), scopeKey: SCOPE, online: true, allowed: true, ...initial };
  const hook = renderHook(
    (props: Props) => {
      const draft = useAssignmentDraft({ model: props.model, scopeKey: props.scopeKey });
      const midshift = useMidshiftRecovery({
        model: props.model,
        gate: { allowed: props.allowed, blockedBy: props.allowed ? null : "stale" },
        isOnline: props.online,
        scopeKey: props.scopeKey,
        draft,
        showReview,
        refresh,
        t,
        toast,
        settle: async () => undefined,
        onClosed: (userId, outcome) => closed.push([userId, outcome]),
      });
      return { draft, midshift };
    },
    { initialProps: start },
  );
  return { ...hook, showReview, refresh, closed, start };
}

const toPreview = (hook: ReturnType<typeof setup>) => {
  act(() => hook.result.current.midshift.open("hk-1"));
  act(() => hook.result.current.midshift.next());
  act(() => hook.result.current.midshift.next());
};

beforeEach(() => jest.clearAllMocks());

describe("opening", () => {
  it("selects the whole unstarted list when the shift ended, and nothing else", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    const { midshift } = hook.result.current;
    expect(midshift.userId).toBe("hk-1");
    expect(midshift.step).toBe("select");
    expect([...midshift.selected].sort()).toEqual(idsOf(MOVABLE));
    expect(midshift.reason).toBeNull();
  });

  it("does not open for a person who is not on the verified board", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("nobody"));
    expect(hook.result.current.midshift.userId).toBeNull();
  });

  it("changes no assignment and stages nothing while the supervisor is only looking", () => {
    const hook = setup();
    toPreview(hook);
    expect(hook.result.current.midshift.step).toBe("preview");
    expect(hook.result.current.draft.draft).toBeNull();
    expect(hook.showReview).not.toHaveBeenCalled();
  });
});

describe("selecting", () => {
  it("refuses a protected room and keeps the selection", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    let refusal: unknown;
    act(() => {
      refusal = hook.result.current.midshift.toggleRoom("room-307");
    });
    expect(refusal).toBe("not_movable");
    expect(hook.result.current.midshift.selected.has("room-307")).toBe(false);
  });

  it("can't go on with nothing selected", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    act(() => hook.result.current.midshift.clearSelection());
    expect(hook.result.current.midshift.blocked).toBe("nothing_selected");
    act(() => hook.result.current.midshift.next());
    expect(hook.result.current.midshift.step).toBe("select");
  });
});

describe("the review", () => {
  it("builds a before/after plan across the verified team", () => {
    const hook = setup();
    toPreview(hook);
    const { plan } = hook.result.current.midshift;
    expect(plan?.empty).toBe(false);
    expect(Object.keys(plan?.assignments ?? {})).toHaveLength(6);
    expect(plan?.review?.employees.find((employee) => employee.userId === "hk-1")?.released).toHaveLength(6);
  });

  it("taking a room out recalculates both sides", () => {
    const hook = setup();
    toPreview(hook);
    const before = hook.result.current.midshift.plan?.review?.employees.find((employee) => employee.userId === "hk-1")?.proposed.minutes.minutes;
    act(() => hook.result.current.midshift.takeOut("room-301"));
    const after = hook.result.current.midshift.plan?.review?.employees.find((employee) => employee.userId === "hk-1")?.proposed.minutes.minutes;
    expect(Object.keys(hook.result.current.midshift.plan?.assignments ?? {})).not.toContain("room-301");
    expect(after).toBe((before ?? 0) + 30);
  });

  it("moving a room to someone else is kept as the supervisor's choice", () => {
    const hook = setup();
    toPreview(hook);
    const chosen = hook.result.current.midshift.plan?.assignments["room-301"];
    const other = chosen === "hk-2" ? "hk-3" : "hk-2";
    act(() => hook.result.current.midshift.moveRoom("room-301", other));
    expect(hook.result.current.midshift.plan?.assignments["room-301"]).toBe(other);
  });

  it("going back to the selection to add a room keeps the rest of the plan", () => {
    const hook = setup();
    toPreview(hook);
    act(() => hook.result.current.midshift.editSelection());
    expect(hook.result.current.midshift.step).toBe("select");
    act(() => hook.result.current.midshift.toggleRoom("room-301"));
    expect(hook.result.current.midshift.selected.has("room-301")).toBe(false);
    act(() => hook.result.current.midshift.next());
    act(() => hook.result.current.midshift.next());
    expect(Object.keys(hook.result.current.midshift.plan?.assignments ?? {})).toHaveLength(5);
  });

  it("with nobody verified on shift it says so and will not advance", () => {
    const hook = setup({ model: midshiftModel({ roster: rosterOf([rosterRow("hk-1", "ended")]) }) });
    act(() => hook.result.current.midshift.open("hk-1"));
    act(() => hook.result.current.midshift.next());
    expect(hook.result.current.midshift.step).toBe("destination");
    expect(hook.result.current.midshift.teamIds).toEqual([]);
    expect(hook.result.current.midshift.blocked).toBe("no_destination");
    act(() => hook.result.current.midshift.next());
    expect(hook.result.current.midshift.step).toBe("destination");
  });

  it("a specific housekeeper is never pre-chosen", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    act(() => hook.result.current.midshift.next());
    act(() => hook.result.current.midshift.setMode("person"));
    expect(hook.result.current.midshift.destinationId).toBeNull();
    expect(hook.result.current.midshift.blocked).toBe("no_destination");
    act(() => hook.result.current.midshift.chooseDestination("hk-3"));
    expect(hook.result.current.midshift.blocked).toBeNull();
    expect(new Set(Object.values(hook.result.current.midshift.plan?.assignments ?? {}))).toEqual(new Set(["hk-3"]));
  });
});

describe("connectivity", () => {
  it("offline blocks going on and adding to the draft", () => {
    const hook = setup({ online: false });
    act(() => hook.result.current.midshift.open("hk-1"));
    expect(hook.result.current.midshift.paused).toBe("offline");
    expect(hook.result.current.midshift.blocked).toBe("paused");
    act(() => hook.result.current.midshift.next());
    expect(hook.result.current.midshift.step).toBe("select");
  });

  it("losing connection on the review blocks adding, and nothing is staged", () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, online: false });
    let outcome: unknown;
    act(() => {
      outcome = hook.result.current.midshift.addToDraft();
    });
    expect(outcome).toBe("blocked");
    expect(hook.result.current.draft.draft).toBeNull();
  });

  it("a board that is no longer live blocks adding", () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, allowed: false });
    expect(hook.result.current.midshift.paused).toBe("not_live");
  });
});

describe("the board moves while the sheet is open", () => {
  const board = (change: (raw: ReturnType<typeof midshiftBoard>[number]) => ReturnType<typeof midshiftBoard>[number]) =>
    assignmentsOf({ raw: midshiftBoard().map(change), roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]) });

  it("a room that started cleaning blocks the plan until the supervisor reviews it", () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, model: board((raw) => (raw.rooms?.room_number === "301" ? { ...raw, status: "IN_PROGRESS" } : raw)) });
    const { midshift } = hook.result.current;
    expect(midshift.changes?.rooms).toEqual([{ roomId: "room-301", roomNumber: "301", change: "started" }]);
    expect(midshift.blocked).toBe("stale");
    let outcome: unknown;
    act(() => {
      outcome = midshift.addToDraft();
    });
    expect(outcome).toBe("stale");
    expect(hook.result.current.draft.draft).toBeNull();
  });

  it("accepting the change recalculates the plan without the room that can't move", () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, model: board((raw) => (raw.rooms?.room_number === "301" ? { ...raw, status: "IN_PROGRESS" } : raw)) });
    act(() => hook.result.current.midshift.acceptChanges());
    expect(hook.result.current.midshift.changes).toBeNull();
    expect(Object.keys(hook.result.current.midshift.plan?.assignments ?? {})).toHaveLength(5);
    expect(hook.result.current.midshift.blocked).toBeNull();
  });

  it("refresh-and-review reads the board again and then accepts what it finds", async () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, model: board((raw) => (raw.rooms?.room_number === "302" ? { ...raw, assigned_to: "hk-3" } : raw)) });
    expect(hook.result.current.midshift.changes?.rooms[0]).toMatchObject({ roomId: "room-302", change: "reassigned" });
    await act(async () => {
      await hook.result.current.midshift.refreshPlan();
    });
    expect(hook.refresh).toHaveBeenCalledTimes(1);
    expect(hook.result.current.midshift.changes).toBeNull();
    expect(hook.result.current.midshift.selected.has("room-302")).toBe(false);
  });

  it("a receiver who goes on break invalidates the plan that counted on them", () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, model: midshiftModel({ roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "active")]) }) });
    expect(hook.result.current.midshift.changes?.destinations).toEqual([{ userId: "hk-2", from: "on_shift", to: "on_break" }]);
    expect(hook.result.current.midshift.blocked).toBe("stale");
  });

  it("a board that stops being today's closes the sheet and says so", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    hook.rerender({ ...hook.start, model: assignmentsOf({ raw: midshiftBoard(), boardDate: "2020-01-01" }) });
    expect(hook.result.current.midshift.userId).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("assignments.v2.midshift.closedGone");
    expect(hook.closed).toEqual([["hk-1", "reset"]]);
  });

  it("another hotel or person closes it: nothing carries over", () => {
    const hook = setup();
    toPreview(hook);
    hook.rerender({ ...hook.start, scopeKey: "h2:sup-1" });
    expect(hook.result.current.midshift.userId).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("assignments.v2.midshift.closedScope");
  });

  it("another hotel day closes it", () => {
    const hook = setup();
    toPreview(hook);
    const next = midshiftModel();
    hook.rerender({ ...hook.start, model: { ...next, hotelDate: "2099-01-01" } });
    expect(hook.result.current.midshift.userId).toBeNull();
  });
});

describe("adding to the unpublished draft", () => {
  it("stages every change as a midshift reassign with the owner the supervisor saw, then opens the draft review", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    act(() => hook.result.current.midshift.setReason("left_early"));
    act(() => hook.result.current.midshift.next());
    act(() => hook.result.current.midshift.next());
    let outcome: unknown;
    act(() => {
      outcome = hook.result.current.midshift.addToDraft();
    });
    expect(outcome).toBe("added");
    const changes = draftChanges(hook.result.current.draft.draft!);
    expect(changes).toHaveLength(6);
    for (const change of changes) expect(change).toMatchObject({ kind: "reassign", fromUserId: "hk-1", source: "midshift", expected: { expected_assigned_to: "hk-1" } });
    expect(hook.showReview).toHaveBeenCalledTimes(1);
    expect(hook.result.current.midshift.userId).toBeNull();
    expect(hook.closed).toEqual([["hk-1", "added"]]);
  });

  it("remembers where the draft's changes came from, including the reason, until the draft is gone", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    act(() => hook.result.current.midshift.setReason("workload_help"));
    act(() => hook.result.current.midshift.next());
    act(() => hook.result.current.midshift.next());
    act(() => {
      hook.result.current.midshift.addToDraft();
    });
    expect(hook.result.current.midshift.note).toEqual({ count: 6, sourceNames: ["Ana Torres"], reason: "workload_help" });
    act(() => hook.result.current.draft.discard());
    expect(hook.result.current.midshift.note).toBeNull();
  });

  it("an existing draft change for the same room needs an explicit decision, and nothing is replaced silently", () => {
    const hook = setup();
    act(() => {
      hook.result.current.draft.stage({ "room-301": "hk-3" }, "bulk");
    });
    toPreview(hook);
    expect(hook.result.current.midshift.overlap).toEqual(["room-301"]);
    let outcome: unknown;
    act(() => {
      outcome = hook.result.current.midshift.addToDraft();
    });
    expect(outcome).toBe("needs_resolution");
    expect(hook.result.current.midshift.step).toBe("conflict");
    expect(hook.result.current.draft.draft?.changes["room-301"]).toMatchObject({ toUserId: "hk-3", source: "bulk" });
    expect(hook.showReview).not.toHaveBeenCalled();
  });

  it("keep: the existing change stays and only the other rooms are added", () => {
    const hook = setup();
    act(() => {
      hook.result.current.draft.stage({ "room-301": "hk-3" }, "bulk");
    });
    toPreview(hook);
    act(() => {
      hook.result.current.midshift.addToDraft();
    });
    act(() => {
      hook.result.current.midshift.addToDraft("keep");
    });
    const draft = hook.result.current.draft.draft!;
    expect(draft.changes["room-301"]).toMatchObject({ toUserId: "hk-3", source: "bulk" });
    expect(Object.keys(draft.changes)).toHaveLength(6);
    expect(Object.values(draft.changes).filter((change) => change.source === "midshift")).toHaveLength(5);
  });

  it("replace: this plan overwrites only the overlapping rooms and every other draft change survives", () => {
    const hook = setup();
    act(() => {
      hook.result.current.draft.stage({ "room-301": "hk-3", "room-601": "hk-2" }, "bulk");
    });
    toPreview(hook);
    act(() => {
      hook.result.current.midshift.addToDraft();
    });
    act(() => {
      hook.result.current.midshift.addToDraft("replace");
    });
    const draft = hook.result.current.draft.draft!;
    expect(draft.changes["room-301"]?.source).toBe("midshift");
    expect(draft.changes["room-601"]).toMatchObject({ toUserId: "hk-2", source: "bulk" });
    expect(Object.keys(draft.changes)).toHaveLength(7);
  });

  it("going back from the conflict returns to the review with the draft untouched", () => {
    const hook = setup();
    act(() => {
      hook.result.current.draft.stage({ "room-301": "hk-3" }, "bulk");
    });
    toPreview(hook);
    act(() => {
      hook.result.current.midshift.addToDraft();
    });
    act(() => hook.result.current.midshift.cancelConflict());
    expect(hook.result.current.midshift.step).toBe("preview");
    expect(Object.keys(hook.result.current.draft.draft!.changes)).toEqual(["room-301"]);
  });

  it("closing from the first step is a dismissal the screen can return from", () => {
    const hook = setup();
    act(() => hook.result.current.midshift.open("hk-1"));
    act(() => hook.result.current.midshift.back());
    expect(hook.result.current.midshift.userId).toBeNull();
    expect(hook.closed).toEqual([["hk-1", "dismissed"]]);
  });

  it("Back steps one view at a time", () => {
    const hook = setup();
    toPreview(hook);
    act(() => hook.result.current.midshift.back());
    expect(hook.result.current.midshift.step).toBe("destination");
    act(() => hook.result.current.midshift.back());
    expect(hook.result.current.midshift.step).toBe("select");
  });
});
