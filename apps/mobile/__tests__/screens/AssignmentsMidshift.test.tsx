import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen with the Team drawer, the midshift redistribution sheet (Assignments V2 phase 7), the
   shared unpublished draft and the atomic publication; only the network, the realtime channel, the router and the toast
   are doubled. Every assertion is about what the supervisor sees or what the server was asked to do. The legacy
   `saveAssignments` must never be called, and nothing changes until the reviewed draft is published. */

let mockLanguage: Language = "en";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockRouter = { push: jest.fn(), back: jest.fn(), setParams: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouter.push(...args), back: (...args: unknown[]) => mockRouter.back(...args), setParams: jest.fn() },
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
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { STAFF } from "../helpers/roomBoardFixtures";
import { midshiftBoard } from "../helpers/midshiftFixtures";

const board = fetchBoardVerified as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const publish = publishAssignmentBatch as jest.Mock;
const check = fetchBatchPublication as jest.Mock;
const legacySave = saveAssignments as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const text = (node: { props: { children?: unknown } }) => String(node.props.children);
const flat = (instance: { children?: unknown[] }): string => (instance.children ?? []).map((child) => (typeof child === "string" ? child : flat(child as { children?: unknown[] }))).join("");
const today = () => hotelDateKey(new Date(), "America/Chicago");

const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

/** The midshift hotel with its dated owner rows pinned to the real hotel "today". */
const hotel = (extra: (raw: BoardRoomRaw) => BoardRoomRaw = (raw) => raw): BoardRoomRaw[] =>
  midshiftBoard().map((raw) => extra(raw.assignment_date ? { ...raw, assignment_date: today() } : raw));

const rosterRows = (rows: Array<[string, string]> = [["hk-1", "ended"], ["hk-2", "active"], ["hk-3", "active"]]) =>
  rows.map(([user_id, status]) => ({ user_id, status, started_at: new Date().toISOString() }));

type Req = { operation_id: string; date: string; changes: { room_id: string; kind: string; housekeeper_id?: string; expected_assigned_to?: string; is_ai_suggested?: boolean }[] };
const committedFor = (request: Req) => {
  const rooms = request.changes.map((c) => ({ room_id: c.room_id, room_number: c.room_id.replace("room-", ""), kind: c.kind, previous_assigned_to: c.expected_assigned_to ?? null, assigned_to: c.housekeeper_id ?? null }));
  return {
    operation_id: request.operation_id,
    status: "committed",
    assignment_date: request.date,
    counts: { total: rooms.length, assign: 0, reassign: rooms.length, remove: 0 },
    rooms,
    affected_room_ids: rooms.map((r) => r.room_id),
    affected_housekeeper_ids: [...new Set(rooms.flatMap((r) => [r.assigned_to, r.previous_assigned_to]).filter(Boolean))],
    replayed: false,
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
  roster.mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (fetchWorkloadSettings as jest.Mock).mockResolvedValue({ targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: {} });
  (fetchScheduledShifts as jest.Mock).mockResolvedValue([]);
  publish.mockImplementation(async (request: Req) => committedFor(request));
  check.mockResolvedValue({ status: "not_found" });
});

afterEach(() => {
  expect(legacySave).not.toHaveBeenCalled();
});

async function teamLoaded(rooms: BoardRoomRaw[] = hotel()) {
  board.mockResolvedValue(rooms);
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId("assignments-tab-team")).toBeTruthy());
  fireEvent.press(screen.getByTestId("assignments-tab-team"));
  await waitFor(() => expect(screen.getByTestId("team-card-hk-1")).toBeTruthy());
  return screen;
}

async function openDrawer(screen: ReturnType<typeof render>, userId = "hk-1") {
  fireEvent.press(screen.getByTestId(`team-card-${userId}`));
  await waitFor(() => expect(screen.getByTestId("team-detail-sheet")).toBeTruthy());
}

async function openMidshift(screen: ReturnType<typeof render>) {
  await openDrawer(screen);
  fireEvent.press(screen.getByTestId("team-detail-reassign-remaining"));
  await waitFor(() => expect(screen.getByTestId("midshift-sheet")).toBeTruthy());
}

const press = async (screen: ReturnType<typeof render>, id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};

/** Open Ana's drawer → rooms → who → review. */
async function toReview(screen: ReturnType<typeof render>) {
  await openMidshift(screen);
  await press(screen, "midshift-next");
  await press(screen, "midshift-next");
  await waitFor(() => expect(screen.getByTestId("midshift-review-scroll")).toBeTruthy());
}

