import { isAssistantRole, assistantFabVisible } from "@/lib/ai/fab";
import { chatQuickActions, sheetQuickActions } from "@/lib/ai/quickActions";
import { normalizeCopilotResponse } from "@/lib/ai/contract";
import {
  MAX_OBSERVATIONS,
  MAX_SUGGESTIONS,
  buildFollowUpDraft,
  isSupervisorCopilotRole,
  resolveRoomContext,
} from "@/lib/ai/supervisorCopilot";
import { isPreviewValid } from "@/lib/ai/drafts";
import { isSupervisorSafePath } from "@/lib/navigation/supervisorRoutes";
import { CTX, NOW, ZONE, fetchers, modelFrom, todayFrom, ARRIVAL_SOON, rawRoom } from "../../helpers/supervisorCopilotFixture";
import { composeSupervisorToday, initialTodaySources, loadTodaySources } from "@/lib/housekeeping/supervisorToday";
import { buildSupervisorCopilot } from "@/lib/ai/supervisorCopilot";

describe("who gets which assistant", () => {
  it("keeps the unified assistant, its button and its quick actions housekeeper-only", () => {
    expect(isAssistantRole("housekeeping_supervisor")).toBe(false);
    expect(isAssistantRole("housekeeper")).toBe(true);
    expect(sheetQuickActions("housekeeping_supervisor")).toEqual([]);
    expect(chatQuickActions("housekeeping_supervisor")).toEqual([]);
    expect(
      assistantFabVisible({ pathname: "/", role: "housekeeping_supervisor", authenticated: true, keyboardVisible: false, sheetOpen: false }),
    ).toBe(false);
    expect(
      assistantFabVisible({ pathname: "/", role: "housekeeper", authenticated: true, keyboardVisible: false, sheetOpen: false }),
    ).toBe(true);
  });

  it("offers the supervisor Copilot to the housekeeping supervisor only", () => {
    expect(isSupervisorCopilotRole("housekeeping_supervisor")).toBe(true);
    for (const role of ["housekeeper", "engineer", "chief_engineer", "front_desk", "gm", null, undefined]) {
      expect(isSupervisorCopilotRole(role)).toBe(false);
    }
  });

  it("never turns an assignment preview from chat into something the app can act on", () => {
    const outcome = normalizeCopilotResponse({
      data: { response_type: "assignment_preview", message: "Assign 308 to Ana?", assignments: [{ room_number: "308", staff_id: "hk-1" }] },
    });
    expect(outcome.kind).toBe("unsupported");
  });
});

describe("the overview is built only from the verified Today snapshot", () => {
  it("states verified figures and names every source with its availability", async () => {
    const { model } = await modelFrom();
    const ready = model.overview.find((line) => line.id === "ready");
    expect(ready).toMatchObject({ params: { ready: 1, total: 5 } });
    expect(model.overview.find((line) => line.id === "unassigned")?.params).toEqual({ count: 3 });
    expect(model.provenance.map((entry) => entry.source).sort()).toEqual(["blockedTasks", "board", "inspections", "roster", "staff"]);
    expect(model.provenance.every((entry) => entry.availability === "verified" && entry.fetchedAt !== null)).toBe(true);
    expect(model.boardKnown).toBe(true);
  });

  it("does not turn a source that failed into zero or into 'all clear'", async () => {
    const { model } = await modelFrom({
      board: async () => {
        throw Object.assign(new Error("boom"), { status: 500 });
      },
      inspections: async () => {
        throw new Error("nope");
      },
    });
    expect(model.boardKnown).toBe(false);
    expect(model.overview.find((line) => line.id === "ready")).toBeUndefined();
    expect(model.overview.find((line) => line.id === "unassigned")).toBeUndefined();
    expect(model.overview.find((line) => line.id === "board")).toMatchObject({ unknown: true, key: "supervisorCopilot.overview.boardUnknown" });
    expect(model.overview.find((line) => line.id === "inspectionResults")).toMatchObject({ unknown: true });
    expect(model.unverified).toEqual(expect.arrayContaining(["board", "inspections"]));
    expect(model.allClear).toBe(false);
  });

  it("calls it 'nothing to report' only when every source was verified and nothing needs attention", async () => {
    const { model } = await modelFrom({ board: async () => [rawRoom("r-301", "INSPECTED"), rawRoom("r-302", "INSPECTED")] });
    expect(model.observations).toEqual([]);
    expect(model.allClear).toBe(true);
    const partial = await modelFrom({
      board: async () => [rawRoom("r-301", "INSPECTED")],
      blockedTasks: async () => {
        throw new Error("down");
      },
    });
    expect(partial.model.allClear).toBe(false);
  });

  it("marks answers kept from before as stale, with their original time, instead of fresh or all-clear", async () => {
    const first = await loadTodaySources(initialTodaySources(), fetchers(), { now: NOW, timeZone: ZONE, online: true });
    const later = NOW + 10 * 60_000;
    const offline = await loadTodaySources(first, fetchers(), { now: later, timeZone: ZONE, online: false });
    const model = buildSupervisorCopilot(composeSupervisorToday(offline, { now: later, timeZone: ZONE }), CTX);
    const board = model.provenance.find((entry) => entry.source === "board");
    expect(board).toMatchObject({ availability: "stale", fetchedAt: NOW });
    expect(model.boardKnown).toBe(true); // the last verified figures are still shown, labelled
    expect(model.allClear).toBe(false);
  });

  it("knows nothing at all when the device has never reached the server", async () => {
    const offline = await todayFrom({}, false);
    expect(offline.sources.board.status).toBe("failed");
    expect(buildSupervisorCopilot(offline, CTX).boardKnown).toBe(false);
  });
});

