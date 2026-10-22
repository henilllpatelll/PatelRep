import React from "react";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen, room sheet, single-room assignment flow, picker, review, removal confirmation and
   controller (Assignments V2 phase 4); only the network, the realtime channel, the router and the toast are
   doubled. Every assertion is about what the supervisor sees or what the server was asked to do. */

let mockLanguage: Language = "en";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
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
    fetchWorkloadSettings: jest.fn(),
    fetchScheduledShifts: jest.fn(),
    saveAssignments: jest.fn(),
    removeAssignmentGuarded: jest.fn(),
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

import { supabase } from "@/lib/supabase";
import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchLateCheckoutsVerified,
  fetchScheduledShifts,
  fetchShiftRoster,
  fetchWorkloadSettings,
  removeAssignmentGuarded,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const save = saveAssignments as jest.Mock;
const remove = removeAssignmentGuarded as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const apiError = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const text = (node: { props: { children?: unknown } }) => String(node.props.children);
const today = () => hotelDateKey(new Date(), "America/Chicago");

const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

const rosterRows = (rows: Array<[string, string]> = [["hk-1", "active"], ["hk-2", "active"], ["hk-3", "ended"]]) =>
  rows.map(([user_id, status]) => ({ user_id, status, started_at: new Date().toISOString() }));

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  board.mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  roster.mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (fetchWorkloadSettings as jest.Mock).mockResolvedValue({ targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: {} });
  (fetchScheduledShifts as jest.Mock).mockResolvedValue([]);
  save.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

async function loaded(rooms: BoardRoomRaw[] = hotelBoard()) {
  board.mockResolvedValue(rooms);
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  return screen;
}

/** Room card → picker → pick a person → review. */
async function toReview(screen: ReturnType<typeof render>, roomNumber: string, userId: string, open: "card" | "reassign" = "card") {
  fireEvent.press(screen.getByTestId(`assignment-room-${roomNumber}`));
  if (open === "reassign") fireEvent.press(screen.getByTestId("assignment-sheet-reassign"));
  fireEvent.press(screen.getByTestId(`assign-candidate-${userId}`));
  fireEvent.press(screen.getByTestId("assign-continue"));
  await waitFor(() => expect(screen.getByTestId("assign-panel-review")).toBeTruthy());
}

const confirm = async (screen: ReturnType<typeof render>, id = "assign-confirm") => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};

