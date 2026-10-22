import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen with bulk selection, the allocation drawer, the draft indicator, the draft review,
   the editor and the atomic publication (Assignments V2 phase 5); only the network, the realtime channel, the
   router and the toast are doubled. Every assertion is about what the supervisor sees or what the server was asked
   to do. The legacy `saveAssignments` must never be called by this workflow. */

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
    publishAssignmentBatch: jest.fn(),
    fetchBatchPublication: jest.fn(),
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
  fetchBatchPublication,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchLateCheckoutsVerified,
  fetchScheduledShifts,
  fetchShiftRoster,
  fetchWorkloadSettings,
  publishAssignmentBatch,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { readPending } from "@/lib/housekeeping/publishJournal";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { STAFF } from "../helpers/roomBoardFixtures";
import { bulkBoard, room } from "../helpers/bulkFixtures";

const board = fetchBoardVerified as jest.Mock;
const publish = publishAssignmentBatch as jest.Mock;
const check = fetchBatchPublication as jest.Mock;
const legacySave = saveAssignments as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const text = (node: { props: { children?: unknown } }) => String(node.props.children);
/** All the text under a rendered element (a notice holds an icon and a text). */
const flat = (instance: { children?: unknown[] }): string => (instance.children ?? []).map((child) => (typeof child === "string" ? child : flat(child as { children?: unknown[] }))).join("");
const apiError = (status: number, detail?: unknown) => Object.assign(new Error("x"), { status, detail });
const today = () => hotelDateKey(new Date(), "America/Chicago");

const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

/** The bulk hotel with its dated owner rows pinned to the real hotel "today". */
const hotel = (extra: (raw: BoardRoomRaw) => BoardRoomRaw = (raw) => raw): BoardRoomRaw[] =>
  bulkBoard().map((raw) => extra(raw.assignment_date ? { ...raw, assignment_date: today() } : raw));

const rosterRows = (rows: Array<[string, string]> = [["hk-1", "active"], ["hk-2", "active"], ["hk-3", "active"]]) =>
  rows.map(([user_id, status]) => ({ user_id, status, started_at: new Date().toISOString() }));

type Req = { operation_id: string; date: string; changes: { room_id: string; kind: string; housekeeper_id?: string; expected_assigned_to?: string }[] };
const committedFor = (request: Req, replayed = false) => {
  const rooms = request.changes.map((c) => ({ room_id: c.room_id, room_number: c.room_id.replace("room-", ""), kind: c.kind, previous_assigned_to: c.expected_assigned_to ?? null, assigned_to: c.housekeeper_id ?? null }));
  return {
    operation_id: request.operation_id,
    status: "committed",
    assignment_date: request.date,
    counts: { total: rooms.length, assign: rooms.filter((r) => r.kind === "assign").length, reassign: rooms.filter((r) => r.kind === "reassign").length, remove: rooms.filter((r) => r.kind === "remove").length },
    rooms,
    affected_room_ids: rooms.map((r) => r.room_id),
    affected_housekeeper_ids: [...new Set(rooms.map((r) => r.assigned_to).filter(Boolean))],
    replayed,
  };
};

configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLanguage = "en";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  board.mockResolvedValue(hotel());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  (fetchShiftRoster as jest.Mock).mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (fetchWorkloadSettings as jest.Mock).mockResolvedValue({ targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: {} });
  (fetchScheduledShifts as jest.Mock).mockResolvedValue([]);
  publish.mockImplementation(async (request: Req) => committedFor(request));
  check.mockResolvedValue({ status: "not_found" });
});

afterEach(() => {
  expect(legacySave).not.toHaveBeenCalled(); // the bulk workflow never uses the non-atomic endpoint
});

async function loaded(rooms: BoardRoomRaw[] = hotel()) {
  board.mockResolvedValue(rooms);
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  return screen;
}

const startSelecting = async (screen: ReturnType<typeof render>) => {
  fireEvent.press(screen.getByTestId("bulk-select-rooms"));
  await waitFor(() => expect(screen.getByTestId("bulk-bar")).toBeTruthy());
};
const pick = (screen: ReturnType<typeof render>, ...numbers: string[]) => numbers.forEach((number) => fireEvent.press(screen.getByTestId(`bulk-row-${number}`)));
const summary = (screen: ReturnType<typeof render>) => screen.getByTestId("bulk-footer-summary").props.accessibilityLabel as string;

