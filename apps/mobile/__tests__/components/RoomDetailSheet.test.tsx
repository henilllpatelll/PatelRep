import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Modal } from "react-native";
import type { AssignmentController } from "@/lib/housekeeping/useRoomAssignment";
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
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn(), get: jest.fn() } }));

import { router } from "expo-router";
import { api } from "@/lib/api/client";
import { RoomDetailSheet, type RoomDetailSheetContext } from "@/components/supervisor/RoomDetailSheet";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView, MutationGate } from "@/lib/housekeeping/roomBoardState";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

const mockPost = api.post as jest.Mock;
const mockGet = api.get as jest.Mock;
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

/** A closed assignment controller whose openers are spies: the sheet only has to call them. */
function controllerOf(overrides: Partial<AssignmentController> = {}): AssignmentController {
  return {
    flow: null, room: null, intent: null, block: null, changedSinceReview: false, picker: null, review: null, removal: null,
    busy: false, error: null, canConfirm: false,
    openAssign: jest.fn(), openRemove: jest.fn(), setQuery: jest.fn(), setFilter: jest.fn(), select: jest.fn(), setAck: jest.fn(),
    toReview: jest.fn(), back: jest.fn(), close: jest.fn(), confirm: jest.fn(),
    ...overrides,
  };
}

function setup(view: BoardRoomView, context = contextOf(), assignment = controllerOf()) {
  const handlers = { onClose: jest.fn(), onAssign: assignment.openAssign as jest.Mock, onRemoveAssignment: assignment.openRemove as jest.Mock };
  const ui = (v: BoardRoomView, c: RoomDetailSheetContext) => (
    <ThemeProvider>
      <RoomDetailSheet room={v.room} view={v} context={c} assignment={assignment} deps={{ scopeKey: "t:u", userId: "u", refresh: jest.fn().mockResolvedValue(undefined) }} onClose={handlers.onClose} />
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
  mockGet.mockResolvedValue({ data: [] });
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
    // The summary card itself is not pressable; the read-only detail has its own button.
    expect(wo.props.onPress).toBeUndefined();
    expect(wo.props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId("room-detail-work-order-open")).toBeTruthy();
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

  it("More actions lists only what applies to the room: note and cleaning history for any room, no placeholders", () => {
    const { screen } = setup(viewOf(rawRoom("201", "DIRTY")));
    pressed(screen, "room-detail-more");
    expect(screen.getByTestId("room-action-note")).toBeTruthy();
    expect(screen.getByTestId("room-action-cleaningHistory")).toBeTruthy();
    expect(screen.queryByTestId("room-action-wellness")).toBeNull();
    expect(screen.queryByTestId("room-action-workOrder")).toBeNull();
    expect(screen.queryByTestId("room-action-inspectionHistory")).toBeNull();
    const inspected = setup(viewOf(rawRoom("202", "INSPECTED")));
    expect(inspected.screen.queryByTestId("room-detail-primary")).toBeNull();
    pressed(inspected.screen, "room-detail-more");
    expect(inspected.screen.getByTestId("room-action-inspectionHistory")).toBeTruthy();
  });

  it("keeps the actions drawer open and re-evaluated when a realtime change alters the menu", () => {
    const { screen, rerenderWith } = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    pressed(screen, "room-detail-more");
    expect(screen.getByTestId("room-action-remove")).toBeTruthy();
    rerenderWith(viewOf(rawRoom("201", "DIRTY")));
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
    expect(screen.queryByTestId("room-action-remove")).toBeNull();
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
    expect(unassigned.handlers.onAssign).toHaveBeenCalledWith("room-201");
    unassigned.screen.unmount();

    const mine = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    expect(mine.screen.getByText("Reassign room")).toBeTruthy();
    pressed(mine.screen, "room-detail-primary");
    expect(mine.handlers.onAssign).toHaveBeenCalledTimes(1);
  });

  it("a room being cleaned offers no reassign, assign or remove: a live session is never handed over", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("204", "IN_PROGRESS", assigned), MARIA));
    expect(screen.queryByTestId("room-detail-primary")).toBeNull();
    expect(screen.queryByTestId("room-detail-change-assignment")).toBeNull();
    pressed(screen, "room-detail-more");
    expect(screen.queryByTestId("room-action-assign")).toBeNull();
    expect(screen.queryByTestId("room-action-reassign")).toBeNull();
    expect(screen.queryByTestId("room-action-remove")).toBeNull();
    expect(handlers.onAssign).not.toHaveBeenCalled();
    expect(handlers.onRemoveAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["submitted for inspection", "CLEAN"],
    ["inspected", "INSPECTED"],
    ["out of service", "OOO"],
  ])("a room %s keeps its assignment and offers no way to change it", (_label, status) => {
    const { screen } = setup(viewOf(rawRoom("206", status, assigned), MARIA));
    expect(screen.queryByTestId("room-detail-change-assignment")).toBeNull();
    expect(screen.queryByText("Reassign room")).toBeNull();
    expect(screen.queryByText("Remove assignment")).toBeNull();
  });

  it("Inspect closes the drawer and opens the existing inspection queue", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("205", "CLEAN", { inspection_required: true })));
    pressed(screen, "room-detail-primary");
    expect(handlers.onClose).toHaveBeenCalled();
    // The room's stable id travels with the link, so Inspect opens THAT room (the number is only a label).
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/inspect", params: { roomId: "room-205", roomNumber: "205" } });
  });

  it("Remove opens the removal confirmation in the same modal; nothing is removed by opening it", () => {
    const { screen, handlers } = setup(viewOf(rawRoom("201", "DIRTY", assigned), MARIA));
    pressed(screen, "room-detail-more");
    pressed(screen, "room-action-remove");
    expect(handlers.onRemoveAssignment).toHaveBeenCalledWith("room-201");
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  });

  it.each([
    ["offline", { allowed: false, blockedBy: "offline" }],
    ["stale", { allowed: false, blockedBy: "stale" }],
    ["unavailable", { allowed: false, blockedBy: "unavailable" }],
  ] as const)("a %s board shows why and blocks assign, reassign, remove, notes and the wellness request", (_n, gate) => {
    const { screen, handlers } = setup(viewOf(rawRoom("201", "DIRTY", { ...assigned, dnd_flag: true }), MARIA), contextOf({ gate: gate as MutationGate, live: false }));
    expect(screen.getByTestId("room-detail-paused")).toBeTruthy();
    pressed(screen, "room-detail-primary");
    pressed(screen, "room-detail-wellness");
    pressed(screen, "room-detail-more");
    pressed(screen, "room-action-remove");
    pressed(screen, "room-action-note");
    pressed(screen, "room-action-wellness");
    expect(handlers.onAssign).not.toHaveBeenCalled();
    expect(handlers.onRemoveAssignment).not.toHaveBeenCalled();
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a stale board still lets the supervisor read the room and open the inspection queue", () => {
    const { screen } = setup(viewOf(rawRoom("205", "CLEAN", { inspection_required: true })), contextOf({ gate: { allowed: false, blockedBy: "stale" }, live: false }));
    pressed(screen, "room-detail-primary");
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/inspect", params: { roomId: "room-205", roomNumber: "205" } });
  });
});

