import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert, Modal } from "react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

let mockLanguage: Language = "en";
let mockScheme: "light" | "dark" = "light";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

import { router } from "expo-router";
import { api } from "@/lib/api/client";
import { RoomDetailSheet, type RoomDetailSheetContext } from "@/components/supervisor/RoomDetailSheet";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView, MutationGate } from "@/lib/housekeeping/roomBoardState";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

const mockPost = api.post as jest.Mock;
const ALLOWED: MutationGate = { allowed: true, blockedBy: null };
const MARIA = { userId: "hk-1", name: "Maria Santos", availability: "on_shift" as const };
const assigned = { assigned_to: "hk-1", assignment_id: "as-1", assignment_date: "2026-10-16" } as const;

const contextOf = (overrides: Partial<RoomDetailSheetContext> = {}): RoomDetailSheetContext => ({
  now: NOW,
  timeZone: ZONE,
  gate: ALLOWED,
  verifiedClock: "11:59 AM",
  live: true,
  rosterTrust: "verified",
  staff: [{ userId: "hk-1", name: "Maria Santos", role: "housekeeper", availability: "on_shift", assignedRooms: 8, openRooms: 5 }],
  staffNamesKnown: true,
  lateCheckoutsKnown: true,
  ...overrides,
});

function viewOf(raw: BoardRoomRaw, assignee: BoardRoomView["assignee"] = null): BoardRoomView {
  return { room: normalizeBoardRecords([raw]).rooms[0], assignee };
}

function setup(view: BoardRoomView, context = contextOf(), saving = false) {
  const handlers = { onAssign: jest.fn(), onRemoveAssignment: jest.fn(), onClose: jest.fn() };
  const ui = (v: BoardRoomView, c: RoomDetailSheetContext) => (
    <ThemeProvider>
      <RoomDetailSheet room={v.room} view={v} context={c} saving={saving} {...handlers} />
    </ThemeProvider>
  );
  const screen = render(ui(view, context));
  return { screen, handlers, rerenderWith: (v: BoardRoomView, c = context) => screen.rerender(ui(v, c)) };
}

const text = (node: { props: { children?: unknown } }) => String(node.props.children);
const pressed = (screen: ReturnType<typeof render>, id: string) => fireEvent.press(screen.getByTestId(id));

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockScheme = "light";
  mockPost.mockResolvedValue({ data: {} });
});

describe("RoomDetailSheet — structure", () => {
  it("shows the selected room, its type, floor and building, status badge and flags", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY", { vip_flag: true, clean_type: "DEP", clean_type_label: "Departure" })));
    expect(text(screen.getByTestId("room-detail-number"))).toBe("201");
    expect(text(screen.getByTestId("room-detail-subtitle"))).toBe("K · Floor 2 · Building A");
    expect(screen.getByTestId("room-detail-status")).toBeTruthy();
    expect(screen.getByText("Dirty")).toBeTruthy();
    expect(screen.getByTestId("room-detail-flag-vip")).toBeTruthy();
    expect(screen.getByTestId("room-detail-flag-cleanType")).toBeTruthy();
  });

  it("renders the status, assignment and cleaning sections, and no issues section when there is nothing to report", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY")));
    expect(screen.getByTestId("room-detail-section-status")).toBeTruthy();
    expect(screen.getByTestId("room-detail-section-assignment")).toBeTruthy();
    expect(screen.getByTestId("room-detail-section-cleaning")).toBeTruthy();
    expect(screen.queryByTestId("room-detail-section-issues")).toBeNull();
  });

  it("is one modal sheet the screen reader treats as modal, with a labelled summary header", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    expect(screen.getByTestId("room-detail-sheet").props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByTestId("room-detail-header").props.accessibilityLabel).toBe("Room 201, Dirty, assigned to Maria Santos");
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  });

  it("keeps the room number from scaling out of its box and every body text bounded for large fonts", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY")));
    expect(screen.getByTestId("room-detail-number").props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.3);
    expect(screen.getByTestId("room-detail-row-housekeeping").findAllByType(require("react-native").Text).every((n: { props: { maxFontSizeMultiplier?: number } }) => (n.props.maxFontSizeMultiplier ?? 99) <= 1.6)).toBe(true);
  });

  it.each(["light", "dark"] as const)("renders under the %s theme", (scheme) => {
    mockScheme = scheme;
    const { screen } = setup(viewOf(rawRoom("201", "CLEAN", { inspection_required: true })));
    expect(screen.getByTestId("room-detail-primary")).toBeTruthy();
  });

  it("renders in Spanish", () => {
    mockLanguage = "es";
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY")));
    expect(screen.getByText("Asignar habitación")).toBeTruthy();
    expect(screen.getByText("Estado de la habitación")).toBeTruthy();
    expect(screen.getByLabelText("Cerrar")).toBeTruthy();
  });
});

