import React from "react";
import { Modal } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Room Board screen, Room Detail drawer, assignment panel, picker and controller; only the network, the
   realtime channel and the toast are doubled. Every assertion is about what the supervisor sees or what the
   server was asked to do. */

let mockLanguage: Language = "en";
let mockScheme: "light" | "dark" = "light";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/supabase", () => ({
  supabase: { channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnValue({}) }), removeChannel: jest.fn() },
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/api/housekeepingSupervisor", () => {
  const actual = jest.requireActual("@/lib/api/housekeepingSupervisor");
  return {
    ...actual,
    fetchBoardVerified: jest.fn(),
    fetchAssignableStaff: jest.fn(),
    fetchShiftRoster: jest.fn(),
    fetchInspectionHistory: jest.fn(),
    fetchLateCheckoutsVerified: jest.fn(),
    saveAssignments: jest.fn(),
    removeAssignmentByPlan: jest.fn(),
  };
});
jest.mock("@/lib/api/tasks", () => ({ fetchBlockedTasks: jest.fn() }));

const mockAppState = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchLateCheckoutsVerified,
  fetchShiftRoster,
  removeAssignmentByPlan,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomBoardScreen from "@/app/(app)/room-board/index";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const save = saveAssignments as jest.Mock;
const remove = removeAssignmentByPlan as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;

const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

const ui = () => (
  <ThemeProvider>
    <RoomBoardScreen />
  </ThemeProvider>
);

