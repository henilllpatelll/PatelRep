import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
    useFocusEffect: jest.fn(),
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let realtimeHandler: (() => void) | null = null;
const mockChannel: { on: jest.Mock; subscribe: jest.Mock } = {
  on: jest.fn((_event: string, _filter: unknown, handler: () => void) => {
    realtimeHandler = handler;
    return mockChannel;
  }),
  subscribe: jest.fn().mockReturnValue({}),
};
jest.mock("@/lib/supabase", () => ({
  supabase: { channel: jest.fn(() => mockChannel), removeChannel: jest.fn() },
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoardVerified: jest.fn(),
  fetchAssignableStaff: jest.fn(),
  fetchShiftRoster: jest.fn(),
  fetchInspectionHistory: jest.fn(),
}));
jest.mock("@/lib/api/tasks", () => ({ fetchBlockedTasks: jest.fn() }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("@/components/supervisor/ShiftNoteModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/supervisor/BroadcastModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/supervisor/EndShiftModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/supervisor/DirectMessageModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/supervisor/HousekeeperPicker", () => ({ HousekeeperPicker: () => null }));

const mockState: {
  user: { id: string; role: string; tenant_id: string; language_pref: string; full_name?: string; effective_role?: string };
  isOnline: boolean;
  unreadCount: number;
  hotelTimezone: string | null;
} = {
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1", language_pref: "en" },
  isOnline: true,
  unreadCount: 0,
  hotelTimezone: "America/Chicago",
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockState) : mockState),
}));

import { router } from "expo-router";
import i18n from "@/i18n";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { SupervisorHome } from "@/components/home/SupervisorHome";
import { SupervisorAttentionScreen } from "@/components/supervisor/attention/SupervisorAttentionScreen";
import SupervisorAttentionRoute from "@/app/(app)/supervisor-attention/index";
import { fetchAssignableStaff, fetchBoardVerified, fetchInspectionHistory, fetchShiftRoster } from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";

const mockRouter = router as unknown as { push: jest.Mock; back: jest.Mock; replace: jest.Mock; canGoBack: jest.Mock };
const board = fetchBoardVerified as jest.Mock;
const staffList = fetchAssignableStaff as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const inspections = fetchInspectionHistory as jest.Mock;
const blocked = fetchBlockedTasks as jest.Mock;

const NOW = Date.parse("2026-10-16T17:00:00Z"); // 12:00 in Chicago

function raw(roomId: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: roomId, status, rooms: { id: roomId, room_number: roomId.replace("r-", ""), floor: 1 }, ...extra };
}
const blockerItem = (id: string, status: "active" | "resolved" = "active") => ({
  blocker: { id, reason: "missing_supplies", details: null, reported_by: "hk-1", reported_by_name: "Ana", reported_at: "2026-10-16T15:00:00Z", status, notification_status: "queued" },
  task: { id: `t-${id}`, title: "Restock 204", task_type: "housekeeping", priority: "urgent", assigned_to_name: "Ana", room_number: "204", location_text: null },
});

const DEFAULT_ROOMS = [
  raw("r-301", "DIRTY", { fo_status: "VAC", checkin_time: new Date(NOW + 40 * 60_000).toISOString(), assigned_to: "hk-1" }),
  raw("r-303", "DIRTY"),
  raw("r-304", "OCCUPIED"),
  raw("r-305", "CLEAN", { assigned_to: "hk-1" }),
  raw("r-306", "CLEAN", { assigned_to: "hk-1" }),
  raw("r-307", "DIRTY", { dnd_flag: true, assigned_to: "hk-1" }),
  raw("r-308", "INSPECTED"),
];

function setup(opts: { rooms?: BoardRoomRaw[]; blockedItems?: unknown[] } = {}) {
  board.mockResolvedValue(opts.rooms ?? DEFAULT_ROOMS);
  staffList.mockResolvedValue([{ userId: "hk-1", name: "Ana", role: "housekeeper" }]);
  roster.mockResolvedValue([]);
  inspections.mockResolvedValue([]);
  blocked.mockResolvedValue({ items: (opts.blockedItems ?? [blockerItem("b-1")]) as never[], hasMore: false });
}

const wrap = (node: React.ReactElement) => <ThemeProvider>{node}</ThemeProvider>;
const renderCenter = () => render(wrap(<SupervisorAttentionScreen />));