/** Select rooms → allocate to one person → review. */
async function toReview(screen: ReturnType<typeof render>, numbers: string[], userId = "hk-2") {
  await startSelecting(screen);
  pick(screen, ...numbers);
  fireEvent.press(screen.getByTestId("bulk-assign"));
  fireEvent.press(screen.getByTestId(`bulk-candidate-${userId}`));
  fireEvent.press(screen.getByTestId("bulk-allocate-review"));
  await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
}

const press = async (screen: ReturnType<typeof render>, id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};

describe("selection mode", () => {
  it("starts from a visible entry on the Rooms view and shows the bar, rows and a footer that never scrolls away", async () => {
    const screen = await loaded();
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    await startSelecting(screen);
    expect(screen.getByTestId("bulk-footer")).toBeTruthy();
    expect(screen.getByTestId("bulk-row-101").props.accessibilityRole).toBe("checkbox");
    expect(text(screen.getByTestId("bulk-counts"))).toBe("0 selected · 3 blocked");
    expect(screen.getByTestId("bulk-footer-empty")).toBeTruthy();
    expect(screen.getByTestId("bulk-assign").props.accessibilityState.disabled).toBe(true);
  });

  it("selects and deselects one eligible room, with a spoken state and a running estimate", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101");
    expect(screen.getByTestId("bulk-row-101").props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("bulk-row-101").props.accessibilityLabel).toMatch(/Selected/);
    expect(summary(screen)).toBe("1 room selected. 30 min estimated");
    pick(screen, "101");
    expect(screen.getByTestId("bulk-row-101").props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("bulk-footer-empty")).toBeTruthy();
  });

  it("never selects a blocked room, and says why", async () => {
    // A small hotel: the test renderer only draws the first few list rows.
    const screen = await loaded(["101", "104", "105", "106", "107"].map((n) => hotel().find((raw) => raw.rooms?.room_number === n)!));
    await startSelecting(screen);
    for (const number of ["104", "105", "106", "107"]) {
      const row = screen.getByTestId(`bulk-row-${number}`);
      expect(row.props.accessibilityState).toMatchObject({ checked: false, disabled: true });
      fireEvent.press(row);
    }
    expect(text(screen.getByTestId("bulk-counts"))).toBe("0 selected · 3 blocked");
    expect(flat(screen.getByTestId("bulk-row-reason-104"))).toMatch(/Do not disturb/i);
    expect(flat(screen.getByTestId("bulk-row-reason-107"))).toBe("Assigned to Ana Torres");
    expect(flat(screen.getByTestId("bulk-notice"))).toBe("Room 107 can't be selected in bulk.");
  });

  it("Select all takes only the eligible rooms that match the current filters", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    fireEvent.press(screen.getByTestId("bulk-select-all"));
    expect(summary(screen)).toMatch(/^7 rooms selected\. At least \d+ min estimated$/); // 103 has no estimate: a lower bound, never zero
    // The allocation drawer lists exactly what was taken: the eligible rooms, none of the blocked or owned ones.
    fireEvent.press(screen.getByTestId("bulk-assign"));
    expect(text(screen.getByTestId("bulk-allocate-rooms")).split(", ").sort()).toEqual(["101", "102", "103", "201", "202", "301", "302"]);
  });

  it("selects a whole floor or building from hotel data, not from hard-coded names", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    fireEvent.press(screen.getByTestId("bulk-scope-floor:A|2"));
    expect(summary(screen)).toMatch(/^2 rooms selected/);
    expect(screen.getByTestId("bulk-scope-floor:A|2").props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId("bulk-scope-building:B"));
    expect(summary(screen)).toMatch(/^4 rooms selected/);
    fireEvent.press(screen.getByTestId("bulk-scope-floor:A|2")); // pressing again clears just that floor
    expect(summary(screen)).toMatch(/^2 rooms selected/);
    expect(screen.getByTestId("bulk-row-301").props.accessibilityState.checked).toBe(true);
  });

  it("keeps the selection while the list is searched, and cancelling empties it", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "201");
    fireEvent.changeText(screen.getByTestId("assignments-search"), "301");
    await waitFor(() => expect(screen.queryByTestId("bulk-row-101")).toBeNull());
    expect(summary(screen)).toMatch(/^2 rooms selected/);
    fireEvent.press(screen.getByTestId("bulk-cancel"));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryByTestId("bulk-footer")).toBeNull();
    await startSelecting(screen);
    expect(screen.getByTestId("bulk-footer-empty")).toBeTruthy();
  });

  it("flags a selected room that stopped being eligible and leaves it out of the assignment", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "102");
    // Cleaning starts in 101; the next refresh brings that board.
    board.mockResolvedValue(hotel((raw) => (raw.room_id === "room-101" ? room("101", "IN_PROGRESS") : raw)));
    await act(async () => {
      await screen.getByTestId("assignments-list").props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId("bulk-invalid")).toBeTruthy());
    expect(summary(screen)).toBe("1 room selected. 30 min estimated");
    fireEvent.press(screen.getByTestId("bulk-assign"));
    expect(text(screen.getByTestId("bulk-allocate-title"))).toBe("Assign 1 room");
    expect(flat(screen.getByTestId("bulk-allocate-invalid"))).toBe("1 selected room is left out because it is no longer available.");
  });
});