const rosterRows = (rows: Array<[string, string]> = [["hk-1", "active"], ["hk-2", "active"], ["hk-3", "ended"]]) =>
  rows.map(([user_id, status]) => ({ user_id, status, started_at: new Date().toISOString() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockScheme = "light";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  board.mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  roster.mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  save.mockResolvedValue(undefined);
  remove.mockResolvedValue(true);
});

// The filter drawer keeps a (hidden) Modal mounted; only a VISIBLE one is on screen.
const visibleModals = (screen: ReturnType<typeof render>) => screen.UNSAFE_getAllByType(Modal).filter((modal) => modal.props.visible === true);

const text = (node: { props: { children?: unknown } }) => String(node.props.children);

async function openRoom(number: string) {
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId(`board-tile-${number}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`board-tile-${number}`));
  return screen;
}

async function toReview(screen: ReturnType<typeof render>, userId: string) {
  fireEvent.press(screen.getByTestId("room-detail-primary"));
  fireEvent.press(screen.getByTestId(`picker-${userId}`));
  fireEvent.press(screen.getByTestId("assign-review"));
  await waitFor(() => expect(screen.getByTestId("assign-panel-review")).toBeTruthy());
}

const confirm = async (screen: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId("assign-confirm"));
  });
};

describe("assign a room", () => {
  it("picker → select → review → confirm saves for the HOTEL's date and reports success only after the server confirmed", async () => {
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));

    // The picker is inside the same modal as the room (no stacked modals) and offers on-shift people.
    expect(visibleModals(screen)).toHaveLength(1);
    expect(text(screen.getByTestId("assign-title"))).toBe("ASSIGN ROOM 101");
    expect(screen.getByTestId("picker-hk-1")).toBeTruthy();
    expect(screen.getByTestId("picker-hk-2")).toBeTruthy();
    expect(screen.queryByTestId("picker-hk-3")).toBeNull();

    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(text(screen.getByTestId("assign-title"))).toBe("ASSIGN ROOM 101?");
    expect(text(screen.getByTestId("review-room"))).toBe("101");
    expect(text(screen.getByTestId("review-employee"))).toBe("Ben Ortiz");
    // Nothing has been written by choosing someone.
    expect(save).not.toHaveBeenCalled();

    const loads = board.mock.calls.length;
    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(hotelDateKey(new Date(), "America/Chicago"), [{ room_id: "room-101", housekeeper_id: "hk-2" }]);
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
    expect(mockToast.error).not.toHaveBeenCalled();
    // Back on the room, and the board was read again.
    await waitFor(() => expect(screen.getByTestId("room-detail-sheet")).toBeTruthy());
    expect(board.mock.calls.length).toBeGreaterThan(loads);
  });

  it("shows the selected row with text, not colour alone, and exactly one selection", async () => {
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    expect(screen.getByTestId("picker-hk-2").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("picker-hk-1").props.accessibilityState.selected).toBe(false);
    expect(screen.getByText("Selected")).toBeTruthy();
  });

  it("Review stays disabled until someone is chosen", async () => {
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    expect(screen.getByTestId("assign-review").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    expect(screen.getByTestId("assign-review").props.accessibilityState.disabled).toBe(false);
  });

  it("a double tap on Confirm sends ONE request", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(mockToast.success).toHaveBeenCalledTimes(1);
  });

  it("a rejected save is NOT a success: an inline error, the workflow stays open, and a retry works", async () => {
    save.mockRejectedValueOnce(apiError(422, "bad"));
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    await confirm(screen);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(text(screen.getByTestId("assign-banner").findByProps({ children: tr("roomBoard.assign.error.save_failed") }))).toBe(tr("roomBoard.assign.error.save_failed"));
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();

    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(2);
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });

  it.each([
    [apiError(403, "Forbidden"), "permission"],
    [apiError(404, "Housekeeper not found"), "employee_ineligible"],
    [apiError(404, "Room not found"), "room_unavailable"],
    [apiError(409, "already assigned"), "conflict"],
  ])("%p is explained in plain words (%s)", async (error, key) => {
    save.mockRejectedValueOnce(error);
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    await confirm(screen);
    expect(screen.getByText(tr(`roomBoard.assign.error.${key}`))).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("another supervisor assigned the room while this one was reviewing: nothing is overwritten", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    // The server read made just before the write now shows the room belongs to someone else.
    board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, assigned_to: "hk-1", assignment_id: "as-x" } : row)));
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(tr("roomBoard.assign.error.assignee_changed"))).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("the room started being cleaned meanwhile: the write is refused before it is sent", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, status: "IN_PROGRESS" } : row)));
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(tr("roomBoard.assign.error.not_assignable"))).toBeTruthy();
  });

  it("cannot revalidate (the read fails): it does not write", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    board.mockRejectedValue(new Error("down"));
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(tr("roomBoard.assign.error.revalidate_failed"))).toBeTruthy();
  });

  it("the live board makes the open review stale: a refresh that shows the room being cleaned disables Confirm", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, status: "IN_PROGRESS" } : row)));
    await act(async () => {
      fireEvent.press(screen.getByLabelText(tr("roomBoard.header.refresh")));
    });
    await waitFor(() => expect(screen.getByText(tr("roomBoard.assign.error.in_progress"))).toBeTruthy());
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
  });

  it("an offline phone cannot confirm", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true));
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("a write whose outcome is unclear", () => {
  const networkError = () => new Error("Network request failed");

  it("reads the room back and treats an applied write as success — without writing twice", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    save.mockImplementationOnce(async () => {
      board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, assigned_to: "hk-2", assignment_id: "as-new" } : row)));
      throw networkError();
    });
    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });

  it("reads the room back and reports a write that did not happen as not saved", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    save.mockRejectedValueOnce(networkError());
    await confirm(screen);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByText(tr("roomBoard.assign.error.save_failed"))).toBeTruthy();
  });

  it("when even the read fails it says so and offers only Check again, which never sends a second write", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    let reads = 0;
    save.mockRejectedValueOnce(networkError());
    board.mockImplementation(async () => {
      reads += 1;
      // read #1 revalidates; read #2 (after the failed write) fails.
      if (reads === 1) return hotelBoard();
      throw new Error("down");
    });
    await confirm(screen);
    expect(screen.getByText(tr("roomBoard.assign.error.unknown_outcome"))).toBeTruthy();
    expect(screen.getByText(tr("roomBoard.assign.checkAgain"))).toBeTruthy();

    // The server now shows the write did land.
    board.mockImplementation(async () => hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, assigned_to: "hk-2", assignment_id: "as-new" } : row)));
    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });
});

describe("the write is confirmed but the board cannot refresh", () => {
  it("shows the success, then separately says the board did not refresh", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    let reads = 0;
    board.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return hotelBoard();
      throw apiError(503, "down");
    });
    await confirm(screen);
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith(tr("roomBoard.assign.refreshFailed")));
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
    expect(mockToast.error).not.toHaveBeenCalled();
  });
});

describe("reassign a room", () => {
  it("shows From / To / status / clean type, marks the current assignee, and saves the transfer", async () => {
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-301", clean_type: "DEP", clean_type_label: "Departure" })]);
    const screen = await openRoom("301");
    expect(screen.getByText("Reassign room")).toBeTruthy();
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    expect(text(screen.getByTestId("assign-title"))).toBe("REASSIGN ROOM 301");

    // The current assignee is shown but is not a choice.
    expect(screen.getByTestId("picker-hk-1").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    expect(screen.getByTestId("assign-review").props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(text(screen.getByTestId("assign-title"))).toBe("REASSIGN ROOM 301?");
    expect(text(screen.getByTestId("review-from"))).toBe("Ana Torres");
    expect(text(screen.getByTestId("review-employee"))).toBe("Ben Ortiz");
    expect(text(screen.getByTestId("review-status"))).toBe(tr("roomBoard.statusMeaning.DIRTY"));
    expect(text(screen.getByTestId("review-clean-type"))).toBe("Departure");

    await confirm(screen);
    expect(save).toHaveBeenCalledWith(expect.any(String), [{ room_id: "room-301", housekeeper_id: "hk-2" }]);
    expect(mockToast.success).toHaveBeenCalledWith("Room 301 reassigned to Ben Ortiz.");
  });

  it("another supervisor already moved the room: the reviewed 'From' is no longer true, so nothing is written", async () => {
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-301" })]);
    const screen = await openRoom("301");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "hk-3", assignment_id: "as-301" })]);
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(tr("roomBoard.assign.error.assignee_changed"))).toBeTruthy();
  });

  it("a live update that changes the assignee under an open review disables Confirm and offers Review again", async () => {
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-301" })]);
    const screen = await openRoom("301");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "hk-3", assignment_id: "as-301" })]);
    await act(async () => {
      fireEvent.press(screen.getByLabelText(tr("roomBoard.header.refresh")));
    });
    await waitFor(() => expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true));
    expect(screen.getByText(tr("roomBoard.assign.reviewAgain"))).toBeTruthy();
  });

  it.each([["IN_PROGRESS"], ["CLEAN"], ["INSPECTED"], ["OOO"]])("a %s room offers no reassign, assign or remove", async (status) => {
    board.mockResolvedValue([rawRoom("304", status, { assigned_to: "hk-2", assignment_id: "as-304" })]);
    const screen = await openRoom("304");
    expect(screen.queryByText("Reassign room")).toBeNull();
    expect(screen.queryByTestId("room-detail-change-assignment")).toBeNull();
    expect(screen.queryByTestId("room-action-remove")).toBeNull();
  });
});

describe("remove an assignment", () => {
  const dated = rawRoom("401", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-401" });
  const mirror = rawRoom("402", "DIRTY", { assigned_to: "hk-2", assignment_id: null });

  async function openRemove(number: string) {
    const screen = await openRoom(number);
    fireEvent.press(screen.getByTestId("room-detail-more"));
    fireEvent.press(screen.getByTestId("room-action-remove"));
    return screen;
  }

  it("is a dedicated destructive confirmation that names the room and person and keeps the cleaning status", async () => {
    board.mockResolvedValue([dated]);
    const screen = await openRemove("401");
    expect(text(screen.getByTestId("assign-title"))).toBe("REMOVE ASSIGNMENT?");
    expect(text(screen.getByTestId("remove-body"))).toBe("Room 401 will no longer be assigned to Ana Torres.");
    expect(screen.getByText("The room will return to the unassigned queue.")).toBeTruthy();
    expect(text(screen.getByTestId("remove-status-kept"))).toBe("Its cleaning status will not change.");
    expect(visibleModals(screen)).toHaveLength(1);
    // Opening it removes nothing; dismissing it removes nothing.
    expect(remove).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("remove-cancel"));
    expect(remove).not.toHaveBeenCalled();
    // Back to where it was opened from: the More actions view of the same room.
    expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
  });

  it("removes a dated assignment by its id (never touching clean status or writing an assignment)", async () => {
    board.mockResolvedValue([dated]);
    const screen = await openRemove("401");
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    expect(remove).toHaveBeenCalledWith({ kind: "assignment", assignmentId: "as-401" });
    expect(save).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("Room 401 is now unassigned.");
  });

  it("removes a mirror-only assignment through its room", async () => {
    board.mockResolvedValue([mirror]);
    const screen = await openRemove("402");
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    expect(remove).toHaveBeenCalledWith({ kind: "mirror", roomId: "room-402" });
    expect(mockToast.success).toHaveBeenCalledWith("Room 402 is now unassigned.");
  });

  it("an unnamed assignee is still removable, without inventing a name", async () => {
    (fetchAssignableStaff as jest.Mock).mockRejectedValue(new Error("staff down"));
    board.mockResolvedValue([dated]);
    const screen = await openRemove("401");
    expect(text(screen.getByTestId("remove-body"))).toBe("Room 401 will no longer be assigned.");
  });

  it("a double tap sends one DELETE", async () => {
    board.mockResolvedValue([dated]);
    let finish: (value: boolean) => void = () => undefined;
    remove.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    const screen = await openRemove("401");
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
  });

  it("a failed DELETE is an error, not a success, and keeps the confirmation open", async () => {
    board.mockResolvedValue([dated]);
    remove.mockRejectedValueOnce(apiError(403, "Forbidden"));
    const screen = await openRemove("401");
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByText(tr("roomBoard.assign.error.permission"))).toBeTruthy();
    expect(screen.getByTestId("remove-confirm")).toBeTruthy();
  });

  it("a network failure after sending is checked against the server before anything is claimed", async () => {
    board.mockResolvedValue([dated]);
    remove.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await openRemove("401");
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    // The read-back still shows the assignment: it was NOT removed.
    expect(screen.getByText(tr("roomBoard.assign.error.save_failed"))).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("someone else already removed it: nothing is deleted, and it says so", async () => {
    board.mockResolvedValue([dated]);
    const screen = await openRemove("401");
    board.mockResolvedValue([rawRoom("401", "DIRTY")]);
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    expect(remove).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith("Room 401 is already unassigned.");
  });

  it("is blocked while the board is not live", async () => {
    board.mockResolvedValue([dated]);
    const screen = await openRemove("401");
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("remove-confirm").props.accessibilityState.disabled).toBe(true));
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("availability", () => {
  it("with a verified roster, All staff shows break / ended people with their real state and asks to acknowledge before assigning", async () => {
    roster.mockResolvedValue(rosterRows([["hk-1", "active"], ["hk-2", "on_break"], ["hk-3", "ended"]]));
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    expect(screen.getByTestId("picker-hk-1")).toBeTruthy();
    expect(screen.queryByTestId("picker-hk-2")).toBeNull();
    fireEvent.press(screen.getByTestId("picker-filter-all"));
    expect(text(screen.getByTestId("picker-hk-2-availability"))).toBe("On break");
    expect(text(screen.getByTestId("picker-hk-3-availability"))).toBe("Shift ended");

    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(screen.getByTestId("review-ack")).toBeTruthy();
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("review-ack"));
    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an unavailable roster never claims anyone is on shift, says so, and requires acknowledgement", async () => {
    roster.mockRejectedValue(apiError(403, "Forbidden"));
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    expect(screen.getByTestId("picker-unverified")).toBeTruthy();
    expect(screen.queryByTestId("picker-filter-on_shift")).toBeNull();
    for (const id of ["hk-1", "hk-2", "hk-3"]) expect(text(screen.getByTestId(`picker-${id}-availability`))).toBe("Availability unknown");
    expect(screen.queryByText("On shift")).toBeNull();

    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("review-ack"));
    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a person who went off shift while the review was open must be acknowledged before the write", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    expect(screen.queryByTestId("review-ack")).toBeNull();
    roster.mockResolvedValue(rosterRows([["hk-1", "active"], ["hk-2", "ended"]]));
    await act(async () => {
      fireEvent.press(screen.getByLabelText(tr("roomBoard.header.refresh")));
    });
    await waitFor(() => expect(screen.getByTestId("review-ack")).toBeTruthy());
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
  });

  it("nobody on shift gives an understandable empty state", async () => {
    roster.mockResolvedValue(rosterRows([["hk-1", "ended"], ["hk-2", "ended"], ["hk-3", "ended"]]));
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    expect(text(screen.getByTestId("picker-empty"))).toBe(tr("roomBoard.assign.picker.empty.no_on_shift"));
  });
});

describe("workload in the picker and the review", () => {
  it("shows room count, remaining estimate, and the projected impact of adding the room", async () => {
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    // hk-1 holds 102 (OCCUPIED) and 103 (PICKUP): two rooms, 60 min by room-type minutes.
    expect(screen.getByText("2 rooms · ~60 min remaining")).toBeTruthy();
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(text(screen.getByTestId("review-current"))).toBe("~60 min");
    expect(text(screen.getByTestId("review-room-estimate"))).toBe("~30 min");
    expect(text(screen.getByTestId("review-projected"))).toBe("~90 min");
    expect(screen.getByText("This is an estimate, not a guaranteed completion time.")).toBeTruthy();
  });

  it("omits the projection when the room has no estimate, and says why", async () => {
    const noEstimate = rawRoom("501", "DIRTY");
    noEstimate.rooms = { ...noEstimate.rooms, room_types: { code: "K" } };
    board.mockResolvedValue([noEstimate]);
    const screen = await openRoom("501");
    await toReview(screen, "hk-1");
    expect(screen.queryByTestId("review-projected")).toBeNull();
    expect(screen.getByTestId("review-no-estimate")).toBeTruthy();
  });

  it("flags a person who would be over a full day of work, and does not cap the minutes", async () => {
    const heavy: BoardRoomRaw[] = Array.from({ length: 16 }, (_, i) => rawRoom(`${600 + i}`, "DIRTY", { assigned_to: "hk-1", assignment_id: `as-${i}` }));
    board.mockResolvedValue([rawRoom("101", "DIRTY"), ...heavy]);
    const screen = await openRoom("101");
    await toReview(screen, "hk-1");
    expect(text(screen.getByTestId("review-current"))).toBe("~480 min");
    expect(text(screen.getByTestId("review-projected"))).toBe("~510 min");
    expect(screen.getByTestId("review-overload")).toBeTruthy();
  });
});

describe("navigation inside the one modal", () => {
  it("Android back steps review → picker → room → closed, never leaving a second modal", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    const back = () => act(() => visibleModals(screen)[0].props.onRequestClose());
    back();
    expect(screen.getByTestId("assign-panel-picker")).toBeTruthy();
    expect(visibleModals(screen)).toHaveLength(1);
    back();
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();
    back();
    expect(screen.queryByTestId("room-detail-sheet")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("Cancel on the review returns to the picker with the choice kept out of the way, then to the room", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    fireEvent.press(screen.getByTestId("assign-review-cancel"));
    expect(screen.getByTestId("assign-panel-picker")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assign-cancel"));
    expect(screen.getByTestId("room-detail-sheet")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("back is ignored while a write is in flight (dismissing never abandons or repeats it)", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });
    act(() => visibleModals(screen)[0].props.onRequestClose());
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("switching hotel under an open workflow closes it instead of writing into the wrong property", async () => {
    const screen = await openRoom("101");
    await toReview(screen, "hk-2");
    mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith(tr("roomBoard.assign.scopeChanged")));
    expect(screen.queryByTestId("assign-panel-review")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("search and the board around it", () => {
  it("searches employees by name inside the picker", async () => {
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.changeText(screen.getByTestId("picker-search"), "ben");
    expect(screen.getByTestId("picker-hk-2")).toBeTruthy();
    expect(screen.queryByTestId("picker-hk-1")).toBeNull();
    fireEvent.changeText(screen.getByTestId("picker-search"), "zzz");
    expect(screen.getByTestId("picker-empty")).toBeTruthy();
  });

  it("keeps the board's own search working with the new drawer", async () => {
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("room-board-search"), "104");
    await waitFor(() => expect(screen.queryByTestId("board-tile-101")).toBeNull());
    expect(screen.getByTestId("board-result-104")).toBeTruthy();
  });

  it("renders the workflow in Spanish and in dark mode", async () => {
    mockLanguage = "es";
    mockScheme = "dark";
    const screen = await openRoom("101");
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    expect(text(screen.getByTestId("assign-title"))).toBe("ASIGNAR HABITACIÓN 101");
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(text(screen.getByTestId("assign-title"))).toBe("¿ASIGNAR HABITACIÓN 101?");
    await confirm(screen);
    expect(mockToast.success).toHaveBeenCalledWith("Habitación 101 asignada a Ben Ortiz.");
  });
});