beforeAll(async () => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(NOW);
  await i18n.changeLanguage("en");
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  jest.clearAllMocks();
  realtimeHandler = null;
  mockState.isOnline = true;
  mockState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1", language_pref: "en" };
  setup();
});

describe("Supervisor Attention Center — list", () => {
  it("shows the title, a count of the items actually listed, and the filters that have data", async () => {
    const screen = renderCenter();
    await waitFor(() => expect(screen.getByTestId("attention-meta")).toHaveTextContent(/^5 items/));
    expect(screen.getByText("Needs your attention")).toBeTruthy();
    expect(screen.getByText("Housekeeping priorities requiring review")).toBeTruthy();
    // 5 items: arrival, blocker, unassigned (2 rooms), inspection (2 rooms), access (1 room).
    expect(screen.getAllByTestId(/^attention-card-/)).toHaveLength(5);
  });

  it("counts items, not rooms: a queue of two rooms is one card", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-queue:unassigned_rooms"));
    expect(screen.getByTestId("attention-card-queue:unassigned_rooms")).toHaveTextContent(/2 rooms unassigned/);
    expect(screen.getByTestId("attention-meta")).toHaveTextContent(/^5 items/);
  });

  it("filters by category without making any request, and keeps the filter after a sheet closes", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-queue:awaiting_inspection"));
    const calls = () => [board, staffList, roster, inspections, blocked].map((m) => m.mock.calls.length);
    const before = calls();

    fireEvent.press(screen.getByTestId("attention-filter-inspect"));
    expect(screen.getAllByTestId(/^attention-card-/)).toHaveLength(1);
    expect(screen.getByTestId("attention-card-queue:awaiting_inspection")).toBeTruthy();
    expect(screen.getByTestId("attention-filter-inspect").props.accessibilityState.selected).toBe(true);

    fireEvent.press(screen.getByTestId("attention-card-queue:awaiting_inspection"));
    fireEvent.press(await screen.findByTestId("attention-sheet-close"));
    expect(screen.getByTestId("attention-filter-inspect").props.accessibilityState.selected).toBe(true);
    expect(screen.getAllByTestId(/^attention-card-/)).toHaveLength(1);
    expect(calls()).toEqual(before);

    fireEvent.press(screen.getByTestId("attention-filter-urgent"));
    expect(screen.getAllByTestId(/^attention-card-/).map((c) => c.props.testID)).toEqual([
      "attention-card-room:r-301:arrival_at_risk",
      "attention-card-blocker:b-1",
    ]);
  });

  it("states severity in words on each card", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-blocker:b-1"));
    expect(screen.getByTestId("attention-severity-blocker:b-1")).toHaveTextContent(/Urgent/);
    expect(screen.getByTestId("attention-severity-queue:awaiting_inspection")).toHaveTextContent(/Pending/);
  });

  it("an emptied filter says so and does not show unrelated items; Show all recovers", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-blocker:b-1"));
    fireEvent.press(screen.getByTestId("attention-filter-issues"));
    // The blocker is resolved elsewhere; the next refresh removes it.
    blocked.mockResolvedValue({ items: [blockerItem("b-1", "resolved")], hasMore: false });
    await act(async () => {
      await screen.getByTestId("attention-list").props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId("attention-filter-empty")).toBeTruthy());
    expect(screen.queryAllByTestId(/^attention-card-/)).toHaveLength(0);
    expect(screen.getByText("No items in this category")).toBeTruthy();
    expect(screen.getByTestId("attention-filter-issues").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId("attention-show-all"));
    expect(screen.getAllByTestId(/^attention-card-/).length).toBeGreaterThan(0);
  });

  it("says 'all caught up' only when the sources were really verified empty", async () => {
    setup({ rooms: [raw("r-1", "INSPECTED")], blockedItems: [] });
    const screen = renderCenter();
    await waitFor(() => expect(screen.getByTestId("attention-empty")).toBeTruthy());
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });

  it("does not claim all clear — or show zero — when a source failed; it keeps what it has and says what is missing", async () => {
    blocked.mockRejectedValue(Object.assign(new Error("no"), { status: 500 }));
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-partial"));
    expect(screen.getByText("Task blockers are unavailable.")).toBeTruthy();
    expect(screen.getByTestId("attention-card-queue:awaiting_inspection")).toBeTruthy();
    expect(screen.queryByTestId("attention-empty")).toBeNull();
  });

  it("an empty answer from a failed source is 'couldn't check', not 'caught up'", async () => {
    blocked.mockRejectedValue(new Error("down"));
    setup({ rooms: [raw("r-1", "INSPECTED")] });
    blocked.mockRejectedValue(new Error("down"));
    const screen = renderCenter();
    await waitFor(() => expect(screen.getByTestId("attention-unconfirmed-empty")).toBeTruthy());
    expect(screen.queryByTestId("attention-empty")).toBeNull();
  });

  it("is unavailable, with retry, when nothing could load", async () => {
    board.mockRejectedValue(new Error("down"));
    blocked.mockRejectedValue(new Error("down"));
    const screen = renderCenter();
    await waitFor(() => expect(screen.getByTestId("attention-unavailable")).toBeTruthy());
    expect(screen.queryByTestId("attention-empty")).toBeNull();
    expect(screen.queryByText(/0 items/)).toBeNull();
    // No filter row either: its counts would read "0" while nothing is actually known.
    expect(screen.queryByTestId("attention-filters")).toBeNull();
  });

  it("flags offline use and keeps the last known data", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-blocker:b-1"));
    mockState.isOnline = false;
    screen.rerender(wrap(<SupervisorAttentionScreen />));
    await waitFor(() => expect(screen.getByTestId("attention-offline")).toBeTruthy());
    expect(screen.getByTestId("attention-card-blocker:b-1")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("attention-stale-blocker:b-1")).toBeTruthy());
  });

  it("goes back to Today", async () => {
    const screen = renderCenter();
    fireEvent.press(screen.getByTestId("attention-back"));
    expect(mockRouter.back).toHaveBeenCalled();
    mockRouter.canGoBack.mockReturnValueOnce(false);
    fireEvent.press(screen.getByTestId("attention-back"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/home");
  });
});