describe("allocating the selection", () => {
  it("opens a drawer that chooses nobody for you, and keeps Review off until someone is chosen", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "102");
    fireEvent.press(screen.getByTestId("bulk-assign"));
    expect(text(screen.getByTestId("bulk-allocate-title"))).toBe("Assign 2 rooms");
    expect(text(screen.getByTestId("bulk-allocate-rooms"))).toBe("101, 102");
    expect(text(screen.getByTestId("bulk-allocate-estimate"))).toBe("Estimated total: 60 min estimated");
    expect(screen.getByTestId("bulk-candidate-hk-1").props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByTestId("bulk-allocate-review").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("bulk-candidate-hk-2"));
    expect(screen.getByTestId("bulk-allocate-review").props.accessibilityState.disabled).toBe(false);
    expect(publish).not.toHaveBeenCalled(); // nothing is written by choosing
  });

  it("one housekeeper: shows their attendance, current workload and what they would have after all the rooms", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "102");
    fireEvent.press(screen.getByTestId("bulk-assign"));
    const label = screen.getByTestId("bulk-candidate-hk-2").props.accessibilityLabel as string;
    expect(label).toMatch(/Ben Ortiz/);
    expect(label).toMatch(/On shift/);
    expect(label).toMatch(/After all 2 rooms: 60 min/);
  });

  it("Distribute across team: needs people chosen, proposes a split the supervisor can see", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "102", "201", "202");
    fireEvent.press(screen.getByTestId("bulk-assign"));
    fireEvent.press(screen.getByTestId("bulk-mode-distribute"));
    expect(screen.getByTestId("bulk-allocate-review").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("bulk-candidate-hk-2"));
    fireEvent.press(screen.getByTestId("bulk-candidate-hk-3"));
    const preview = screen.getByTestId("bulk-allocate-preview");
    expect(preview).toBeTruthy();
    expect(text(screen.getByTestId("bulk-preview-hk-2"))).toMatch(/Ben Ortiz · 2 rooms/);
    expect(text(screen.getByTestId("bulk-preview-hk-3"))).toMatch(/Cara Reyes · 2 rooms/);
  });

  it("Add to draft keeps selecting and shows the unpublished-changes indicator; nothing is published", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "102");
    fireEvent.press(screen.getByTestId("bulk-add-to-draft"));
    fireEvent.press(screen.getByTestId("bulk-candidate-hk-3"));
    fireEvent.press(screen.getByTestId("bulk-allocate-stage"));
    await waitFor(() => expect(screen.queryByTestId("bulk-allocate-title")).toBeNull());
    expect(screen.getByTestId("bulk-draft-indicator").props.accessibilityLabel).toBe("2 unpublished changes");
    expect(screen.getByTestId("bulk-footer-empty")).toBeTruthy(); // the staged rooms left the selection
    expect(text(screen.getByTestId("bulk-row-draft-101"))).toBe("In draft · Cara Reyes");
    expect(publish).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("2 rooms added to the draft.");
  });
});

