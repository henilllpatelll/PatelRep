import { assistantFabPlacement, assistantFabVisible, isAssistantRole, TAB_BAR_HEIGHT } from "@/lib/ai/fab";
import {
  GENERAL_CONTEXT,
  contextChanged,
  contextToIds,
  isValidEntityId,
  normalizeLaunch,
} from "@/lib/ai/launch";
import { addTaskHref, chatQuickActions, resolveQuickAction, roomIdOf, roomIssueHref, sheetQuickActions } from "@/lib/ai/quickActions";
import { speechLocale } from "@/lib/voice/locale";

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";

describe("floating assistant visibility", () => {
  const base = { pathname: "/home", role: "housekeeper", authenticated: true, keyboardVisible: false, sheetOpen: false };

  it("shows for a signed-in housekeeper on ordinary screens", () => {
    expect(assistantFabVisible(base)).toBe(true);
    expect(assistantFabVisible({ ...base, pathname: "/tasks" })).toBe(true);
    expect(assistantFabVisible({ ...base, pathname: "/my-rooms" })).toBe(true);
  });

  it("steps aside for the keyboard, the open sheet, and signed-out states", () => {
    expect(assistantFabVisible({ ...base, keyboardVisible: true })).toBe(false);
    expect(assistantFabVisible({ ...base, sheetOpen: true })).toBe(false);
    expect(assistantFabVisible({ ...base, authenticated: false })).toBe(false);
  });

  it("never covers room detail's sticky actions or the full assistant", () => {
    expect(assistantFabVisible({ ...base, pathname: "/my-rooms/abc" })).toBe(false);
    expect(assistantFabVisible({ ...base, pathname: "/copilot" })).toBe(false);
    expect(assistantFabVisible({ ...base, pathname: "/copilot/anything" })).toBe(false);
  });

  it("is housekeeper-only: every other role keeps its existing corner card", () => {
    for (const role of ["engineer", "chief_engineer", "front_desk", "gm", "housekeeping_supervisor", undefined, null]) {
      expect(isAssistantRole(role)).toBe(false);
      expect(assistantFabVisible({ ...base, role })).toBe(false);
    }
  });
});

describe("floating assistant placement", () => {
  it("sits above the tab bar and the home indicator", () => {
    const { bottom } = assistantFabPlacement({ bottom: 34, right: 0 });
    expect(bottom).toBeGreaterThan(34 + TAB_BAR_HEIGHT);
  });

  it("keeps the side gutter and clears a landscape cut-out", () => {
    expect(assistantFabPlacement({ bottom: 0, right: 0 }).right).toBe(18);
    expect(assistantFabPlacement({ bottom: 0, right: 44 }).right).toBe(56);
  });
});

describe("launching the assistant with context", () => {
  it("accepts a well-formed id for each context type and maps it to what the server verifies", () => {
    expect(contextToIds(normalizeLaunch({ contextType: "room", entityId: ROOM }))).toEqual({ roomId: ROOM });
    expect(contextToIds(normalizeLaunch({ contextType: "cleaningSession", entityId: ROOM }))).toEqual({ roomId: ROOM });
    expect(contextToIds(normalizeLaunch({ contextType: "maintenanceIssue", entityId: ROOM }))).toEqual({ roomId: ROOM });
    expect(contextToIds(normalizeLaunch({ contextType: "task", entityId: TASK }))).toEqual({ taskId: TASK });
    expect(contextToIds(normalizeLaunch({ contextType: "sop", entityId: DOC }))).toEqual({ documentId: DOC });
  });

  it("sends no ids for the general and shift contexts", () => {
    expect(contextToIds(normalizeLaunch({ contextType: "general" }))).toEqual({});
    expect(contextToIds(normalizeLaunch({ contextType: "shift" }))).toEqual({});
    expect(contextToIds(normalizeLaunch(undefined))).toEqual({});
  });

  it.each(["", "room-1", "not an id", "../../etc/passwd", "1; drop table rooms", `${ROOM} `.repeat(2)])(
    "refuses %p instead of sending it, falling back to the general context",
    (bad) => {
      const context = normalizeLaunch({ contextType: "room", entityId: bad });
      expect(context).toBe(GENERAL_CONTEXT);
      expect(contextToIds(context)).toEqual({});
    },
  );

  it("refuses a context type it does not know", () => {
    expect(normalizeLaunch({ contextType: "admin", entityId: ROOM } as never)).toBe(GENERAL_CONTEXT);
  });

  it("validates ids only by shape (the server does the authorising)", () => {
    expect(isValidEntityId(ROOM)).toBe(true);
    expect(isValidEntityId(ROOM.toUpperCase())).toBe(true);
    expect(isValidEntityId(undefined)).toBe(false);
    expect(isValidEntityId(42)).toBe(false);
  });

  it("keeps a label for display only and trims it", () => {
    const context = normalizeLaunch({ contextType: "room", entityId: ROOM, label: "  Room   218  ".padEnd(200, "x") });
    expect(context.label?.length).toBeLessThanOrEqual(40);
    expect(context.label?.startsWith("Room 218")).toBe(true);
    expect(contextToIds(context)).toEqual({ roomId: ROOM });
  });

  it("treats a different room, or a different kind of subject, as a change of context", () => {
    const a = normalizeLaunch({ contextType: "room", entityId: ROOM });
    expect(contextChanged(a, normalizeLaunch({ contextType: "room", entityId: ROOM.toUpperCase() }))).toBe(false);
    expect(contextChanged(a, normalizeLaunch({ contextType: "room", entityId: OTHER_ROOM }))).toBe(true);
    expect(contextChanged(a, normalizeLaunch({ contextType: "cleaningSession", entityId: ROOM }))).toBe(true);
    expect(contextChanged(a, GENERAL_CONTEXT)).toBe(true);
  });
});

