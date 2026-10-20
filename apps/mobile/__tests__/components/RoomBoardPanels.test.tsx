import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Modal } from "react-native";
import type { AssignmentController } from "@/lib/housekeeping/useRoomAssignment";
import { makeTranslator } from "../helpers/i18n";

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn(), get: jest.fn() } }));

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
const t = makeTranslator("en");

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

const viewOf = (raw: BoardRoomRaw): BoardRoomView => ({ room: normalizeBoardRecords([raw]).rooms[0], assignee: null });
const closedAssignment = {
  flow: null, room: null, intent: null, block: null, changedSinceReview: false, picker: null, review: null, removal: null, busy: false, error: null, canConfirm: false,
  openAssign: jest.fn(), openRemove: jest.fn(), setQuery: jest.fn(), setFilter: jest.fn(), select: jest.fn(), setAck: jest.fn(), toReview: jest.fn(), back: jest.fn(), close: jest.fn(), confirm: jest.fn(),
} as unknown as AssignmentController;

let refresh: jest.Mock;
let onClose: jest.Mock;

function setup(raw: BoardRoomRaw, context = contextOf()) {
  const ui = (r: BoardRoomRaw, c: RoomDetailSheetContext) => (
    <ThemeProvider>
      <RoomDetailSheet
        room={viewOf(r).room}
        view={viewOf(r)}
        context={c}
        assignment={closedAssignment}
        deps={{ scopeKey: "t:u", userId: "u", refresh }}
        onClose={onClose}
      />
    </ThemeProvider>
  );
  const screen = render(ui(raw, context));
  return { screen, rerenderWith: (r: BoardRoomRaw, c = context) => screen.rerender(ui(r, c)) };
}
const press = (screen: ReturnType<typeof render>, id: string) => fireEvent.press(screen.getByTestId(id));
const openAction = (screen: ReturnType<typeof render>, key: string) => {
  press(screen, "room-detail-more");
  press(screen, `room-action-${key}`);
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  jest.clearAllMocks();
  refresh = jest.fn().mockResolvedValue(undefined);
  onClose = jest.fn();
  mockPost.mockResolvedValue({ data: { ok: true } });
  mockGet.mockResolvedValue({ data: [] });
});