describe("the picker", () => {
  it("lists eligible people with attendance, current and projected workload", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    expect(text(screen.getByTestId("assign-picker-summary"))).toMatch(/30 min estimated/);
    // On shift is the default pool: hk-3's shift ended, so they are not listed until All staff is chosen.
    expect(screen.getByTestId("assign-candidate-hk-1")).toBeTruthy();
    expect(screen.getByTestId("assign-candidate-hk-2")).toBeTruthy();
    expect(screen.queryByTestId("assign-candidate-hk-3")).toBeNull();
    expect(text(screen.getByTestId("assign-candidate-hk-1-attendance"))).toMatch(/^On shift/);
    expect(text(screen.getByTestId("assign-candidate-hk-1-current"))).toBe("Current remaining: 60 min");
    expect(text(screen.getByTestId("assign-candidate-hk-1-after"))).toBe("After assignment: 90 min");
    fireEvent.press(screen.getByTestId("assign-filter-all"));
    expect(text(screen.getByTestId("assign-candidate-hk-3-attendance"))).toMatch(/^Shift ended/);
    // A person with no rooms is offered, with a real zero.
    expect(text(screen.getByTestId("assign-candidate-hk-3-current"))).toBe("Current remaining: 0 min");
  });

  it("search narrows the list by name", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    fireEvent.changeText(screen.getByTestId("assign-search"), "ben");
    expect(screen.queryByTestId("assign-candidate-hk-1")).toBeNull();
    expect(screen.getByTestId("assign-candidate-hk-2")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("assign-search"), "zzz");
    expect(screen.getByTestId("assign-empty")).toBeTruthy();
  });

  it("an unverified roster lists everyone, labelled unverified, and says so", async () => {
    roster.mockRejectedValue(apiError(403, "Forbidden"));
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    expect(screen.getByTestId("assign-unverified")).toBeTruthy();
    expect(screen.queryByTestId("assign-filter-on_shift")).toBeNull();
    expect(text(screen.getByTestId("assign-candidate-hk-1-attendance"))).toMatch(/^Availability not verified/);
  });

  it("choosing a person never saves, and Continue needs a choice", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    expect(screen.getByTestId("assign-continue").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("assign-candidate-hk-2"));
    expect(screen.getByTestId("assign-continue").props.accessibilityState.disabled).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("reviewing and saving an assignment", () => {
  it("shows the room, the person and the projected workload before anything is saved", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    expect(text(screen.getByTestId("assign-review-room"))).toBe("101");
    expect(text(screen.getByTestId("assign-review-to"))).toBe("Ben Ortiz");
    expect(text(screen.getByTestId("assign-review-to-impact-before"))).toBe("30 min");
    expect(text(screen.getByTestId("assign-review-to-impact-after"))).toBe("60 min");
    expect(screen.getByTestId("assign-review-checked")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("Back returns to the picker with the choice kept", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    fireEvent.press(screen.getByTestId("assign-back-to-picker"));
    expect(screen.getByTestId("assign-panel-picker")).toBeTruthy();
    expect(screen.getByTestId("assign-candidate-hk-2").props.accessibilityState.selected).toBe(true);
  });

  it("a do-not-disturb room needs its own acknowledgement, which the server is told about", async () => {
    const screen = await loaded([rawRoom("101", "DIRTY", { dnd_flag: true }), ...hotelBoard().slice(1)]);
    // A held-back room never offers a plain Assign on its card: the sheet's "Review and assign" opens the picker.
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    fireEvent.press(screen.getByTestId("assignment-sheet-assign"));
    fireEvent.press(screen.getByTestId("assign-candidate-hk-2"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("assign-ack-dnd"));
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(false);
    await confirm(screen);
    expect(save).toHaveBeenCalledWith(today(), [{ room_id: "room-101", housekeeper_id: "hk-2", expect_unassigned: true, acknowledged_blocks: ["dnd"] }], false);
  });

  it("someone whose shift ended needs a person-specific acknowledgement, and it is not sent as a room condition", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    fireEvent.press(screen.getByTestId("assign-filter-all"));
    fireEvent.press(screen.getByTestId("assign-candidate-hk-3"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("assign-ack-shift_ended"));
    await confirm(screen);
    expect(save.mock.calls[0][1]).toEqual([{ room_id: "room-101", housekeeper_id: "hk-3", expect_unassigned: true, acknowledged_blocks: [] }]);
  });

  it("choosing someone else clears acknowledgements that were given for the first person", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    fireEvent.press(screen.getByTestId("assign-filter-all"));
    fireEvent.press(screen.getByTestId("assign-candidate-hk-3"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    fireEvent.press(screen.getByTestId("assign-ack-shift_ended"));
    fireEvent.press(screen.getByTestId("assign-back-to-picker"));
    fireEvent.press(screen.getByTestId("assign-candidate-hk-3"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
  });

  it("a confirmed save shows the verified result and the room moves to its new owner", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    const assigned = hotelBoard();
    assigned[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(assigned);
    await confirm(screen);
    expect(save).toHaveBeenCalledTimes(1);
    expect(text(screen.getByTestId("assign-applied-title"))).toBe("Room 101 assigned");
    expect(text(screen.getByTestId("assign-applied-body"))).toBe("Now assigned to Ben Ortiz.");
    fireEvent.press(screen.getByTestId("assign-done"));
    await waitFor(() => expect(text(screen.getByTestId("assignment-sheet-rows").findByProps({ children: "Ben Ortiz" }) as never)).toBeTruthy());
  });

  it("a successful save whose refresh then fails stays a success, with its own note", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    board.mockRejectedValue(new Error("Network request failed"));
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-refresh-failed")).toBeTruthy());
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("explains that an assigned room left the view it was opened from", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-quick-unassigned"));
    await toReview(screen, "101", "hk-2");
    const assigned = hotelBoard();
    assigned[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(assigned);
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-out-of-view")).toBeTruthy());
  });
});

describe("reassigning", () => {
  it("shows the current and new owner, and the effect on BOTH people's workload", async () => {
    const screen = await loaded();
    await toReview(screen, "102", "hk-2", "reassign");
    expect(text(screen.getByTestId("assign-review-from"))).toBe("Ana Torres");
    expect(text(screen.getByTestId("assign-review-to"))).toBe("Ben Ortiz");
    expect(text(screen.getByTestId("assign-review-from-impact-before"))).toBe("60 min");
    expect(text(screen.getByTestId("assign-review-from-impact-after"))).toBe("30 min");
    expect(text(screen.getByTestId("assign-review-to-impact-before"))).toBe("30 min");
    expect(text(screen.getByTestId("assign-review-to-impact-after"))).toBe("60 min");
  });

  it("sends the owner the supervisor saw as the expected owner", async () => {
    const screen = await loaded();
    await toReview(screen, "102", "hk-2", "reassign");
    await confirm(screen);
    expect(save).toHaveBeenCalledWith(today(), [{ room_id: "room-102", housekeeper_id: "hk-2", expected_assigned_to: "hk-1", acknowledged_blocks: [] }], false);
    expect(mockToast.success).toHaveBeenCalledWith("Room 102 reassigned to Ben Ortiz.");
  });

  it("the room's current owner is shown but cannot be chosen", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    fireEvent.press(screen.getByTestId("assignment-sheet-reassign"));
    expect(text(screen.getByTestId("assign-title"))).toBe("Reassign Room 102");
    fireEvent.press(screen.getByTestId("assign-candidate-hk-1"));
    expect(screen.getByTestId("assign-continue").props.accessibilityState.disabled).toBe(true);
  });

  it("a room being cleaned offers no reassignment at all", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-104"));
    expect(screen.queryByTestId("assignment-sheet-reassign")).toBeNull();
    expect(screen.queryByTestId("assignment-sheet-remove")).toBeNull();
  });
});

describe("conflicts", () => {
  it("a refused save (409) is a conflict view, not a failure toast, and nothing is retried", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(apiError(409, "This room's assignment changed; refresh the board.", "assignment_changed"));
    const taken = hotelBoard();
    taken[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-3", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(taken);
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-panel-conflict")).toBeTruthy());
    expect(text(screen.getByTestId("assign-conflict-previous"))).toBe("Unassigned");
    expect(text(screen.getByTestId("assign-conflict-current"))).toBe("Cara Reyes");
    expect(text(screen.getByTestId("assign-conflict-not-applied"))).toBe("Your change was not applied.");
    // The same Confirm button is gone: pressing it again cannot overwrite the newer owner.
    expect(screen.queryByTestId("assign-confirm")).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("Refresh and review rebuilds the review from the new snapshot, as a reassignment", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(apiError(409, "changed", "assignment_changed"));
    const taken = hotelBoard();
    taken[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-3", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(taken);
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-review-again")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-review-again"));
    });
    await waitFor(() => expect(text(screen.getByTestId("assign-title"))).toBe("Reassign Room 101"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    expect(text(screen.getByTestId("assign-review-from"))).toBe("Cara Reyes");
    await confirm(screen);
    expect(save).toHaveBeenLastCalledWith(today(), [{ room_id: "room-101", housekeeper_id: "hk-2", expected_assigned_to: "hk-3", acknowledged_blocks: [] }], false);
  });

  it("cleaning that starts while the supervisor is reviewing becomes a conflict before any write", async () => {
    const screen = await loaded();
    await toReview(screen, "102", "hk-2", "reassign");
    const started = hotelBoard();
    started[1] = rawRoom("102", "IN_PROGRESS", { fo_status: "OCC", assigned_to: "hk-1", assignment_id: "as-102", assignment_date: today() });
    board.mockResolvedValue(started);
    await act(async () => {
      fireEvent.press(screen.getByTestId("assignments-refresh"));
    });
    await waitFor(() => expect(screen.getByTestId("assign-panel-conflict")).toBeTruthy());
    expect(text(screen.getByTestId("assign-conflict-reason"))).toMatch(/Cleaning has started/);
    expect(save).not.toHaveBeenCalled();
  });

  it("a room that changed hands under the review becomes a conflict before any write", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    const taken = hotelBoard();
    taken[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-3", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(taken);
    await act(async () => {
      fireEvent.press(screen.getByTestId("assignments-refresh"));
    });
    await waitFor(() => expect(screen.getByTestId("assign-panel-conflict")).toBeTruthy());
    expect(text(screen.getByTestId("assign-conflict-current"))).toBe("Cara Reyes");
    expect(save).not.toHaveBeenCalled();
  });

  it("a server that says the acknowledgements changed is also a conflict", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(apiError(409, "needs acknowledgement", "acknowledgement_required"));
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-panel-conflict")).toBeTruthy());
    expect(text(screen.getByTestId("assign-conflict-reason"))).toBe("A condition on this room changed and needs your review.");
  });

  it("a 403 keeps the review open with a plain message and no conflict", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(apiError(403, "Forbidden"));
    await confirm(screen);
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();
    expect(text(screen.getByTestId("assign-banner").findByType(require("react-native").Text))).toBe("Your account can't change room assignments.");
  });
});

describe("removing an assignment", () => {
  it("confirms first, names the owner and what stays, and sends the owner it saw", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    fireEvent.press(screen.getByTestId("assignment-sheet-remove"));
    expect(text(screen.getByTestId("assign-remove-owner"))).toBe("Ana Torres");
    expect(screen.getByTestId("assign-remove-effect-kept")).toBeTruthy();
    expect(text(screen.getByTestId("assign-remove-impact-after"))).toBe("30 min");
    expect(remove).not.toHaveBeenCalled();
    await confirm(screen, "assign-remove-confirm");
    expect(remove).toHaveBeenCalledWith(today(), "room-102", "hk-1");
    expect(screen.getByTestId("assign-applied")).toBeTruthy();
    expect(text(screen.getByTestId("assign-applied-title"))).toBe("Room 102 unassigned");
  });

  it("removes a mirror-only assignment the same way — no assignment id is needed", async () => {
    const mirror = [rawRoom("101", "DIRTY", { assigned_to: "hk-2" }), ...hotelBoard().slice(1)];
    const screen = await loaded(mirror);
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    fireEvent.press(screen.getByTestId("assignment-sheet-remove"));
    expect(screen.getByTestId("assign-remove-owner")).toBeTruthy();
    await confirm(screen, "assign-remove-confirm");
    expect(remove).toHaveBeenCalledWith(today(), "room-101", "hk-2");
  });

  it("a room reassigned by someone else is not removed: the server's 409 is a conflict", async () => {
    remove.mockRejectedValueOnce(apiError(409, "changed", "assignment_changed"));
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    fireEvent.press(screen.getByTestId("assignment-sheet-remove"));
    const taken = hotelBoard();
    taken[1] = rawRoom("102", "OCCUPIED", { fo_status: "OCC", assigned_to: "hk-3", assignment_id: "as-102", assignment_date: today() });
    board.mockResolvedValue(taken);
    await confirm(screen, "assign-remove-confirm");
    await waitFor(() => expect(screen.getByTestId("assign-panel-conflict")).toBeTruthy());
    expect(text(screen.getByTestId("assign-conflict-previous"))).toBe("Ana Torres");
    expect(text(screen.getByTestId("assign-conflict-current"))).toBe("Cara Reyes");
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("a failed removal never reports success", async () => {
    remove.mockRejectedValueOnce(apiError(403, "Forbidden"));
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    fireEvent.press(screen.getByTestId("assignment-sheet-remove"));
    await confirm(screen, "assign-remove-confirm");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("assign-panel-remove")).toBeTruthy();
  });

  it("a room being cleaned has no removal to confirm", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-104"));
    expect(screen.queryByTestId("assignment-sheet-remove")).toBeNull();
  });
});

describe("when the outcome of a write is unclear", () => {
  const networkError = () => new Error("Network request failed");

  it("a timeout followed by a confirmed write is reported as saved — without sending the write again", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(networkError());
    const assigned = hotelBoard();
    assigned[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(assigned);
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-applied")).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });

  it("a timeout followed by no write is a verified failure the supervisor may deliberately retry", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(networkError());
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-banner")).toBeTruthy());
    expect(text(screen.getByTestId("assign-banner").findByType(require("react-native").Text))).toMatch(/wasn't saved/);
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an unreadable room after a timeout says 'Checking assignment result'; Check result only ever reads", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(networkError());
    board.mockRejectedValue(networkError());
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-panel-unknown")).toBeTruthy());
    expect(text(screen.getByTestId("assign-unknown-title"))).toBe("Checking assignment result");
    expect(mockToast.success).not.toHaveBeenCalled();

    // Still unreadable: still unknown, and nothing is written.
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-check-result"));
    });
    expect(screen.getByTestId("assign-still-unknown")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-check-result"));
    });
    expect(save).toHaveBeenCalledTimes(1);

    // The server finally answers, and the write had happened.
    const assigned = hotelBoard();
    assigned[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(assigned);
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-check-result"));
    });
    await waitFor(() => expect(screen.getByTestId("assign-applied")).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an unclear result is not discarded by a tap beside the sheet", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    save.mockRejectedValueOnce(networkError());
    board.mockRejectedValue(networkError());
    await confirm(screen);
    await waitFor(() => expect(screen.getByTestId("assign-panel-unknown")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignment-sheet-backdrop", { hidden: true }));
    expect(screen.getByTestId("assign-panel-unknown")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assign-unknown-close"));
    expect(screen.queryByTestId("assign-panel-unknown")).toBeNull();
  });

  it("a double press while the write is in flight sends it once", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
      fireEvent.press(screen.getByTestId("assign-confirm"));
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    // The sheet cannot be dismissed while the write is in flight.
    fireEvent.press(screen.getByTestId("assign-close"));
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();
    await act(async () => finish());
    expect(screen.getByTestId("assign-applied")).toBeTruthy();
  });
});

describe("scope and connectivity", () => {
  it("another hotel closes an open review instead of writing into it", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.queryByTestId("assign-panel-review")).toBeNull());
    expect(mockToast.info).toHaveBeenCalledWith(tr("assignments.v2.assign.scopeChanged"));
    expect(save).not.toHaveBeenCalled();
  });

  it("going offline mid-review pauses Confirm", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true));
    await confirm(screen);
    expect(save).not.toHaveBeenCalled();
  });

  it("opening the flow adds no realtime channel and no second board fetch path", async () => {
    const screen = await loaded();
    const channels = (supabase.channel as jest.Mock).mock.calls.length;
    await toReview(screen, "101", "hk-2");
    fireEvent.press(screen.getByTestId("assign-back-to-picker"));
    fireEvent.press(screen.getByTestId("assign-cancel"));
    expect((supabase.channel as jest.Mock).mock.calls.length).toBe(channels);
  });
});

