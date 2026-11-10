import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { readyRoom } from "../helpers/inspectionFixtures";

/* Design System V2 Phase 4: the purpose-built Inspector Home. It is read-only over the data the Inspections tab
   already loads; these tests pin what it may claim (verified data only), how a room is started (same guards as the
   queue) and every non-happy state. */

let mockOnline = true;
let mockQueueState: Record<string, unknown> = {};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator("en"), i18n: { language: "en", resolvedLanguage: "en" } }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => "light" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/housekeeping/useHotelName", () => ({ useHotelName: () => "Fossil Creek Inn" }));
jest.mock("@/lib/inspections/useInspectionQueue", () => ({ useInspectionQueue: () => mockQueueState }));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => {
    const state = { user: { id: "insp-1", role: "inspector", tenant_id: "h1" }, isOnline: mockOnline, unreadCount: 3, hotelTimezone: "America/Chicago" };
    return selector ? selector(state) : state;
  },
}));

import { router } from "expo-router";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { InspectorHome } from "@/components/home/InspectorHome";
import { buildCorrections, buildDone } from "@/lib/inspections/lists";
import { buildQueue } from "@/lib/inspections/queue";

const push = router.push as jest.Mock;
const NOW = Date.parse("2026-10-20T18:00:00Z"); // 1:00 PM Chicago

const availableQueue = { status: "available", data: [], fetchedAt: NOW };

function state(over: Record<string, unknown> = {}) {
  const items = buildQueue([
    readyRoom("r-101", { room_number: "101", floor: 1, room_type_name: "King", arrival_at: "2026-10-20T16:00:00Z" }),
    readyRoom("r-102", { room_number: "102", floor: 1, vip: true }),
    readyRoom("r-103", { room_number: "103", floor: 1 }),
  ]);
  return {
    businessDate: "2026-10-20",
    queue: availableQueue,
    items,
    correctionList: buildCorrections([]),
    doneList: buildDone(
      [
        { id: "d1", room_id: "r-90", room_number: "90", floor: 1, building: null, inspector_display_name: "Sam", completed_at: new Date(NOW - 20 * 60_000).toISOString(), overall_result: "passed", reinspection_of: null, notes: null },
        { id: "d2", room_id: "r-91", room_number: "91", floor: 1, building: null, inspector_display_name: "Sam", completed_at: new Date(NOW - 10 * 60_000).toISOString(), overall_result: "failed", reinspection_of: null, notes: null },
      ] as never,
      "2026-10-20",
      "America/Chicago",
    ),
    now: NOW,
    refreshing: false,
    refresh: jest.fn().mockResolvedValue(undefined),
    selectionFor: jest.fn().mockReturnValue({ ok: true }),
    ...over,
  };
}

function view() {
  return render(
    <DesignV2Scope>
      <InspectorHome name="Priya Shah" />
    </DesignV2Scope>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockQueueState = state();
});