describe("single-modal navigation", () => {
  it("every drawer lives in the one Modal and Back steps one view at a time", () => {
    const { screen } = setup(rawRoom("201", "DIRTY"));
    openAction(screen, "note");
    expect(screen.getByTestId("room-note-panel")).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
    press(screen, "panel-back");
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
    press(screen, "room-actions-back");
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();
  });

  it("the Android hardware back (onRequestClose) pops one view, then closes", () => {
    const { screen } = setup(rawRoom("201", "DIRTY"));
    openAction(screen, "cleaningHistory");
    const modal = screen.UNSAFE_getByType(Modal);
    act(() => modal.props.onRequestClose());
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Add note", () => {
  const open = (raw = rawRoom("201", "DIRTY")) => {
    const ui = setup(raw);
    openAction(ui.screen, "note");
    return ui;
  };

  it("shows the room, honest visibility and a disabled Save until there is text", () => {
    const { screen } = open();
    expect(screen.getByText("ADD NOTE · ROOM 201")).toBeTruthy();
    expect(screen.getByText(/visible to authorized staff/i)).toBeTruthy();
    expect(screen.queryByText(/private|supervisors only/i)).toBeNull();
    expect(screen.getByTestId("room-note-save").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId("room-note-input"), "   ");
    expect(screen.getByTestId("room-note-save").props.accessibilityState.disabled).toBe(true);
  });

  it("sends the trimmed text once to the notes endpoint, however often Save is tapped, then confirms and refreshes", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockPost.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { screen } = open();
    fireEvent.changeText(screen.getByTestId("room-note-input"), "  Guest requested extra towels  ");
    await act(async () => {
      fireEvent.press(screen.getByTestId("room-note-save"));
      fireEvent.press(screen.getByTestId("room-note-save"));
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/rooms/room-201/notes", { text: "Guest requested extra towels" });
    expect(mockToast.success).not.toHaveBeenCalled();
    await act(async () => resolve({ data: { ok: true } }));
    await flush();
    expect(mockToast.success).toHaveBeenCalledWith("Note saved.");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
  });

  it("never changes the room status: the only write is the note", async () => {
    const { screen } = open();
    fireEvent.changeText(screen.getByTestId("room-note-input"), "Hello");
    await act(async () => fireEvent.press(screen.getByTestId("room-note-save")));
    expect(mockPost.mock.calls.map((c) => c[0])).toEqual(["/rooms/room-201/notes"]);
  });

  it("keeps the text and says nothing was saved when the server refuses (4xx)", async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error("no"), { status: 403 }));
    const { screen } = open();
    fireEvent.changeText(screen.getByTestId("room-note-input"), "Keep me");
    await act(async () => fireEvent.press(screen.getByTestId("room-note-save")));
    expect(screen.getByTestId("room-note-input").props.value).toBe("Keep me");
    expect(screen.getByText("You can't add notes to this room. Your text is kept.")).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("after an unclear outcome it READS the history instead of resending, and does not duplicate", async () => {
    mockPost.mockRejectedValueOnce(new Error("Network request failed"));
    mockGet.mockResolvedValueOnce({
      data: [{ from_status: "DIRTY", to_status: "DIRTY", notes: "Maybe saved", changed_by: "u", created_at: new Date().toISOString() }],
    });
    const { screen } = open();
    fireEvent.changeText(screen.getByTestId("room-note-input"), "Maybe saved");
    await act(async () => fireEvent.press(screen.getByTestId("room-note-save")));
    await flush();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/rooms/room-201/history?limit=50");
    expect(mockToast.success).toHaveBeenCalledWith("Note saved.");
  });

  it("if the read-back finds no note it says so and keeps the text; if the read-back also fails it asks to check again, never resends", async () => {
    mockPost.mockRejectedValueOnce(new Error("timeout"));
    mockGet.mockResolvedValueOnce({ data: [] });
    const first = open();
    fireEvent.changeText(first.screen.getByTestId("room-note-input"), "Lost note");
    await act(async () => fireEvent.press(first.screen.getByTestId("room-note-save")));
    await flush();
    expect(first.screen.getByText("The note was not saved. Your text is kept — you can save it again.")).toBeTruthy();
    expect(first.screen.getByTestId("room-note-input").props.value).toBe("Lost note");
    first.screen.unmount();

    mockPost.mockRejectedValueOnce(new Error("timeout"));
    mockGet.mockRejectedValueOnce(new Error("offline"));
    const second = open();
    fireEvent.changeText(second.screen.getByTestId("room-note-input"), "Unclear note");
    await act(async () => fireEvent.press(second.screen.getByTestId("room-note-save")));
    await flush();
    expect(second.screen.getByText("Check again")).toBeTruthy();
    const postsBefore = mockPost.mock.calls.length;
    mockGet.mockResolvedValueOnce({ data: [] });
    await act(async () => fireEvent.press(second.screen.getByTestId("room-note-save")));
    await flush();
    expect(mockPost.mock.calls.length).toBe(postsBefore);
  });

  it("a paused board keeps the text and blocks the write", async () => {
    const ui = setup(rawRoom("201", "DIRTY"), contextOf({ gate: { allowed: false, blockedBy: "offline" } as MutationGate, live: false }));
    press(ui.screen, "room-detail-more");
    expect(ui.screen.getByTestId("room-action-note").props.accessibilityState.disabled).toBe(true);
  });

  it("a backdrop tap does not throw away a typed note", () => {
    const { screen } = open();
    fireEvent.changeText(screen.getByTestId("room-note-input"), "Typed");
    fireEvent.press(screen.getByTestId("room-detail-backdrop", { includeHiddenElements: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("room-note-input").props.value).toBe("Typed");
  });
});

describe("Cleaning history", () => {
  const session = { id: "s1", status: "completed", clean_type: "DEP", started_at: "2026-10-16T15:11:00Z", ended_at: "2026-10-16T15:42:00Z", duration_seconds: 1860, checklist_done: 12, checklist_total: 12, housekeeper_id: "hk-1" };

  it("loads this room's sessions, shows real values, and opens the session detail with its photos", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/clean-sessions?")) return { data: [session, { ...session, id: "s2", status: "completed", duration_seconds: null, ended_at: "2026-10-15T16:00:00Z", started_at: "2026-10-15T15:30:00Z" }] };
      if (path === "/clean-sessions/s1") return { data: { ...session, checklist: [{ item_id: "a", label: "Beds made", checked: true }], photos: [{ id: "p1", kind: "proof", url: "https://signed.example/x", created_at: session.ended_at }, { id: "p2", kind: "proof", url: "" }] } };
      return { data: [] };
    });
    const { screen } = setup(rawRoom("201", "DIRTY"));
    openAction(screen, "cleaningHistory");
    await flush();
    expect(mockGet).toHaveBeenCalledWith("/clean-sessions?room_id=room-201&limit=50");
    expect(screen.getByText("ROOM 201 · CLEANING HISTORY")).toBeTruthy();
    expect(screen.getByText("TODAY · OCT 16")).toBeTruthy();
    expect(screen.getByText("Completed 10:42 AM")).toBeTruthy();
    expect(screen.getByText("Duration: 31 min")).toBeTruthy();
    expect(screen.getByText("Duration: not recorded")).toBeTruthy();
    expect(screen.getAllByText("Maria Santos").length).toBeGreaterThan(0);

    press(screen, "clean-session-open-s1");
    await flush();
    expect(screen.getByText("Beds made")).toBeTruthy();
    expect(screen.getAllByTestId("clean-photo")).toHaveLength(2);
    expect(screen.getByLabelText("Photo unavailable")).toBeTruthy();
    // an expired link shows the failure and a way to reload, not a blank
    const image = screen.UNSAFE_getAllByType(require("react-native").Image)[0];
    act(() => image.props.onError());
    expect(screen.getByTestId("clean-photo-expired")).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  });

  it("an empty history is a verified empty state; a failed fetch is an error with Try again, never 'empty'", async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const a = setup(rawRoom("201", "DIRTY"));
    openAction(a.screen, "cleaningHistory");
    await flush();
    expect(a.screen.getByText("No cleans recorded")).toBeTruthy();
    a.screen.unmount();

    mockGet.mockRejectedValueOnce(new Error("Network request failed"));
    const b = setup(rawRoom("201", "DIRTY"));
    openAction(b.screen, "cleaningHistory");
    await flush();
    expect(b.screen.queryByText("No cleans recorded")).toBeNull();
    expect(b.screen.getByTestId("panel-error")).toBeTruthy();
    mockGet.mockResolvedValueOnce({ data: [session] });
    await act(async () => fireEvent.press(b.screen.getByTestId("panel-retry")));
    await flush();
    expect(b.screen.getByText("Completed 10:42 AM")).toBeTruthy();
  });

  it("the Activity tab reads the room history only when opened and shows notes and status changes", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/rooms/room-201/history")) {
        return { data: [{ id: "h1", from_status: "DIRTY", to_status: "DIRTY", notes: "Guest wants towels", created_at: "2026-10-16T15:00:00Z", actor_name: "Ben" }, { id: "h2", from_status: "OCCUPIED", to_status: "DIRTY", notes: "Guest checked out|prev_clean_type=DEP", created_at: "2026-10-16T14:00:00Z" }] };
      }
      return { data: [] };
    });
    const { screen } = setup(rawRoom("201", "DIRTY"));
    openAction(screen, "cleaningHistory");
    await flush();
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining("/history"));
    press(screen, "panel-tab-activity");
    await flush();
    expect(screen.getByText("ROOM 201 · ACTIVITY")).toBeTruthy();
    expect(screen.getByText("Guest wants towels")).toBeTruthy();
    expect(screen.queryByText(/prev_clean_type/)).toBeNull();
  });
});