describe("observations and suggestions", () => {
  it("shows at most three observations and four suggestions, ranked by the Attention rules", async () => {
    const { model } = await modelFrom();
    expect(model.observations.length).toBeGreaterThan(0);
    expect(model.observations.length).toBeLessThanOrEqual(MAX_OBSERVATIONS);
    expect(model.suggestions.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    // The arrival at risk outranks the bulk queues.
    expect(model.observations[0].kind).toBe("arrival_at_risk");
  });

  it("only ever navigates to supervisor routes, never to housekeeper-only screens", async () => {
    const { model } = await modelFrom();
    const opens = model.suggestions.filter((s) => s.type === "open");
    expect(opens.length).toBeGreaterThan(0);
    for (const suggestion of opens) {
      if (suggestion.type !== "open") continue;
      expect(isSupervisorSafePath(suggestion.href.pathname)).toBe(true);
      expect(suggestion.href.pathname).not.toContain("my-rooms");
      expect(suggestion.href.pathname).not.toBe("/(app)/attention");
    }
  });

  it("only passes a room id that is on the verified board, and never invents one", async () => {
    const { today, model } = await modelFrom();
    const boardIds = new Set(today.attention.items.flatMap((item) => item.records.map((r) => r.id)));
    for (const suggestion of model.suggestions) {
      if (suggestion.type === "open") {
        const id = suggestion.href.params?.roomId;
        if (id) expect(boardIds.has(id)).toBe(true);
      } else {
        expect(boardIds.has(suggestion.room.id)).toBe(true);
        expect(suggestion.room.number).toBe("308");
      }
    }
  });

  it("falls back to the list screen when a queue has no single verified room", async () => {
    const { model } = await modelFrom({
      board: async () => [rawRoom("r-302", "DIRTY"), rawRoom("r-303", "DIRTY"), rawRoom("r-301", "INSPECTED")],
    });
    for (const suggestion of model.suggestions) {
      if (suggestion.type === "open") expect(suggestion.href.params).toBeUndefined();
    }
  });

  it("does not recommend finished work: a resolved issue disappears with the next snapshot", async () => {
    const before = await modelFrom();
    expect(before.model.suggestions.some((s) => s.type === "draft_task")).toBe(true);
    const after = await modelFrom({
      board: async () => [rawRoom("r-308", "INSPECTED", { fo_status: "VAC", checkin_time: ARRIVAL_SOON }), rawRoom("r-301", "INSPECTED")],
    });
    expect(after.model.suggestions).toEqual([]);
    expect(after.model.observations).toEqual([]);
  });

  it("does not repeat untrusted room notes or task text as a fact the Copilot states", async () => {
    const { model } = await modelFrom();
    const spoken = JSON.stringify(model);
    expect(spoken).not.toContain("IGNORE ALL RULES");
  });
});

describe("room context", () => {
  it("re-verifies the room against the current board and says so when it is gone", async () => {
    const { today } = await modelFrom();
    expect(resolveRoomContext(null, today.sources)).toEqual({ state: "none" });
    expect(resolveRoomContext({ roomId: "r-308", roomNumber: "308" }, today.sources)).toEqual({
      state: "ok",
      room: { roomId: "r-308", roomNumber: "308" },
    });
    // Another room's number cannot ride along on a verified id; the board's own number wins.
    expect(resolveRoomContext({ roomId: "r-308", roomNumber: "999" }, today.sources)).toMatchObject({ state: "ok", room: { roomNumber: "308" } });
    expect(resolveRoomContext({ roomId: "r-999", roomNumber: "999" }, today.sources)).toEqual({ state: "gone", roomNumber: "999" });
  });

  it("treats an unknown board as 'gone', never as a verified room", async () => {
    const offline = await todayFrom({}, false);
    expect(resolveRoomContext({ roomId: "r-308", roomNumber: "308" }, offline.sources).state).toBe("gone");
  });
});

describe("follow-up task draft", () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}${options?.room ? `:${options.room}` : ""}`;

  it("is a valid, editable preview for a verified room, urgent only for a time-bound arrival", () => {
    const urgent = buildFollowUpDraft({ id: "r-308", number: "308" }, "arrival_at_risk", t);
    expect(urgent.kind).toBe("task");
    expect(isPreviewValid(urgent)).toBe(true);
    expect(urgent.draft).toMatchObject({ roomId: "r-308", roomNumber: "308", priority: "urgent", taskType: "housekeeping" });
    const normal = buildFollowUpDraft({ id: "r-308", number: "308" }, null, t);
    expect(normal.draft).toMatchObject({ priority: "normal", description: "supervisorCopilot.draft.reason.general:308" });
  });
});