describe("from the Team tab", () => {
  it("'Assign more rooms' → choose a room → review with the person already chosen → confirm", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(screen.getByTestId("team-card-hk-3")).toBeTruthy());
    fireEvent.press(screen.getByTestId("team-card-hk-3"));
    fireEvent.press(screen.getByTestId("team-detail-assign-more"));
    expect(text(screen.getByTestId("assign-chooser-title"))).toBe("Assign a room to Cara Reyes");
    // Only unowned rooms that can still be assigned are offered.
    expect(screen.getByTestId("assign-chooser-room-101")).toBeTruthy();
    expect(screen.queryByTestId("assign-chooser-room-102")).toBeNull();
    expect(screen.queryByTestId("assign-chooser-room-104")).toBeNull();
    fireEvent.press(screen.getByTestId("assign-chooser-room-101"));
    await waitFor(() => expect(screen.getByTestId("assign-panel-review")).toBeTruthy());
    expect(text(screen.getByTestId("assign-review-to"))).toBe("Cara Reyes");
    // Cara's shift ended, so the same acknowledgement as everywhere else applies.
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("assign-ack-shift_ended"));
    await confirm(screen);
    expect(save).toHaveBeenCalledWith(today(), [{ room_id: "room-101", housekeeper_id: "hk-3", expect_unassigned: true, acknowledged_blocks: [] }], false);
  });

  it("closing the chooser returns to the person's drawer", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(screen.getByTestId("team-card-hk-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("team-card-hk-1"));
    fireEvent.press(screen.getByTestId("team-detail-assign-more"));
    expect(screen.queryByTestId("team-detail-sheet")).toBeNull();
    fireEvent.press(screen.getByTestId("assign-chooser-close"));
    expect(screen.getByTestId("team-detail-sheet")).toBeTruthy();
  });

  it("Rooms and Team agree after an assignment", async () => {
    const screen = await loaded();
    await toReview(screen, "101", "hk-2");
    const assigned = hotelBoard();
    assigned[0] = rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-101", assignment_date: today() });
    board.mockResolvedValue(assigned);
    await confirm(screen);
    fireEvent.press(screen.getByTestId("assign-done"));
    fireEvent.press(screen.getByTestId("assignment-sheet-close"));
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(text(screen.getByTestId("team-card-stats-hk-2"))).toMatch(/^3 rooms/));
  });
});

describe("Spanish", () => {
  it("the whole flow reads in Spanish", async () => {
    mockLanguage = "es";
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    expect(text(screen.getByTestId("assign-title"))).toBe("Asignar habitación 101");
    fireEvent.press(screen.getByTestId("assign-candidate-hk-2"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    expect(text(screen.getByTestId("assign-review-checked"))).toMatch(/Esta asignación se comprobará/);
  });
});