describe("Inspection history", () => {
  it("asks the server for this room only, over hotel-local days, and shows verified summaries", async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        { id: "i1", overall_result: "passed", notes: null, inspector_name: "Dana Cole", completed_at: "2026-10-16T16:06:00Z" },
        { id: "i2", overall_result: "failed", notes: "Bathroom mirror", inspector_name: "a1b2c3d4", completed_at: "2026-10-15T15:42:00Z" },
      ],
    });
    const { screen } = setup(rawRoom("204", "INSPECTED"));
    openAction(screen, "inspectionHistory");
    await flush();
    expect(mockGet).toHaveBeenCalledWith("/housekeeping/inspections?room_id=room-204&date_from=2026-10-10&date_to=2026-10-16");
    expect(screen.getByText("ROOM 204 · INSPECTIONS")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Inspector: Dana Cole")).toBeTruthy();
    expect(screen.getByText("Notes: Bathroom mirror")).toBeTruthy();
    expect(screen.getByText("Inspector not recorded")).toBeTruthy();
  });

  it("a longer range re-queries, and an empty window is honest", async () => {
    mockGet.mockResolvedValue({ data: [] });
    const { screen } = setup(rawRoom("204", "INSPECTED"));
    openAction(screen, "inspectionHistory");
    await flush();
    expect(screen.getByText("No inspections")).toBeTruthy();
    press(screen, "panel-tab-30");
    await flush();
    expect(mockGet).toHaveBeenLastCalledWith("/housekeeping/inspections?room_id=room-204&date_from=2026-09-17&date_to=2026-10-16");
  });
});

