import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen with Smart Balance (Assignments V2 phase 6): entry, setup, the read-only planning
   request, preview, editing, exceptions, the Phase 5 draft + review and the atomic publication. Only the network,
   the realtime channel, the router and the toast are doubled. Every assertion is about what the supervisor sees or what the server was asked
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
    requestSmartBalancePlan: jest.fn(),
    fetchAssignmentPreferences: jest.fn(),
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
  requestSmartBalancePlan,
  fetchAssignmentPreferences,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { readPending } from "@/lib/housekeeping/publishJournal";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { STAFF } from "../helpers/roomBoardFixtures";
import { DEFAULT_PROPERTY_PREFERENCES as DEFAULTS } from "@/lib/housekeeping/smartBalancePolicy";
import { bulkBoard, room } from "../helpers/bulkFixtures";

const board = fetchBoardVerified as jest.Mock;
const publish = publishAssignmentBatch as jest.Mock;
const check = fetchBatchPublication as jest.Mock;
const plan = requestSmartBalancePlan as jest.Mock;
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
jest.setTimeout(30000);

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
  (fetchAssignmentPreferences as jest.Mock).mockResolvedValue(DEFAULTS);
  plan.mockImplementation(async (body: PlanBody) => answerFrom(body));
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


interface PlanBody {
  date: string;
  scope: string;
  rooms: { room_id: string; room_number: string; expected_owner_id: string | null }[];
  staff: { user_id: string }[];
  snapshot_verified_at: number;
}
/** A planner stand-in: deals the rooms round-robin to the people it was offered. */
function answerFrom(body: PlanBody) {
  const assignments = body.rooms.map((r, index) => ({
    room_id: r.room_id,
    room_number: r.room_number,
    kind: "new",
    from_user_id: null,
    to_user_id: body.staff[index % body.staff.length].user_id,
    tier: "routine",
    reasons: [{ code: "lowest_workload", minutes: 0 }],
  }));
  return {
    data: {
      read_only: true,
      plan_id: "p1",
      date: body.date,
      scope: body.scope,
      generated_at: new Date().toISOString(),
      snapshot_verified_at: body.snapshot_verified_at,
      status: "optimal",
      assignments,
      unallocated: [],
      staff: body.staff.map((s) => ({ user_id: s.user_id, rooms_added: assignments.filter((a) => a.to_user_id === s.user_id).length, rooms_released: 0, minutes_added_known: 0, unknown_added: 0, no_capacity: false })),
      rejected_rooms: [],
      rejected_staff: [],
      assumptions: [],
      warnings: [],
    },
  };
}

const openSmart = async (screen: ReturnType<typeof render>) => {
  fireEvent.press(screen.getByTestId("smart-entry"));
  await waitFor(() => expect(screen.getByTestId("smart-setup-scroll")).toBeTruthy());
  await waitFor(() => expect(flat(screen.getByTestId("smart-prefs-source") as never)).toMatch(/property's assignment settings/));
};
const generate = async (screen: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId("smart-generate"));
  });
  await waitFor(() => expect(screen.getByTestId("smart-preview-scroll")).toBeTruthy());
};

const press = async (screen: ReturnType<typeof render>, id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};

describe("the entry point", () => {
  it("is on the Rooms view for a supervisor and opens the setup sheet without generating anything", async () => {
    const screen = await loaded();
    expect(flat(screen.getByTestId("smart-entry") as never)).toMatch(/Smart Balance/);
    await openSmart(screen);
    expect(plan).not.toHaveBeenCalled();
    expect(screen.getByTestId("smart-scope-unassigned").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("smart-scope-selected").props.accessibilityState.disabled).toBe(true); // nothing selected
    expect(screen.getByTestId("smart-pref-protectStarted").props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(flat(screen.getByTestId("smart-preflight") as never)).toMatch(/7 rooms will be planned/);
  });

  it("is not offered to someone who may not plan assignments", async () => {
    mockAppState.user = { id: "hk-9", role: "housekeeper", tenant_id: "h1" };
    const screen = await loaded();
    expect(screen.queryByTestId("smart-entry")).toBeNull();
  });

  it("explains an unverified roster instead of planning from it, and offers a refresh", async () => {
    (fetchShiftRoster as jest.Mock).mockRejectedValue(new Error("down"));
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("smart-entry"));
    await waitFor(() => expect(screen.getByTestId("smart-setup-blocked")).toBeTruthy());
    expect(flat(screen.getByTestId("smart-setup-blocked") as never)).toMatch(/availability could not be verified/);
    expect(screen.queryByTestId("smart-generate")).toBeNull();
    expect(screen.getByTestId("smart-refresh")).toBeTruthy();
    expect(plan).not.toHaveBeenCalled();
  });

  it("says when everything is already assigned", async () => {
    const owned = [room("101", "DIRTY", { owner: "hk-1" }), room("102", "DIRTY", { owner: "hk-2" })].map((raw) => ({ ...raw, assignment_date: today() }));
    const screen = await loaded(owned);
    fireEvent.press(screen.getByTestId("smart-entry"));
    await waitFor(() => expect(screen.getByTestId("smart-setup-blocked")).toBeTruthy());
    expect(flat(screen.getByTestId("smart-setup-blocked") as never)).toMatch(/All eligible rooms are already assigned/);
  });
});