describe("the draft review", () => {
  it("compares CURRENT with PROPOSED per person, in the future tense, before anything is published", async () => {
    const screen = await loaded();
    await toReview(screen, ["101", "102"]);
    expect(text(screen.getByTestId("bulk-review-title"))).toBe("Review 2 assignments");
    expect(text(screen.getByTestId("bulk-review-notpublished"))).toBeTruthy();
    expect(text(screen.getByTestId("bulk-review-current-hk-2"))).toBe("0 min");
    expect(text(screen.getByTestId("bulk-review-proposed-hk-2"))).toBe("60 min");
    expect(text(screen.getByTestId("bulk-review-add-101"))).toMatch(/^\+ Room 101/);
    expect(text(screen.getByTestId("bulk-review-conflicts"))).toBe("No blocking conflicts");
    expect(screen.getByTestId("bulk-validation-rooms_eligible")).toBeTruthy();
    expect(screen.getByTestId("bulk-publish").props.accessibilityState.disabled).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("requires an explicit acknowledgement for someone not verified on shift", async () => {
    (fetchShiftRoster as jest.Mock).mockResolvedValue(rosterRows([["hk-1", "active"], ["hk-2", "on_break"], ["hk-3", "active"]]));
    const screen = await loaded();
    await toReview(screen, ["101"], "hk-2");
    expect(screen.getByTestId("bulk-publish").props.accessibilityState.disabled).toBe(true);
    expect(text(screen.getByTestId("bulk-review-blocker"))).toBe("Confirm the items above to publish.");
    fireEvent.press(screen.getByTestId("bulk-ack-hk-2-on_break"));
    expect(screen.getByTestId("bulk-publish").props.accessibilityState.disabled).toBe(false);
  });

  it("the editor changes the DRAFT only: remove a room, see the projected workload follow", async () => {
    const screen = await loaded();
    await toReview(screen, ["101", "102"]);
    fireEvent.press(screen.getByTestId("bulk-review-edit-hk-2"));
    expect(text(screen.getByTestId("bulk-edit-projected"))).toBe("60 min");
    fireEvent.press(screen.getByTestId("bulk-edit-remove-101"));
    expect(text(screen.getByTestId("bulk-edit-projected"))).toBe("30 min");
    fireEvent.press(screen.getByTestId("bulk-edit-save"));
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    expect(text(screen.getByTestId("bulk-review-title"))).toBe("Review 1 assignment");
    expect(publish).not.toHaveBeenCalled();
  });

  it("the editor can move a room to someone else and add another eligible room", async () => {
    const screen = await loaded();
    await toReview(screen, ["101"]);
    fireEvent.press(screen.getByTestId("bulk-review-edit-hk-2"));
    fireEvent.press(screen.getByTestId("bulk-edit-add"));
    fireEvent.press(screen.getByTestId("bulk-edit-add-202"));
    expect(text(screen.getByTestId("bulk-edit-projected"))).toBe("60 min");
    fireEvent.press(screen.getByTestId("bulk-edit-move-202"));
    fireEvent.press(screen.getByTestId("bulk-edit-move-to-hk-3"));
    expect(text(screen.getByTestId("bulk-edit-projected"))).toBe("30 min");
    fireEvent.press(screen.getByTestId("bulk-edit-save"));
    await waitFor(() => expect(screen.getByTestId("bulk-review-employee-hk-3")).toBeTruthy());
  });

  it("discarding asks first and then throws the whole draft away", async () => {
    const screen = await loaded();
    await toReview(screen, ["101", "102"]);
    fireEvent.press(screen.getByTestId("bulk-review-discard"));
    expect(screen.getByTestId("bulk-discard")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bulk-discard-keep"));
    expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bulk-review-discard"));
    fireEvent.press(screen.getByTestId("bulk-discard-confirm"));
    await waitFor(() => expect(screen.queryByTestId("bulk-sheet")).toBeNull());
    expect(screen.queryByTestId("bulk-draft-indicator")).toBeNull();
  });
});

describe("publishing", () => {
  it("sends ONE atomic request carrying the reviewed owners, then reports the SERVER's counts", async () => {
    const screen = await loaded();
    await toReview(screen, ["101", "102"]);
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(1);
    const request = publish.mock.calls[0][0] as Req;
    expect(request.date).toBe(today());
    expect(request.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.changes).toEqual([
      { room_id: "room-101", kind: "assign", housekeeper_id: "hk-2", expect_unassigned: true },
      { room_id: "room-102", kind: "assign", housekeeper_id: "hk-2", expect_unassigned: true },
    ]);
    expect(text(screen.getByTestId("bulk-committed-total"))).toBe("2 changes confirmed");
    expect(text(screen.getByTestId("bulk-committed-assign"))).toBe("2 new assignments");
    expect(await readPending("h1:sup-1")).toBeNull();
    expect(board.mock.calls.length).toBeGreaterThan(1); // the shared snapshot was refreshed
  });

  it("a double tap cannot send twice", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    publish.mockImplementation((request: Req) => gate.then(() => committedFor(request)));
    const screen = await loaded();
    await toReview(screen, ["101"]);
    await act(async () => {
      fireEvent.press(screen.getByTestId("bulk-publish"));
      fireEvent.press(screen.getByTestId("bulk-publish"));
    });
    expect(screen.getByTestId("bulk-publishing")).toBeTruthy();
    await act(async () => {
      open();
    });
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("'Return to Rooms' leaves selection mode with the draft gone and the board refreshed", async () => {
    const screen = await loaded();
    await toReview(screen, ["101"]);
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    fireEvent.press(screen.getByTestId("bulk-committed-return"));
    await waitFor(() => expect(screen.queryByTestId("bulk-sheet")).toBeNull());
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryByTestId("bulk-draft-indicator")).toBeNull();
  });

  it("a refresh that fails after a verified commit is reported separately, never as a failed publication", async () => {
    const screen = await loaded();
    await toReview(screen, ["101"]);
    board.mockRejectedValue(new Error("offline"));
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("bulk-committed-refresh-failed")).toBeTruthy());
    expect(screen.queryByTestId("bulk-rejected")).toBeNull();
  });

  it("a conflict publishes NOTHING, names the rooms, keeps the draft, and requires a fresh review", async () => {
    publish.mockRejectedValueOnce(
      apiError(409, { code: "assignment_batch_conflict", applied: false, conflicts: [{ room_id: "room-101", room_number: "101", code: "assignment_changed", current_assigned_to: "hk-3" }, { room_id: "room-102", code: "room_not_assignable" }] }),
    );
    const screen = await loaded();
    await toReview(screen, ["101", "102"]);
    // Between review and publish somebody else took room 101 and cleaning started in 102.
    board.mockResolvedValue(hotel((raw) => (raw.room_id === "room-101" ? room("101", "DIRTY", { owner: "hk-3" }) : raw.room_id === "room-102" ? room("102", "IN_PROGRESS") : raw)));
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-rejected")).toBeTruthy());
    expect(text(screen.getByTestId("bulk-conflict-room-101"))).toBe("Room 101 · now assigned to Cara Reyes");
    expect(text(screen.getByTestId("bulk-conflict-room-102"))).toBe("Room 102 · cleaning has started or the room is closed");
    expect(text(screen.getByTestId("bulk-rejected-none"))).toBe("No changes from this batch were published.");
    // Refresh and review: re-planned against the new owner, the started room dropped, and Publish is NOT automatic.
    await press(screen, "bulk-conflict-refresh");
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    expect(flat(screen.getByTestId("bulk-review-rebased"))).toBe("After refreshing: 1 updated, 1 removed. Review these changes again before publishing.");
    expect(text(screen.getByTestId("bulk-review-title"))).toBe("Review 1 assignment");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("an unclear outcome is checked read-only: 'Checking publication result', then the server's answer", async () => {
    let asked: Req | null = null;
    publish.mockImplementation(async (request: Req) => {
      asked = request;
      throw new Error("Network request failed");
    });
    check.mockImplementation(async () => ({ status: "committed", result: committedFor(asked!, true) }));
    const screen = await loaded();
    await toReview(screen, ["101"]);
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(1); // never re-sent
    expect(check).toHaveBeenCalledWith(asked!.operation_id);
  });

  it("when the check cannot reach the server the outcome stays unknown, the draft is locked, and nothing else can be published", async () => {
    publish.mockRejectedValue(new Error("Network request failed"));
    check.mockRejectedValue(new Error("offline"));
    const screen = await loaded();
    await toReview(screen, ["101"]);
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-unknown")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("bulk-unknown-check")).toBeTruthy());
    expect(screen.queryByTestId("bulk-unknown-send-again")).toBeNull(); // not proven unpublished
    expect(screen.getByTestId("bulk-unknown-check")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bulk-unknown-close"));
    await waitFor(() => expect(screen.queryByTestId("bulk-sheet")).toBeNull());
    expect(screen.getByTestId("bulk-draft-indicator").props.accessibilityLabel).toBe("Publication status unknown");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("'not published yet' allows trying again with the SAME operation", async () => {
    publish.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await loaded();
    await toReview(screen, ["101"]);
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-unknown-send-again")).toBeTruthy());
    await press(screen, "bulk-unknown-send-again");
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0]).toEqual(publish.mock.calls[0][0]);
  });

  it("offline: Publish is off, the reason is written, and nothing is queued", async () => {
    const screen = await loaded();
    await toReview(screen, ["101"]);
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("bulk-publish").props.accessibilityState.disabled).toBe(true));
    expect(flat(screen.getByTestId("bulk-review-paused"))).toBe("You are offline. Publishing needs a fresh connection.");
    fireEvent.press(screen.getByTestId("bulk-publish"));
    expect(publish).not.toHaveBeenCalled();
  });

  it("switching hotel discards the draft instead of carrying it over", async () => {
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101");
    fireEvent.press(screen.getByTestId("bulk-add-to-draft"));
    fireEvent.press(screen.getByTestId("bulk-candidate-hk-2"));
    fireEvent.press(screen.getByTestId("bulk-allocate-stage"));
    await waitFor(() => expect(screen.getByTestId("bulk-draft-indicator")).toBeTruthy());
    mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.queryByTestId("bulk-draft-indicator")).toBeNull());
    expect(mockToast.info).toHaveBeenCalledWith("You switched hotel or account, so your unpublished draft was discarded.");
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("the Team tab while a draft exists", () => {
  it("keeps the LIVE workload and adds the proposed one beside it", async () => {
    const screen = await loaded();
    await toReview(screen, ["101", "102"]);
    fireEvent.press(screen.getByTestId("bulk-review-back")); // close the sheet; the draft stays
    await waitFor(() => expect(screen.queryByTestId("bulk-sheet")).toBeNull());
    fireEvent.press(screen.getByTestId("bulk-cancel"));
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(screen.getByTestId("team-card-hk-2")).toBeTruthy());
    expect(screen.getByTestId("team-card-proposed-hk-2").props.accessibilityLabel).toBe("Proposed after draft: 60 min");
    expect(screen.getByTestId("team-card-hk-2").props.accessibilityLabel).toMatch(/Proposed after draft: 60 min/);
    expect(screen.queryByTestId("team-card-proposed-hk-1")).toBeNull();
  });
});

describe("Spanish", () => {
  it("the selection bar, drawer and review read in Spanish with no raw keys", async () => {
    mockLanguage = "es";
    const screen = await loaded();
    await startSelecting(screen);
    pick(screen, "101", "102");
    expect(text(screen.getByTestId("bulk-counts"))).toBe("2 seleccionadas · 3 bloqueadas");
    fireEvent.press(screen.getByTestId("bulk-assign"));
    fireEvent.press(screen.getByTestId("bulk-candidate-hk-2"));
    fireEvent.press(screen.getByTestId("bulk-allocate-review"));
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    expect(text(screen.getByTestId("bulk-review-title"))).toBe("Revisar 2 asignaciones");
    expect(flat(screen.UNSAFE_root as never)).not.toMatch(/assignments\.v2\.bulk/);
    expect(tr("assignments.v2.bulk.review.title", { count: 2 })).toBe("Review 2 assignments");
  });
});