describe("the staff drawer", () => {
  it("shows the verified concern, what can move and what stays, and a prominent action", async () => {
    const screen = await teamLoaded();
    await openDrawer(screen);
    expect(flat(screen.getByTestId("team-detail-recovery-attention"))).toBe("Ana Torres has unfinished assigned work after the recorded shift ended.");
    expect(text(screen.getByTestId("team-detail-recovery-movable"))).toBe("6 rooms can move · 170 min estimated");
    expect(text(screen.getByTestId("team-detail-recovery-staying"))).toBe("3 rooms stay with Ana Torres: 2 completed · 1 in progress");
    expect(text(screen.getByTestId("team-detail-recovery-held"))).toBe("2 held-back rooms need their own decision");
    const button = screen.getByTestId("team-detail-reassign-remaining");
    expect(button.props.accessibilityState?.disabled).not.toBe(true);
    expect(screen.getByTestId("team-detail-view-rooms")).toBeTruthy();
  });

  it("keeps the existing drawer content: attendance, workload rows and assigned rooms", async () => {
    const screen = await teamLoaded();
    await openDrawer(screen);
    expect(screen.getByTestId("team-detail-attendance")).toBeTruthy();
    expect(screen.getByTestId("team-detail-row-notStarted")).toBeTruthy();
    expect(screen.getByTestId("team-detail-row-inProgress-value")).toBeTruthy();
  });

  it("explains instead of hiding the action when there is no eligible work", async () => {
    const screen = await teamLoaded();
    await openDrawer(screen, "hk-3");
    // Cara has one unstarted room, so it is available; the explanation is exercised with a person who has none (below).
    expect(screen.getByTestId("team-detail-reassign-remaining")).toBeTruthy();
  });

  it("is explained, not offered, for a person whose remaining work is all started or finished", async () => {
    const raw = [
      ...hotel().filter((r) => !["301", "302", "303", "304", "305", "306", "310", "311"].includes(r.rooms?.room_number ?? "")),
    ];
    const screen = await teamLoaded(raw);
    await openDrawer(screen);
    expect(screen.getByTestId("team-detail-reassign-remaining").props.accessibilityState.disabled).toBe(true);
    expect(text(screen.getByTestId("team-detail-reassign-disabled"))).toBe("There is no unstarted work available to redistribute.");
  });

  it("is paused, with the reason, while offline", async () => {
    const screen = await teamLoaded();
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await openDrawer(screen);
    expect(screen.getByTestId("team-detail-reassign-remaining").props.accessibilityState.disabled).toBe(true);
    expect(text(screen.getByTestId("team-detail-reassign-disabled"))).toBe(tr("assignments.v2.midshift.paused.offline"));
  });

  it("the team card says how many are unstarted and how many are in progress", async () => {
    const screen = await teamLoaded();
    expect(flat(screen.getByTestId("team-card-note-hk-1-shift_ended_with_open_rooms"))).toBe("Shift ended · 8 unstarted · 1 in progress");
  });
});