describe("planning", () => {
  it("asks the planner read-only, shows the preview, and has assigned nothing", async () => {
    const screen = await loaded();
    await openSmart(screen);
    await generate(screen);
    const body = plan.mock.calls[0][0];
    expect(body).toMatchObject({ scope: "unassigned" });
    expect(body.rooms).toHaveLength(7);
    expect(flat(screen.getByTestId("smart-stat-planned") as never)).toBe("7 rooms planned");
    expect(publish).not.toHaveBeenCalled();
    expect(legacySave).not.toHaveBeenCalled();
  });

  it("shows before and after for each person, and the exceptions with the real reasons", async () => {
    const screen = await loaded();
    await openSmart(screen);
    await generate(screen);
    expect(screen.getByTestId("smart-workload-hk-2")).toBeTruthy();
    fireEvent.press(screen.getByTestId("smart-open-exceptions"));
    await waitFor(() => expect(screen.getByTestId("smart-exceptions-scroll")).toBeTruthy());
    expect(flat(screen.getByTestId("smart-excluded-104") as never)).toMatch(/Do Not Disturb/);
    expect(flat(screen.getByTestId("smart-excluded-105") as never)).toMatch(/Service declined/);
    expect(screen.getByTestId("smart-protected")).toBeTruthy();
  });

  it("a failed request leaves the supervisor on the setup sheet with a retry, and nothing planned", async () => {
    plan.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 503 }));
    const screen = await loaded();
    await openSmart(screen);
    await act(async () => {
      fireEvent.press(screen.getByTestId("smart-generate"));
    });
    await waitFor(() => expect(screen.getByTestId("smart-setup-failed")).toBeTruthy());
    expect(flat(screen.getByTestId("smart-setup-failed") as never)).toMatch(/Nothing was changed/);
  });
});

describe("from plan to published", () => {
  it("adds to the draft, goes through the Phase 5 review, and publishes ONE atomic request with per-change provenance", async () => {
    const screen = await loaded();
    await openSmart(screen);
    await generate(screen);
    // the supervisor overrides one recommendation
    fireEvent.press(screen.getByTestId("smart-distribution-hk-3"));
    await waitFor(() => expect(screen.getByTestId("smart-detail-scroll")).toBeTruthy());
    const moveButton = screen.getAllByTestId(/^smart-move-\d/)[0];
    const edited = String(moveButton.props.testID).replace("smart-move-", "");
    fireEvent.press(moveButton);
    await waitFor(() => expect(screen.getByTestId("smart-move-scroll")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId("smart-move-to-hk-1"));
    });
    fireEvent.press(screen.getByTestId("smart-detail-done"));
    await waitFor(() => expect(screen.getByTestId("smart-add-to-draft")).toBeTruthy());
    await press(screen, "smart-add-to-draft");
    await waitFor(() => expect(screen.getByTestId("bulk-review-scroll")).toBeTruthy());
    expect(publish).not.toHaveBeenCalled(); // reviewing is not publishing
    await press(screen, "bulk-publish");
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const request = publish.mock.calls[0][0];
    expect(request.changes).toHaveLength(7);
    const byRoom = Object.fromEntries(request.changes.map((c: { room_id: string; is_ai_suggested?: boolean }) => [c.room_id, c.is_ai_suggested === true]));
    expect(byRoom[`room-${edited}`]).toBe(false); // the supervisor's own decision
    expect(Object.values(byRoom).filter(Boolean)).toHaveLength(6); // everything else is an untouched recommendation
    expect(legacySave).not.toHaveBeenCalled();
  });
});

describe("Spanish", () => {
  it("renders the entry, setup and preview in Spanish", async () => {
    mockLanguage = "es";
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("smart-entry"));
    await waitFor(() => expect(screen.getByTestId("smart-setup-scroll")).toBeTruthy());
    expect(flat(screen.getByTestId("smart-preflight") as never)).toMatch(/Se planificarán 7 habitaciones/);
    await generate(screen);
    expect(flat(screen.getByTestId("smart-stat-planned") as never)).toBe("7 habitaciones planificadas");
  });
});