describe("RoomDetailSheet — content", () => {
  it("shows the latest note in full, a work order without a link, and DND with its wellness check", () => {
    const long = "Guest requested extra towels and a crib; ".repeat(10).trim();
    const { screen } = setup(
      viewOf(rawRoom("201", "OCCUPIED", {
        latest_note: long, open_work_order_id: "wo-1", open_work_order_number: "WO-1042", open_work_order_title: "Bathroom faucet leaking",
        open_work_order_status: "in_progress", dnd_flag: true,
      })),
    );
    expect(screen.getByText(long)).toBeTruthy();
    const wo = screen.getByTestId("room-detail-work-order");
    expect(screen.getByText("Bathroom faucet leaking")).toBeTruthy();
    expect(screen.getByText("Status: In progress")).toBeTruthy();
    expect(screen.getByText("Work order #WO-1042")).toBeTruthy();
    // Display only: a supervisor has no work-order route yet, so nothing here is pressable.
    expect(wo.props.onPress).toBeUndefined();
    expect(wo.props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId("room-detail-exception-dnd")).toBeTruthy();
    expect(screen.getByTestId("room-detail-wellness")).toBeTruthy();
  });

  it("shows the latest cleaning evidence with hotel-local time, and 'no session' when there is none", () => {
    const withSession = setup(viewOf(rawRoom("201", "CLEAN", {
      last_session_id: "s1", last_clean_minutes: 31, last_clean_base_minutes: 30, last_clean_checklist_done: 12, last_clean_checklist_total: 12,
      last_clean_photo_count: 3, last_clean_ended_at: "2026-10-16T15:42:00Z",
    })));
    expect(withSession.screen.getByText("Today, 10:42 AM")).toBeTruthy();
    expect(withSession.screen.getByText("31 min · baseline 30 min")).toBeTruthy();
    expect(withSession.screen.getByText("12 / 12")).toBeTruthy();
    expect(withSession.screen.getByText("3 recorded")).toBeTruthy();
    withSession.screen.unmount();

    const none = setup(viewOf(rawRoom("201", "DIRTY")));
    expect(none.screen.getByText("No completed cleaning session today.")).toBeTruthy();
  });

  it("an assigned room with an unknown name still reads Assigned, never Unassigned", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY", assigned), { userId: "hk-1", name: null, availability: "unknown" }), contextOf({ staff: [], staffNamesKnown: false }));
    expect(text(screen.getByTestId("room-detail-assignee"))).toBe("Assigned · Name unavailable");
    expect(screen.getByTestId("room-detail-shift")).toBeTruthy();
  });

  it("shows workload and verified shift status for a named assignee", () => {
    const { screen } = setup(viewOf(rawRoom("201", "IN_PROGRESS", assigned), MARIA));
    expect(text(screen.getByTestId("room-detail-workload"))).toBe("8 rooms assigned today");
    expect(text(screen.getByTestId("room-detail-shift"))).toBe("On shift");
  });
});

describe("RoomDetailSheet — closing and the More actions drawer", () => {
  it("the close button and the backdrop close it; Android back closes the room", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("201", "DIRTY")));
    pressed(screen, "room-detail-close");
    // The backdrop is a tap-to-dismiss convenience only; screen readers get the labelled Close button instead.
    fireEvent.press(screen.getByTestId("room-detail-backdrop", { includeHiddenElements: true }));
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(handlers.onClose).toHaveBeenCalledTimes(3);
  });

  it("More actions swaps the SAME modal's content (never a stacked second modal); back steps to the room, then closes", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    pressed(screen, "room-detail-more");
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
    expect(text(screen.getByTestId("room-actions-title"))).toBe("ROOM 201 · ACTIONS");
    expect(screen.queryByTestId("room-detail-sheet")).toBeNull();
    expect(screen.getByTestId("room-action-remove")).toBeTruthy();

    // Android back from More actions returns to the room instead of closing everything.
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();

    pressed(screen, "room-detail-more");
    pressed(screen, "room-actions-back");
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();
    pressed(screen, "room-detail-more");
    pressed(screen, "room-detail-close");
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("has no More actions button when no secondary action applies (no dead menu)", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY")));
    expect(screen.queryByTestId("room-detail-more")).toBeNull();
    const inspected = setup(viewOf(rawRoom("202", "INSPECTED")));
    expect(inspected.screen.queryByTestId("room-detail-more")).toBeNull();
    expect(inspected.screen.queryByTestId("room-detail-primary")).toBeNull();
  });

  it("falls back to the room if a realtime change empties the open menu", () => {
    const { screen, rerenderWith } = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    pressed(screen, "room-detail-more");
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
    // The assignment was removed elsewhere: Remove no longer applies, only the primary Assign remains.
    rerenderWith(viewOf(rawRoom("201", "DIRTY")));
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();
    expect(screen.getByTestId("room-detail-primary")).toBeTruthy();
  });

  it("follows a realtime update for the same room without resetting (status, then actions, re-evaluated)", () => {
    const { screen, rerenderWith } = setup(viewOf(rawRoom("201", "CLEAN", { inspection_required: true })));
    expect(screen.getByText("Inspect room")).toBeTruthy();
    rerenderWith(viewOf(rawRoom("201", "INSPECTED", { inspection_required: true })));
    expect(text(screen.getByTestId("room-detail-number"))).toBe("201");
    expect(screen.queryByTestId("room-detail-primary")).toBeNull();
    expect(screen.getByText("Ready")).toBeTruthy();
  });
});