describe("Inspector Home", () => {
  it("shows the property, a personal greeting and the unread bell", () => {
    const screen = view();
    expect(screen.getByTestId("inspector-hotel").props.children).toBe("Fossil Creek Inn");
    expect(screen.getByText(/Priya/)).toBeTruthy();
    expect(screen.getByTestId("inspector-bell-badge")).toBeTruthy();
  });

  it("puts the most urgent waiting room in focus and starts it through the canonical route", () => {
    const screen = view();
    // 101 has an arrival that has already passed: overdue, so it is the next inspection.
    expect(screen.getByTestId("inspector-focus-room").props.children).toBe("101");
    expect(screen.getByText("King", { exact: false })).toBeTruthy();
    fireEvent.press(screen.getByTestId("inspector-start"));
    expect(push).toHaveBeenCalledWith({
      pathname: "/(app)/inspect/[roomId]",
      params: { roomId: "r-101", from: "queue", roomNumber: "101" },
    });
  });

  it("lists the other rooms with a recorded reason to go first, and starts one from there", () => {
    const screen = view();
    expect(screen.queryByTestId("inspector-priority-r-101")).toBeNull(); // the focus room is not repeated
    fireEvent.press(screen.getByTestId("inspector-priority-r-102"));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ roomId: "r-102" }) }));
    expect(screen.queryByTestId("inspector-priority-r-103")).toBeNull(); // nothing recorded about 103
  });

  it("does not start a room whose checklist cannot be used, and says why", () => {
    mockQueueState = state({ selectionFor: jest.fn().mockReturnValue({ ok: false, reason: "noTemplate" }) });
    const screen = view();
    expect(screen.getByTestId("inspector-focus-blocked")).toBeTruthy();
    fireEvent.press(screen.getByTestId("inspector-start"));
    expect(push).not.toHaveBeenCalled();
  });

  it("will not start from out-of-date information: it explains, refreshes, and does not navigate", () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    mockQueueState = state({ queue: { status: "stale", data: [], fetchedAt: NOW - 600_000, reason: "age", failure: null }, refresh });
    const screen = view();
    fireEvent.press(screen.getByTestId("inspector-start"));
    expect(mockToast.error).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("inspector-stale")).toBeTruthy();
  });

  it("shows verified counts and opens the matching list when a tile is pressed", () => {
    const screen = view();
    expect(screen.getByTestId("inspector-metric-awaiting")).toBeTruthy();
    expect(screen.getByTestId("inspector-metric-completed")).toBeTruthy();
    fireEvent.press(screen.getByTestId("inspector-metric-failed"));
    expect(push).toHaveBeenLastCalledWith({ pathname: "/(app)/inspect", params: { tab: "done" } });
    fireEvent.press(screen.getByTestId("inspector-metric-reinspection"));
    expect(push).toHaveBeenLastCalledWith({ pathname: "/(app)/inspect", params: { tab: "corrections" } });
    fireEvent.press(screen.getByTestId("inspector-metric-awaiting"));
    expect(push).toHaveBeenLastCalledWith("/(app)/inspect");
  });

  it("opens a finished inspection's read-only record from Recent results", () => {
    const screen = view();
    fireEvent.press(screen.getByTestId("inspector-recent-d2"));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/(app)/inspect/record/[inspectionId]", params: expect.objectContaining({ inspectionId: "d2" }) }));
  });

  it("says unavailable, not zero, for counts whose source has not answered", () => {
    mockQueueState = state({ correctionList: null, doneList: null });
    const screen = view();
    expect(screen.getByTestId("inspector-metric-reinspection")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("Inspector Home states", () => {
  it("loading", () => {
    mockQueueState = state({ queue: { status: "loading" }, items: null, correctionList: null, doneList: null });
    const screen = view();
    expect(screen.getByTestId("inspector-loading")).toBeTruthy();
    expect(screen.queryByTestId("inspector-focus")).toBeNull();
  });

  it("a refused account is a permission state, not an empty queue", () => {
    mockQueueState = state({ queue: { status: "failed", failure: { kind: "forbidden", status: 403 } }, items: null });
    const screen = view();
    expect(screen.getByTestId("inspector-restricted")).toBeTruthy();
    expect(screen.queryByTestId("inspector-empty")).toBeNull();
    expect(screen.queryByTestId("inspector-all-complete")).toBeNull();
  });

  it("a failed first load can be retried and never reads as 'all clear'", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    mockQueueState = state({ queue: { status: "failed", failure: { kind: "error", status: 500 } }, items: null, refresh });
    const screen = view();
    expect(screen.getByTestId("inspector-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("inspector-all-complete")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText("Retry"));
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("all inspections complete (verified empty queue, work done today)", () => {
    mockQueueState = state({ queue: { status: "empty", fetchedAt: NOW }, items: [] });
    const screen = view();
    expect(screen.getByTestId("inspector-all-complete")).toBeTruthy();
  });

  it("nothing waiting yet (verified empty queue, nothing inspected today)", () => {
    mockQueueState = state({ queue: { status: "empty", fetchedAt: NOW }, items: [], doneList: buildDone([], "2026-10-20", "America/Chicago") });
    const screen = view();
    expect(screen.getByTestId("inspector-empty")).toBeTruthy();
    expect(screen.queryByTestId("inspector-all-complete")).toBeNull();
  });

  it("offline: says starting needs a connection and keeps the last answer on screen", () => {
    mockOnline = false;
    mockQueueState = state({ queue: { status: "stale", data: [], fetchedAt: NOW - 60_000, reason: "offline", failure: null } });
    const screen = view();
    expect(screen.getByTestId("inspector-offline")).toBeTruthy();
    expect(screen.getByTestId("inspector-focus")).toBeTruthy();
  });
});