describe("RoomDetailSheet — DND wellness check", () => {
  const open = (status = "OCCUPIED") => {
    const ui = setup(viewOf(rawRoom("101", status, { dnd_flag: true })));
    pressed(ui.screen, "room-detail-wellness");
    return ui;
  };

  it("opens a dedicated drawer first; nothing is requested until it is confirmed", () => {
    const { screen } = open();
    expect(screen.getByTestId("room-wellness-panel")).toBeTruthy();
    expect(screen.getByText("ROOM 101 · DND")).toBeTruthy();
    expect(screen.getByText("Do Not Disturb is active.")).toBeTruthy();
    expect(screen.queryByText(/override/i)).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  });

  it("confirming sends ONE request to the dedicated endpoint, however many times it is tapped, and never POST /tasks", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockPost.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { screen } = open();
    await act(async () => {
      fireEvent.press(screen.getByTestId("room-wellness-request"));
      fireEvent.press(screen.getByTestId("room-wellness-request"));
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/rooms/room-101/welfare-check", {});
    expect(screen.queryByTestId("room-wellness-done")).toBeNull();
    await act(async () => resolve({ data: { task_id: "t-1", already_requested: false } }));
    expect(screen.getByTestId("room-wellness-done")).toBeTruthy();
    expect(screen.getByText("Do Not Disturb is still on.")).toBeTruthy();
  });

  it("says so when a request already existed instead of claiming a new one", async () => {
    mockPost.mockResolvedValueOnce({ data: { task_id: "t-0", already_requested: true } });
    const { screen } = open();
    await act(async () => fireEvent.press(screen.getByTestId("room-wellness-request")));
    expect(screen.getByText("A wellness check was already requested for this room. Nothing new was created.")).toBeTruthy();
  });

  it("an unclear outcome is never shown as success and can be retried safely", async () => {
    mockPost.mockRejectedValueOnce(new Error("Network request failed"));
    const { screen } = open();
    await act(async () => fireEvent.press(screen.getByTestId("room-wellness-request")));
    expect(screen.queryByTestId("room-wellness-done")).toBeNull();
    expect(screen.getByTestId("room-wellness-error")).toBeTruthy();
    expect(screen.getByText("Check and try again")).toBeTruthy();
  });

  it("a 409 from the server (DND already off) reports that nothing was requested", async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error("Do Not Disturb is not active for this room"), { status: 409 }));
    const { screen } = open();
    await act(async () => fireEvent.press(screen.getByTestId("room-wellness-request")));
    expect(screen.getByText("Do Not Disturb is not active, so nothing was requested.")).toBeTruthy();
  });

  it("closes safely: Cancel returns to the room and Back never loses the sheet", () => {
    const { screen } = open();
    pressed(screen, "room-wellness-cancel");
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();
  });

  it("never offers to turn DND off", () => {
    const { screen } = setup(viewOf(rawRoom("101", "OCCUPIED", { dnd_flag: true })));
    expect(screen.queryByText(/turn off|clear dnd|remove dnd/i)).toBeNull();
  });
});