describe("Supervisor Attention Center — detail sheet and navigation", () => {
  it("opens the sheet with why, details and source — and navigating happens only from its primary action", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-room:r-301:arrival_at_risk"));
    fireEvent.press(screen.getByTestId("attention-card-room:r-301:arrival_at_risk"));
    expect(await screen.findByTestId("attention-sheet-why")).toHaveTextContent(/guest is expected soon/);
    expect(screen.getByTestId("attention-sheet-severity")).toHaveTextContent(/Urgent/);
    expect(screen.getByTestId("attention-sheet-source")).toHaveTextContent(/From the room board/);
    expect(screen.getByTestId("attention-sheet-fact-0")).toHaveTextContent(/Status: Vacant Dirty/);
    expect(mockRouter.push).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("attention-sheet-primary"));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "r-301" } });
    await waitFor(() => expect(screen.queryByTestId("attention-sheet")).toBeNull());
  });

  it("routes every category to a supervisor screen — never My Rooms or the housekeeper Attention Center", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-blocker:b-1"));
    const expectations: Array<[string, unknown]> = [
      ["queue:unassigned_rooms", "/(app)/assignments"],
      ["queue:awaiting_inspection", "/(app)/inspect"],
      ["blocker:b-1", "/(app)/tasks"],
      ["queue:access_restricted", { pathname: "/(app)/room-board", params: { roomId: "r-307" } }],
    ];
    for (const [id, destination] of expectations) {
      fireEvent.press(screen.getByTestId(`attention-card-${id}`));
      fireEvent.press(await screen.findByTestId("attention-sheet-primary"));
      expect(mockRouter.push).toHaveBeenLastCalledWith(destination);
    }
    expect(JSON.stringify(mockRouter.push.mock.calls)).not.toMatch(/my-rooms|\(app\)\/attention/);
  });

  it("a Do Not Disturb room explains the restriction and offers only a review — no way in", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-queue:access_restricted"));
    fireEvent.press(screen.getByTestId("attention-card-queue:access_restricted"));
    expect(await screen.findByTestId("attention-sheet-restriction")).toHaveTextContent(/not permission to enter/);
    expect(screen.getByTestId("attention-sheet-record-r-307")).toHaveTextContent(/Do Not Disturb/);
    expect(screen.getByTestId("attention-sheet-primary")).toHaveTextContent(/View room/);
    expect(screen.queryByText(/start cleaning|override|enter room/i)).toBeNull();
  });

  it("an item resolved while its sheet is open becomes a plain 'no longer active' state with no action", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-queue:awaiting_inspection"));
    fireEvent.press(screen.getByTestId("attention-card-queue:awaiting_inspection"));
    await screen.findByTestId("attention-sheet-primary");

    // Both rooms get inspected; a Realtime event arrives and the shared snapshot refreshes.
    board.mockResolvedValue(DEFAULT_ROOMS.map((room) => (room.status === "CLEAN" ? { ...room, status: "INSPECTED" } : room)));
    expect(realtimeHandler).toBeTruthy();
    await act(async () => {
      realtimeHandler?.();
      jest.advanceTimersByTime(1600);
    });
    await waitFor(() => expect(screen.getByTestId("attention-sheet-gone")).toBeTruthy());
    expect(screen.queryByTestId("attention-sheet-primary")).toBeNull();
    expect(screen.queryByTestId("attention-card-queue:awaiting_inspection")).toBeNull();
    fireEvent.press(screen.getByTestId("attention-sheet-gone-close"));
    await waitFor(() => expect(screen.queryByTestId("attention-sheet")).toBeNull());
  });

  it("warns inside the sheet when the phone is offline", async () => {
    const screen = renderCenter();
    await waitFor(() => screen.getByTestId("attention-card-blocker:b-1"));
    mockState.isOnline = false;
    screen.rerender(wrap(<SupervisorAttentionScreen />));
    fireEvent.press(screen.getByTestId("attention-card-blocker:b-1"));
    expect(await screen.findByTestId("attention-sheet-offline")).toBeTruthy();
    expect(await screen.findByTestId("attention-sheet-stale")).toBeTruthy();
  });
});