describe("quick actions", () => {
  it("offers a housekeeper exactly the four compact actions", () => {
    expect(sheetQuickActions("housekeeper").map((a) => a.id)).toEqual(["nextRoom", "reportIssue", "createTask", "askQuestion"]);
    expect(chatQuickActions("housekeeper").map((a) => a.id)).toEqual(["nextRoom", "reportIssue", "createTask", "findProcedure"]);
  });

  it("offers nobody else the housekeeper actions", () => {
    for (const role of ["engineer", "front_desk", "gm", "housekeeping_supervisor", undefined]) {
      expect(sheetQuickActions(role)).toEqual([]);
      expect(chatQuickActions(role)).toEqual([]);
    }
  });

  it("does something real for each action", () => {
    expect(resolveQuickAction("nextRoom", null)).toEqual({ type: "nextRoom" });
    expect(resolveQuickAction("askQuestion", null)).toEqual({ type: "focus" });
    expect(resolveQuickAction("createTask", null)).toEqual({ type: "navigate", href: "/(app)/tasks?add=1" });
    expect(resolveQuickAction("findProcedure", null)).toEqual({ type: "compose", hint: "sop_query" });
  });

  it("reports an issue straight into the existing room form when the room is known, else asks which room", () => {
    expect(resolveQuickAction("reportIssue", ROOM)).toEqual({ type: "navigate", href: `/(app)/my-rooms/${ROOM}?action=issue` });
    expect(resolveQuickAction("reportIssue", null)).toEqual({ type: "pickRoom" });
    expect(roomIssueHref(ROOM)).toContain("action=issue");
  });

  it("carries what was typed into the new task, capped, and encodes it", () => {
    expect(addTaskHref("  Fix & clean 214  ")).toBe(`/(app)/tasks?add=1&prefill=${encodeURIComponent("Fix & clean 214")}`);
    expect(addTaskHref("")).toBe("/(app)/tasks?add=1");
    expect(decodeURIComponent(addTaskHref("x".repeat(900)).split("prefill=")[1]!)).toHaveLength(500);
  });

  it("knows the room only for room-shaped contexts", () => {
    expect(roomIdOf(normalizeLaunch({ contextType: "room", entityId: ROOM }))).toBe(ROOM);
    expect(roomIdOf(normalizeLaunch({ contextType: "maintenanceIssue", entityId: ROOM }))).toBe(ROOM);
    expect(roomIdOf(normalizeLaunch({ contextType: "task", entityId: TASK }))).toBeNull();
    expect(roomIdOf(GENERAL_CONTEXT)).toBeNull();
  });
});

describe("speech recognition language", () => {
  it("listens in English for English and Spanish for Spanish, never English for a Spanish speaker", () => {
    expect(speechLocale("en")).toBe("en-US");
    expect(speechLocale("en-GB")).toBe("en-US");
    expect(speechLocale("es")).toBe("es-US");
    expect(speechLocale("es-MX")).toBe("es-US");
    expect(speechLocale("ES")).toBe("es-US");
  });

  it("defaults to English when the language is unknown", () => {
    expect(speechLocale(undefined)).toBe("en-US");
    expect(speechLocale(null)).toBe("en-US");
    expect(speechLocale("")).toBe("en-US");
  });
});