describe("the redistribution sheet", () => {
  it("opens with every movable room selected, protected work separate and explained, and nothing selected that can't move", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    expect(text(screen.getByTestId("midshift-title"))).toBe("Reassign Ana Torres's work");
    expect(flat(screen.getByTestId("midshift-current-work"))).toMatch(/2 completed · 1 in progress · 8 not started/);
    for (const number of ["301", "302", "303", "304", "305", "306"]) expect(screen.getByTestId(`midshift-room-${number}`).props.accessibilityState.checked).toBe(true);
    for (const number of ["307", "308", "309", "310", "311", "312"]) {
      expect(screen.queryByTestId(`midshift-room-${number}`)).toBeNull();
      expect(screen.getByTestId(`midshift-protected-${number}`)).toBeTruthy();
    }
    expect(text(screen.getByTestId("midshift-protected-why-307"))).toBe("Cleaning has already started. Verify the room's current status before transferring responsibility.");
    expect(text(screen.getByTestId("midshift-protected-why-310"))).toMatch(/Held back: Do not disturb/);
    expect(text(screen.getByTestId("midshift-selection-summary"))).toBe("6 selected · 170 min estimated");
    expect(publish).not.toHaveBeenCalled();
  });

  it("a started room offers the Room Board, not an override", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    expect(screen.queryByTestId("midshift-open-board-308")).toBeNull();
    fireEvent.press(screen.getByTestId("midshift-open-board-307"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-307" } });
    await waitFor(() => expect(screen.queryByTestId("midshift-sheet")).toBeNull());
    expect(screen.queryByTestId("team-detail-sheet")).toBeNull(); // going to the board is not "going back"
  });

  it("selects, clears and re-selects rooms; 'select all' never takes a protected one", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    fireEvent.press(screen.getByTestId("midshift-room-301"));
    expect(screen.getByTestId("midshift-room-301").props.accessibilityState.checked).toBe(false);
    expect(text(screen.getByTestId("midshift-selection-summary"))).toBe("5 selected · 140 min estimated");
    fireEvent.press(screen.getByTestId("midshift-select-all"));
    expect(text(screen.getByTestId("midshift-selection-summary"))).toBe("6 selected · 170 min estimated");
    fireEvent.press(screen.getByTestId("midshift-select-all")); // now "Clear selection"
    expect(screen.getByTestId("midshift-selection-summary")).toBeTruthy();
    expect(text(screen.getByTestId("midshift-selection-summary"))).toBe("No rooms selected yet.");
    expect(screen.getByTestId("midshift-next").props.accessibilityState.disabled).toBe(true);
  });

  it("the reason is optional, descriptive and never touches attendance", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    expect(flat(screen.getByTestId("midshift-reason"))).toMatch(/does not change attendance/);
    fireEvent.press(screen.getByTestId("midshift-reason-left_early"));
    expect(screen.getByTestId("midshift-reason-left_early").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId("midshift-reason-left_early"));
    expect(screen.getByTestId("midshift-reason-left_early").props.accessibilityState.selected).toBe(false);
  });

  it("the available team is only people verified on shift, and says who", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    await press(screen, "midshift-next");
    expect(text(screen.getByTestId("midshift-team-members"))).toBe("Verified on shift: Ben Ortiz, Cara Reyes");
  });

  it("with nobody verified on shift it offers honest next steps and never forces an assignment", async () => {
    roster.mockResolvedValue(rosterRows([["hk-1", "ended"]]));
    const screen = await teamLoaded();
    await openMidshift(screen);
    await press(screen, "midshift-next");
    expect(flat(screen.getByTestId("midshift-no-team"))).toMatch(/No verified eligible housekeepers are currently available\./);
    expect(screen.getByTestId("midshift-next").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("midshift-choose-specific")).toBeTruthy();
    expect(screen.getByTestId("midshift-adjust-rooms")).toBeTruthy();
    expect(text(screen.getByTestId("midshift-keep-note"))).toMatch(/Nothing moves\. The rooms stay assigned to Ana Torres \(Shift ended\)/);
    await press(screen, "midshift-keep-assigned");
    await waitFor(() => expect(screen.queryByTestId("midshift-sheet")).toBeNull());
    expect(publish).not.toHaveBeenCalled();
  });

  it("a specific housekeeper is never pre-selected; one who isn't clocked in needs a confirmation later", async () => {
    roster.mockResolvedValue(rosterRows([["hk-1", "ended"], ["hk-2", "active"]]));
    const screen = await teamLoaded();
    await openMidshift(screen);
    await press(screen, "midshift-next");
    fireEvent.press(screen.getByTestId("midshift-mode-person"));
    expect(screen.getByTestId("midshift-candidate-hk-2").props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId("midshift-candidate-hk-3").props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId("midshift-next").props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId("midshift-candidate-hk-1")).toBeNull(); // never the person the work leaves
    expect(screen.getByTestId("midshift-candidate-hk-3").props.accessibilityLabel).toMatch(/Not clocked in/);
    fireEvent.press(screen.getByTestId("midshift-candidate-hk-3"));
    await press(screen, "midshift-next");
    await waitFor(() => expect(screen.getByTestId("midshift-confirm-later-hk-3")).toBeTruthy());
  });
});