describe("Supervisor Attention Center — shared with Today", () => {
  it("Today's preview and the Center come from one snapshot: same order, and one load serves both", async () => {
    const screen = render(
      wrap(
        <>
          <SupervisorHome name="Sam Super" />
          <SupervisorAttentionScreen />
        </>,
      ),
    );
    await waitFor(() => screen.getByTestId("attention-card-blocker:b-1"));
    await waitFor(() => screen.getAllByTestId(/^today-attention-row-/));
    const preview = screen.getAllByTestId(/^today-attention-row-/).map((row) => row.props.testID.replace("today-attention-row-", ""));
    const full = screen.getAllByTestId(/^attention-card-/).map((card) => card.props.testID.replace("attention-card-", ""));
    expect(preview).toEqual(full.slice(0, preview.length));
    expect(preview.length).toBeLessThanOrEqual(3);
    // Today's "N more" plus its rows equals what the Center counts.
    const more = Number(screen.getByTestId("today-attention-more").props.children.toString().match(/\d+/)?.[0] ?? 0);
    expect(preview.length + more).toBe(full.length);
    // One fetch of each source served both screens.
    expect(board).toHaveBeenCalledTimes(1);
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it("opens the detail from a Today preview row and from View all", async () => {
    const screen = render(wrap(<SupervisorHome name="Sam Super" />));
    await waitFor(() => screen.getByTestId("today-attention-viewall"));
    fireEvent.press(screen.getByTestId("today-attention-viewall"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/supervisor-attention");
    fireEvent.press(screen.getAllByTestId(/^today-attention-row-/)[0]);
    expect(await screen.findByTestId("attention-sheet")).toBeTruthy();
  });

  it("uses one shared Realtime channel even with both screens mounted", async () => {
    const { supabase } = require("@/lib/supabase") as { supabase: { channel: jest.Mock } };
    supabase.channel.mockClear();
    render(
      wrap(
        <>
          <SupervisorHome name="Sam Super" />
          <SupervisorAttentionScreen />
        </>,
      ),
    );
    await waitFor(() => expect(board).toHaveBeenCalled());
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });
});

describe("Supervisor Attention route", () => {
  it("renders for a supervisor and redirects anyone else home", () => {
    const supervisor = render(wrap(<SupervisorAttentionRoute />));
    expect(supervisor.queryByTestId("redirect")).toBeNull();
    supervisor.unmount();
    for (const role of ["housekeeper", "engineer", "front_desk", "gm"]) {
      mockState.user = { ...mockState.user, role };
      const other = render(wrap(<SupervisorAttentionRoute />));
      expect(other.getByTestId("redirect")).toHaveTextContent("/(app)/home");
      other.unmount();
    }
  });

  it("makes no request for a person who is not a supervisor", () => {
    mockState.user = { ...mockState.user, role: "housekeeper" };
    render(wrap(<SupervisorAttentionRoute />));
    expect(board).not.toHaveBeenCalled();
    expect(blocked).not.toHaveBeenCalled();
  });
});