describe("RoomDetailSheet — actions", () => {
  it("Assign / Reassign hand the room to the screen's existing flow", () => {
    const unassigned = setup(viewOf(rawRoom("201", "DIRTY")));
    pressed(unassigned.screen, "room-detail-primary");
    expect(unassigned.handlers.onAssign).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-201" }));
    unassigned.screen.unmount();

    const mine = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    expect(mine.screen.getByText("Reassign room")).toBeTruthy();
    pressed(mine.screen, "room-detail-primary");
    expect(mine.handlers.onAssign).toHaveBeenCalledTimes(1);
  });

  it("an in-progress assigned room offers 'Change assignment' in its assignment card", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("204", "IN_PROGRESS", assigned), MARIA));
    expect(screen.queryByTestId("room-detail-primary")).toBeNull();
    pressed(screen, "room-detail-change-assignment");
    expect(handlers.onAssign).toHaveBeenCalledTimes(1);
  });

  it("Inspect closes the drawer and opens the existing inspection queue", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("205", "CLEAN", { inspection_required: true })));
    pressed(screen, "room-detail-primary");
    expect(handlers.onClose).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/(app)/inspect");
  });

  it("Remove assignment is a destructive confirmation; only the confirm button removes", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    try {
      const { screen, handlers } = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
      pressed(screen, "room-detail-more");
      pressed(screen, "room-action-remove");
      expect(handlers.onRemoveAssignment).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith("Remove assignment for Room 201?", "The room will move back to unassigned.", expect.any(Array));
      const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; style?: string; onPress?: () => void }>;
      expect(buttons.find((b) => b.style === "cancel")?.onPress).toBeUndefined();
      const confirm = buttons.find((b) => b.style === "destructive");
      expect(confirm?.text).toBe("Remove assignment");
      confirm?.onPress?.();
      expect(handlers.onRemoveAssignment).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-201" }));
    } finally {
      alertSpy.mockRestore();
    }
  });

  it.each([
    ["offline", { allowed: false, blockedBy: "offline" }],
    ["stale", { allowed: false, blockedBy: "stale" }],
    ["unavailable", { allowed: false, blockedBy: "unavailable" }],
  ] as const)("a %s board shows why and blocks assign, reassign, remove and the wellness task", (_n, gate) => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    try {
      const { screen, handlers } = setup(viewOf(rawRoom("201", "DIRTY", { ...assigned, dnd_flag: true }), MARIA), contextOf({ gate: gate as MutationGate, live: false }));
      expect(screen.getByTestId("room-detail-paused")).toBeTruthy();
      pressed(screen, "room-detail-primary");
      pressed(screen, "room-detail-wellness");
      pressed(screen, "room-detail-more");
      pressed(screen, "room-action-remove");
      expect(handlers.onAssign).not.toHaveBeenCalled();
      expect(handlers.onRemoveAssignment).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      expect(mockPost).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("a stale board still lets the supervisor read the room and open the inspection queue", () => {
    const { screen } = setup(viewOf(rawRoom("205", "CLEAN", { inspection_required: true })), contextOf({ gate: { allowed: false, blockedBy: "stale" }, live: false }));
    pressed(screen, "room-detail-primary");
    expect(router.push).toHaveBeenCalledWith("/(app)/inspect");
  });
});

describe("RoomDetailSheet — DND wellness check", () => {
  it("is a confirmation first; confirming creates the task once, however many times it is tapped", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    try {
      let resolve: (value: unknown) => void = () => undefined;
      mockPost.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
      const { screen } = setup(viewOf(rawRoom("101", "OCCUPIED", { dnd_flag: true })));
      pressed(screen, "room-detail-wellness");
      expect(alertSpy).toHaveBeenCalledWith("Wellness check — Room 101", expect.any(String), expect.any(Array));
      expect(mockPost).not.toHaveBeenCalled();

      const confirm = (alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>)[1];
      await act(async () => {
        confirm.onPress?.();
        confirm.onPress?.();
      });
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith("/tasks", {
        title: "Supervisor wellness check — Room 101", task_type: "housekeeping", priority: "high", room_id: "room-101",
      });
      await act(async () => resolve({ data: {} }));
      expect(mockToast.success).toHaveBeenCalledWith("Wellness check task created.");
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("reports a failed request with an error toast", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    try {
      mockPost.mockRejectedValueOnce(new Error("offline"));
      const { screen } = setup(viewOf(rawRoom("101", "OCCUPIED", { dnd_flag: true })));
      pressed(screen, "room-detail-wellness");
      const confirm = (alertSpy.mock.calls[0][2] as Array<{ onPress?: () => void }>)[1];
      await act(async () => confirm.onPress?.());
      expect(mockToast.error).toHaveBeenCalledWith("Could not create task. Try again.");
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("never offers to turn DND off", () => {
    const { screen } = setup(viewOf(rawRoom("101", "OCCUPIED", { dnd_flag: true })));
    expect(screen.queryByText(/turn off|clear dnd|remove dnd/i)).toBeNull();
  });
});