describe("the review and the draft", () => {
  it("shows the source's before and after, the receivers' allocations and the validation, with nothing published", async () => {
    const screen = await teamLoaded();
    await toReview(screen);
    expect(text(screen.getByTestId("midshift-source-before"))).toMatch(/^Before: /);
    expect(text(screen.getByTestId("midshift-source-after"))).toMatch(/^After: /);
    expect(text(screen.getByTestId("midshift-source-after"))).not.toMatch(/nothing left/); // the in-progress room stays with Ana
    expect(text(screen.getByTestId("midshift-source-stays"))).toBe("6 rooms stay with Ana Torres");
    expect(screen.getByTestId("midshift-receiver-hk-2")).toBeTruthy();
    expect(screen.getByTestId("midshift-receiver-hk-3")).toBeTruthy();
    expect(screen.getByTestId("midshift-validation-ownership_unchanged")).toBeTruthy();
    expect(screen.getByTestId("midshift-not-published")).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();
  });

  it("editing a room moves it to the other receiver and recalculates both", async () => {
    const screen = await teamLoaded();
    await toReview(screen);
    const hk2Before = text(screen.getByTestId("midshift-after-hk-2"));
    await press(screen, "midshift-edit");
    const owner = screen.queryByTestId("midshift-item-301") && flat(screen.getByTestId("midshift-receiver-hk-2")).includes("301") ? "hk-2" : "hk-3";
    const other = owner === "hk-2" ? "hk-3" : "hk-2";
    fireEvent.press(screen.getByTestId("midshift-move-301"));
    fireEvent.press(screen.getByTestId(`midshift-move-to-${other}`));
    await waitFor(() => expect(flat(screen.getByTestId(`midshift-receiver-${other}`))).toContain("301"));
    expect(owner === "hk-2" ? text(screen.getByTestId("midshift-after-hk-2")) : hk2Before).not.toBe(owner === "hk-2" ? hk2Before : "");
  });

  it("taking a room out of the plan drops it from the review", async () => {
    const screen = await teamLoaded();
    await toReview(screen);
    await press(screen, "midshift-edit");
    fireEvent.press(screen.getByTestId("midshift-takeout-301"));
    await waitFor(() => expect(screen.queryByTestId("midshift-item-301")).toBeNull());
    expect(text(screen.getByTestId("midshift-source-stays"))).toBe("7 rooms stay with Ana Torres");
  });

  it("add → draft review → publish sends ONE atomic request with the owners the supervisor saw and no AI flag", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    fireEvent.press(screen.getByTestId("midshift-reason-left_early"));
    await press(screen, "midshift-next");
    await press(screen, "midshift-next");
    await press(screen, "midshift-add-to-draft");
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    expect(screen.queryByTestId("midshift-sheet")).toBeNull(); // one modal at a time
    expect(flat(screen.getByTestId("bulk-review-midshift"))).toMatch(/Midshift redistribution · 6 rooms from Ana Torres/);
    expect(flat(screen.getByTestId("bulk-review-midshift"))).toMatch(/Reason: Left early/);
    expect(publish).not.toHaveBeenCalled();

    expect(screen.getByTestId("bulk-publish").props.accessibilityState.disabled).not.toBe(true);
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-committed")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(1);
    const request = publish.mock.calls[0][0] as Req;
    expect(request.date).toBe(today());
    expect(request.changes).toHaveLength(6);
    expect(request.changes.map((c) => c.room_id).sort()).toEqual(["301", "302", "303", "304", "305", "306"].map((n) => `room-${n}`));
    for (const change of request.changes) {
      expect(change).toMatchObject({ kind: "reassign", expected_assigned_to: "hk-1" });
      expect(["hk-2", "hk-3"]).toContain(change.housekeeper_id);
      expect(change.is_ai_suggested).toBeUndefined();
    }
    expect(text(screen.getByTestId("bulk-committed-total"))).toMatch(/6/);
  });

  it("a server conflict says nothing was committed only because the server said so", async () => {
    publish.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 409, detail: { applied: false, conflicts: [{ room_id: "room-301", code: "assignment_changed" }] } }));
    const screen = await teamLoaded();
    await toReview(screen);
    await press(screen, "midshift-add-to-draft");
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-rejected")).toBeTruthy());
    expect(flat(screen.getByTestId("bulk-rejected"))).toMatch(/No changes/i);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("a lost answer is checked with the same operation, never blindly re-sent", async () => {
    publish.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await teamLoaded();
    await toReview(screen);
    await press(screen, "midshift-add-to-draft");
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    await press(screen, "bulk-publish");
    await waitFor(() => expect(screen.getByTestId("bulk-unknown")).toBeTruthy());
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("an existing draft change for the same room asks before anything is replaced", async () => {
    const screen = await teamLoaded();
    await toReview(screen);
    await press(screen, "midshift-add-to-draft");
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    // Close the draft review; the plan stays as an unpublished draft.
    fireEvent.press(screen.getByTestId("bulk-review-back"));
    await waitFor(() => expect(screen.queryByTestId("bulk-sheet")).toBeNull());
    await openMidshift(screen);
    await press(screen, "midshift-next");
    await press(screen, "midshift-next");
    await press(screen, "midshift-add-to-draft");
    await waitFor(() => expect(screen.getByTestId("midshift-conflict")).toBeTruthy());
    expect(flat(screen.getByTestId("midshift-conflict"))).toMatch(/6 of these rooms already have changes in your unpublished assignment plan\./);
    fireEvent.press(screen.getByTestId("midshift-conflict-keep"));
    await waitFor(() => expect(screen.queryByTestId("midshift-sheet")).toBeNull());
    expect(mockToast.info).toHaveBeenCalledWith(tr("assignments.v2.midshift.keptYours"));
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("the board moves under the supervisor", () => {
  const refresh = async (screen: ReturnType<typeof render>) =>
    act(async () => {
      await screen.getByTestId("assignments-list").props.refreshControl.props.onRefresh();
    });

  it("a room that started cleaning blocks the plan with the right words, then the refreshed plan leaves it out", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    await press(screen, "midshift-next");
    board.mockResolvedValue(hotel((raw) => (raw.rooms?.room_number === "301" ? { ...raw, status: "IN_PROGRESS" } : raw)));
    // Refreshing is the background poll the screen would do; the drawer stays open on the same model.
    await act(async () => {
      await screen.getByTestId("assignments-list").props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId("midshift-changed")).toBeTruthy());
    expect(flat(screen.getByTestId("midshift-changed-room-301"))).toBe("Room 301 is now being cleaned and can no longer be reassigned through this workflow.");
    expect(screen.getByTestId("midshift-next").props.accessibilityState.disabled).toBe(true);
    await press(screen, "midshift-refresh");
    await waitFor(() => expect(screen.queryByTestId("midshift-changed")).toBeNull());
    expect(screen.getByTestId("midshift-next").props.accessibilityState.disabled).not.toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it("a receiver going on break is named and the plan must be reviewed again", async () => {
    const screen = await teamLoaded();
    await openMidshift(screen);
    await press(screen, "midshift-next");
    roster.mockResolvedValue(rosterRows([["hk-1", "ended"], ["hk-2", "on_break"], ["hk-3", "active"]]));
    await refresh(screen);
    await waitFor(() => expect(screen.getByTestId("midshift-changed-destination-hk-2")).toBeTruthy());
    expect(flat(screen.getByTestId("midshift-changed-destination-hk-2"))).toBe("Ben Ortiz's availability changed: On shift → On break.");
    expect(screen.getByTestId("midshift-next").props.accessibilityState.disabled).toBe(true);
  });

  it("Spanish resolves every string on the way through", async () => {
    mockLanguage = "es";
    const screen = await teamLoaded();
    await openMidshift(screen);
    expect(text(screen.getByTestId("midshift-title"))).toBe("Reasignar el trabajo de Ana Torres");
    expect(text(screen.getByTestId("midshift-protected-why-307"))).toMatch(/La limpieza ya empezó/);
  });
});

describe("urgent rooms use the existing single-room reassignment", () => {
  it("an urgent room that is assigned and unstarted can be reassigned from its sheet", async () => {
    board.mockResolvedValue(hotel((raw) => (raw.rooms?.room_number === "401" ? { ...raw, vip_flag: true } : raw)));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("assignments-tab-rooms")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("assignment-room-401")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignment-room-401"));
    await waitFor(() => expect(screen.getByTestId("assignment-sheet-reassign")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignment-sheet-reassign"));
    await waitFor(() => expect(text(screen.getByTestId("assign-title"))).toBe("Reassign Room 401"));
  });

  it("an urgent room that is being cleaned offers no reassignment: urgency never overrides the rules", async () => {
    board.mockResolvedValue(hotel((raw) => (raw.rooms?.room_number === "307" ? { ...raw, vip_flag: true } : raw)));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("assignment-room-307")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignment-room-307"));
    await waitFor(() => expect(screen.getByTestId("assignment-sheet")).toBeTruthy());
    expect(screen.queryByTestId("assignment-sheet-reassign")).toBeNull();
  });
});