describe("Work order detail", () => {
  const woRoom = rawRoom("201", "OOO", { open_work_order_id: "wo-1", open_work_order_title: "Faucet", open_work_order_status: "open" });

  it("reads the work order read-only, with no engineer controls", async () => {
    mockGet.mockResolvedValueOnce({ data: { id: "wo-1", title: "Bathroom faucet leaking", description: "Sink faucet is leaking.", status: "open", priority: "high", room_id: "room-201", work_order_number: "WO-1042", created_at: "2026-10-16T14:42:00Z", assigned_to: null } });
    const { screen } = setup(woRoom);
    press(screen, "room-detail-work-order-open");
    await flush();
    expect(mockGet).toHaveBeenCalledWith("/work-orders/wo-1");
    expect(screen.getByText("ROOM 201 · WORK ORDER")).toBeTruthy();
    expect(screen.getByText("Bathroom faucet leaking")).toBeTruthy();
    expect(screen.getByText("Sink faucet is leaking.")).toBeTruthy();
    expect(screen.queryByText(/claim|start work|complete|mark/i)).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a work order that is gone, closed since, or another room's is never shown as current", async () => {
    mockGet.mockRejectedValueOnce(Object.assign(new Error("nf"), { status: 404 }));
    const gone = setup(woRoom);
    press(gone.screen, "room-detail-work-order-open");
    await flush();
    expect(gone.screen.getByTestId("work-order-gone")).toBeTruthy();
    gone.screen.unmount();

    mockGet.mockResolvedValueOnce({ data: { id: "wo-1", title: "Faucet", status: "completed", priority: "high", room_id: "room-201", completed_at: "2026-10-16T15:00:00Z" } });
    const closed = setup(woRoom);
    press(closed.screen, "room-detail-work-order-open");
    await flush();
    expect(closed.screen.getByTestId("work-order-closed-notice")).toBeTruthy();
    closed.screen.unmount();

    mockGet.mockResolvedValueOnce({ data: { id: "wo-1", title: "Other", status: "open", room_id: "room-999" } });
    const other = setup(woRoom);
    press(other.screen, "room-detail-work-order-open");
    await flush();
    expect(other.screen.getByTestId("work-order-wrong-room")).toBeTruthy();
    expect(other.screen.queryByText("Other")).toBeNull();
  });
});

describe("Wellness drawer follows the live board", () => {
  it("if DND turns off while the drawer is open, the request is disabled and nothing is sent", async () => {
    const dnd = rawRoom("101", "OCCUPIED", { dnd_flag: true });
    const { screen, rerenderWith } = setup(dnd);
    press(screen, "room-detail-wellness");
    rerenderWith(rawRoom("101", "OCCUPIED", { dnd_flag: false }));
    expect(screen.getByText("Do Not Disturb is no longer active for this room.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("room-wellness-request")));
    expect(mockPost).not.toHaveBeenCalled();
    expect(t("roomBoard.panel.wellness.title", { room: "101" })).toBe("ROOM 101 · DND");
  });
});
