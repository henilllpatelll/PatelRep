import fs from "fs";
import path from "path";
import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnValue({}) }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoardVerified: jest.fn(),
  fetchAssignableStaff: jest.fn(),
  fetchShiftRoster: jest.fn(),
  fetchInspectionHistory: jest.fn(),
}));
jest.mock("@/lib/api/tasks", () => ({ fetchBlockedTasks: jest.fn() }));

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));

// The existing modals keep their own behaviour and tests; here they only prove they were opened.
jest.mock("@/components/supervisor/ShiftNoteModal", () => {
  const { Text } = require("react-native");
  return { __esModule: true, default: ({ visible }: { visible: boolean }) => (visible ? <Text testID="modal-shiftnote">note</Text> : null) };
});
jest.mock("@/components/supervisor/BroadcastModal", () => {
  const { Text } = require("react-native");
  return { __esModule: true, default: ({ visible }: { visible: boolean }) => (visible ? <Text testID="modal-broadcast">broadcast</Text> : null) };
});
jest.mock("@/components/supervisor/EndShiftModal", () => {
  const { Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ visible, snapshot }: { visible: boolean; snapshot: { ready: number } }) =>
      visible ? <Text testID="modal-endshift">{`ready:${snapshot.ready}`}</Text> : null,
  };
});
jest.mock("@/components/supervisor/DirectMessageModal", () => {
  const { Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ visible, recipientId, recipientMeta }: { visible: boolean; recipientId: string | null; recipientMeta?: string | null }) =>
      visible ? <Text testID="modal-dm">{`${recipientId}|${recipientMeta ?? ""}`}</Text> : null,
  };
});
const mockState: {
  user: { id: string; role: string; tenant_id: string; language_pref: string; full_name?: string };
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
import { fetchAssignableStaff, fetchBoardVerified, fetchInspectionHistory, fetchShiftRoster } from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";

const board = fetchBoardVerified as jest.Mock;
const staffList = fetchAssignableStaff as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const inspections = fetchInspectionHistory as jest.Mock;
const blocked = fetchBlockedTasks as jest.Mock;
const push = router.push as jest.Mock;

const NOW = Date.parse("2026-10-16T17:00:00Z"); // 12:00 in Chicago

function raw(roomId: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: roomId, status, rooms: { id: roomId, room_number: roomId.replace("r-", ""), floor: 1 }, ...extra };
}

/** 2 ready, 1 awaiting inspection, 1 working, 3 to clean (2 unassigned), 2 out of order → 8 in service. */
const REALISTIC_BOARD = [
  raw("r-101", "INSPECTED"),
  raw("r-102", "INSPECTED"),
  raw("r-103", "CLEAN", { assigned_to: "hk-1" }),
  raw("r-104", "IN_PROGRESS", { assigned_to: "hk-1" }),
  raw("r-105", "DIRTY", { assigned_to: "hk-2" }),
  raw("r-106", "DIRTY"),
  raw("r-107", "OCCUPIED"),
  raw("r-108", "INSPECTED"),
  raw("r-109", "OOO"),
  raw("r-110", "OOO"),
];
const STAFF = [
  { userId: "sup-1", name: "Sam Super", role: "housekeeping_supervisor" },
  { userId: "hk-1", name: "Maria R", role: "housekeeper" },
  { userId: "hk-2", name: "James L", role: "housekeeper" },
  { userId: "hk-3", name: "Idle Person", role: "housekeeper" },
];

function setup({
  rooms = REALISTIC_BOARD,
  rosterRows = [] as unknown[],
  rosterError = null as Error | null,
  inspectionRows = [] as unknown[],
  blockedItems = [] as unknown[],
} = {}) {
  board.mockImplementation(async () => rooms);
  staffList.mockImplementation(async () => STAFF);
  roster.mockImplementation(async () => {
    if (rosterError) throw rosterError;
    return rosterRows;
  });
  inspections.mockImplementation(async () => inspectionRows);
  blocked.mockImplementation(async () => ({ items: blockedItems, hasMore: false }));
}

function renderHome(name = "Sam Super") {
  return render(
    <ThemeProvider>
      <SupervisorHome name={name} />
    </ThemeProvider>,
  );
}

beforeAll(async () => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(NOW);
  await i18n.changeLanguage("en");
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockState.isOnline = true;
  mockState.unreadCount = 0;
  mockState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1", language_pref: "en" };
  setup();
});

describe("Supervisor Today — readiness", () => {
  it("shows ready ÷ in-service rooms and keeps awaiting-inspection out of ready", async () => {
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-readiness-ready").props.children).toBe("3 / 8 ready"));
    expect(screen.getByTestId("today-stat-toClean")).toHaveTextContent(/^3To clean$/);
    expect(screen.getByTestId("today-stat-working")).toHaveTextContent(/^1Working$/);
    expect(screen.getByTestId("today-stat-inspect")).toHaveTextContent(/^1Inspect$/);
    expect(screen.getByTestId("today-readiness-ooo")).toHaveTextContent("2 out-of-order rooms not counted");
  });

  it("never exceeds the denominator and handles an empty property", async () => {
    setup({ rooms: [] });
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-readiness-empty")).toBeTruthy());
    expect(screen.queryByTestId("today-readiness-bar")).toBeNull();
    expect(screen.queryByTestId("today-readiness-ready")).toBeNull();
  });

  it("shows 'unavailable' — not zero — when the board cannot be loaded", async () => {
    board.mockRejectedValue(new Error("down"));
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-readiness-unavailable")).toBeTruthy());
    expect(screen.getByText("Room data unavailable")).toBeTruthy();
    expect(screen.queryByTestId("today-readiness-ready")).toBeNull();
    expect(screen.queryByTestId("today-stat-toClean")).toBeNull();
  });

  it("states how fresh the figures are, using only the verified fetch time", async () => {
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-readiness-freshness")).toHaveTextContent("Updated just now"));
  });

  it("opens the supervisor Room Board from the readiness card", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-ready"));
    fireEvent.press(screen.getByTestId("today-readiness"));
    expect(push).toHaveBeenCalledWith("/(app)/room-board");
  });

  it("keeps the last data but labels it stale when offline, and says so", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-ready"));
    mockState.isOnline = false;
    screen.rerender(
      <ThemeProvider>
        <SupervisorHome name="Sam Super" />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("today-offline")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("today-readiness-freshness").props.children).toMatch(/^Offline — last updated /));
    expect(screen.getByTestId("today-readiness-ready").props.children).toBe("3 / 8 ready");
  });
});

describe("Supervisor Today — needs your attention", () => {
  it("shows at most three rows, most urgent first, with a 'View all' that opens the Attention Center", async () => {
    setup({
      rooms: [
        raw("r-101", "DIRTY", { fo_status: "VAC", checkin_time: new Date(NOW + 30 * 60_000).toISOString(), assigned_to: "hk-1" }),
        raw("r-102", "CLEAN", { assigned_to: "hk-1" }),
        raw("r-103", "DIRTY"),
        raw("r-104", "DIRTY", { dnd_flag: true, assigned_to: "hk-1" }),
      ],
    });
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-attention-row-room:r-101:arrival_at_risk")).toBeTruthy());
    const rows = screen.getAllByTestId(/^today-attention-row-/);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[0].props.testID).toBe("today-attention-row-room:r-101:arrival_at_risk");
    expect(screen.getByText("Room 101 needs attention")).toBeTruthy();
    expect(screen.getByTestId("today-attention-more")).toHaveTextContent("1 more item");
    fireEvent.press(screen.getByTestId("today-attention-viewall"));
    expect(push).toHaveBeenCalledWith("/(app)/supervisor-attention");
  });

  it("opens a detail sheet from each row; its primary action goes to a supervisor screen — never My Rooms", async () => {
    setup({ rooms: [raw("r-102", "CLEAN", { assigned_to: "hk-1" }), raw("r-103", "DIRTY")] });
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-attention-row-queue:awaiting_inspection"));
    fireEvent.press(screen.getByTestId("today-attention-row-queue:awaiting_inspection"));
    // Tapping a row explains first; nothing navigates yet.
    expect(push).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByTestId("attention-sheet-primary"));
    fireEvent.press(screen.getByTestId("today-attention-row-queue:unassigned_rooms"));
    fireEvent.press(await screen.findByTestId("attention-sheet-primary"));
    const paths = push.mock.calls.map((call) => call[0]);
    expect(paths).toEqual(["/(app)/inspect", "/(app)/assignments"]);
    expect(JSON.stringify(paths)).not.toMatch(/my-rooms|\/attention/);
  });

  it("says 'all caught up' only when the relevant sources really loaded", async () => {
    setup({ rooms: [raw("r-101", "INSPECTED")] });
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-attention-empty")).toBeTruthy());
    expect(screen.getByText("You're all caught up.")).toBeTruthy();
  });

  it("does not claim 'all caught up' when a source failed", async () => {
    blocked.mockRejectedValue(Object.assign(new Error("no"), { status: 500 }));
    setup({ rooms: [raw("r-101", "INSPECTED")] });
    blocked.mockRejectedValue(new Error("down"));
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-attention-incomplete")).toBeTruthy());
    expect(screen.queryByTestId("today-attention-empty")).toBeNull();
  });

  it("keeps showing real items when only some sources failed, and marks the list incomplete", async () => {
    setup({ rooms: [raw("r-102", "CLEAN", { assigned_to: "hk-1" })] });
    blocked.mockRejectedValue(new Error("down"));
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-attention-row-queue:awaiting_inspection")).toBeTruthy());
    expect(screen.getByTestId("today-attention-partial")).toBeTruthy();
  });
});

describe("Supervisor Today — team pulse", () => {
  it("shows real completion, not attendance, and never infers shifts from assignments", async () => {
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-team-row-hk-1")).toBeTruthy());
    expect(screen.getByText("1 of 2 rooms completed")).toBeTruthy();
    expect(screen.getByTestId("today-team-shift")).toHaveTextContent("0 on shift");
    // Roster verified and empty → they are "not clocked in", a recorded fact about the roster only.
    expect(screen.getByTestId("today-team-tag-hk-1")).toHaveTextContent("Not clocked in");
  });

  it("reports unknown availability — not zero — when the roster cannot be read", async () => {
    setup({ rosterError: Object.assign(new Error("forbidden"), { status: 403 }) });
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-team-row-hk-1")).toBeTruthy());
    expect(screen.getByTestId("today-team-shift")).toHaveTextContent("Shift status unavailable");
    expect(screen.queryByTestId("today-team-tag-hk-1")).toBeNull();
  });

  it("counts verified on-shift staff, excluding the signed-in supervisor", async () => {
    setup({
      rosterRows: [
        { user_id: "hk-1", status: "active", started_at: "2026-10-16T12:00:00Z" },
        { user_id: "sup-1", status: "active", started_at: "2026-10-16T12:00:00Z" },
      ],
    });
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-team-shift")).toHaveTextContent("1 on shift"));
    expect(screen.getByTestId("today-team-tag-hk-1")).toHaveTextContent("On shift");
  });

  it("previews at most three people and mentions housekeepers with no rooms", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-team-row-hk-1"));
    expect(screen.getAllByTestId(/^today-team-row-/).length).toBeLessThanOrEqual(3);
    expect(screen.getByTestId("today-team-norooms")).toHaveTextContent("1 housekeeper has no rooms");
  });

  it("opens Assignments from the header link, and a person's quick view from a row", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-team-row-hk-1"));
    fireEvent.press(screen.getByTestId("today-team-manage"));
    expect(push.mock.calls.map((call) => call[0])).toEqual(["/(app)/assignments"]);
    fireEvent.press(screen.getByTestId("today-team-row-hk-1"));
    expect(screen.getByTestId("staff-quick-sheet")).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(1); // the row alone does not navigate
  });

  it("quick view: View all assignments closes the sheet and opens Assignments", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-team-row-hk-1"));
    fireEvent.press(screen.getByTestId("today-team-row-hk-1"));
    fireEvent.press(screen.getByTestId("staff-quick-assignments"));
    expect(screen.queryByTestId("staff-quick-sheet")).toBeNull();
    expect(push).toHaveBeenCalledWith("/(app)/assignments");
  });

  it("quick view: Message opens the composer for that person with their verified status", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-team-row-hk-1"));
    fireEvent.press(screen.getByTestId("today-team-row-hk-1"));
    fireEvent.press(screen.getByTestId("staff-quick-message"));
    expect(screen.queryByTestId("staff-quick-sheet")).toBeNull(); // sheets never stack
    await waitFor(() => expect(screen.getByTestId("modal-dm")).toHaveTextContent(/^hk-1\|Housekeeper · .+/));
  });

  it("shows an unavailable state with retry when the board is down", async () => {
    board.mockRejectedValue(new Error("down"));
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-team-unavailable")).toBeTruthy());
  });
});

describe("Supervisor Today — header", () => {
  it("opens notifications and profile and shows the real unread count", async () => {
    mockState.unreadCount = 4;
    const screen = renderHome();
    expect(screen.getByTestId("today-bell-badge")).toHaveTextContent("4");
    fireEvent.press(screen.getByTestId("today-bell"));
    fireEvent.press(screen.getByTestId("today-profile"));
    expect(push.mock.calls.map((call) => call[0])).toEqual(["/(app)/notifications", "/(app)/profile"]);
  });

  it("shows no badge when nothing is unread", () => {
    const screen = renderHome();
    expect(screen.queryByTestId("today-bell-badge")).toBeNull();
  });

  it("greets by hotel-local time and first name, and shows the hotel-local date", () => {
    const screen = renderHome("Sam Super");
    expect(screen.getByText("Good afternoon, Sam")).toBeTruthy(); // 12:00 in Chicago → afternoon
    expect(screen.getByText("Friday, October 16")).toBeTruthy();
  });

  it("greets without a name when none is known", () => {
    const screen = renderHome("");
    expect(screen.getByText("Good afternoon")).toBeTruthy();
  });
});

describe("Supervisor Today — quick actions", () => {
  it("renders the four actions", async () => {
    const screen = renderHome();
    for (const key of ["shiftNote", "messageTeam", "messageStaff", "handoff"]) {
      expect(screen.getByTestId(`today-action-${key}`)).toBeTruthy();
    }
  });

  it("opens the existing Shift Note and Broadcast composers", async () => {
    const screen = renderHome();
    fireEvent.press(screen.getByTestId("today-action-shiftNote"));
    expect(screen.getByTestId("modal-shiftnote")).toBeTruthy();
    fireEvent.press(screen.getByTestId("today-action-messageTeam"));
    expect(screen.getByTestId("modal-broadcast")).toBeTruthy();
  });

  it("requires choosing a recipient before opening the direct-message composer", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-team-row-hk-1"));
    fireEvent.press(screen.getByTestId("today-action-messageStaff"));
    expect(screen.getByTestId("staff-picker-sheet")).toBeTruthy();
    expect(screen.queryByTestId("modal-dm")).toBeNull();
    expect(screen.queryByTestId("picker-sup-1")).toBeNull(); // not yourself
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    expect(screen.queryByTestId("staff-picker-sheet")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("modal-dm")).toHaveTextContent(/^hk-2\|/));
  });

  it("explains in the picker, with a retry, when the staff list is unavailable", async () => {
    staffList.mockRejectedValue(new Error("down"));
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-ready"));
    fireEvent.press(screen.getByTestId("today-action-messageStaff"));
    expect(screen.getByTestId("picker-failed")).toHaveTextContent("Couldn't load your staff list.");
    expect(screen.getByTestId("picker-retry")).toBeTruthy();
    expect(screen.queryByTestId("modal-dm")).toBeNull();
  });

  it("keeps Shift handoff available even when few rooms are clean", async () => {
    setup({ rooms: [raw("r-101", "DIRTY"), raw("r-102", "DIRTY"), raw("r-103", "DIRTY"), raw("r-104", "DIRTY"), raw("r-105", "DIRTY"), raw("r-106", "DIRTY"), raw("r-107", "DIRTY")] });
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-ready"));
    expect(screen.getByTestId("today-action-handoff")).toBeTruthy();
    fireEvent.press(screen.getByTestId("today-action-handoff"));
    expect(screen.getByTestId("modal-endshift")).toHaveTextContent("ready:0");
  });

  it("will not hand off counts it could not verify", async () => {
    board.mockRejectedValue(new Error("down"));
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-unavailable"));
    expect(screen.getByTestId("today-action-handoff")).toBeTruthy();
    fireEvent.press(screen.getByTestId("today-action-handoff"));
    expect(mockToast.error).toHaveBeenCalledWith("Room data unavailable. Refresh before handing off.");
    expect(screen.queryByTestId("modal-endshift")).toBeNull();
  });

  it("handles offline taps safely for every action", async () => {
    mockState.isOnline = false;
    const screen = renderHome();
    for (const key of ["shiftNote", "messageTeam", "messageStaff", "handoff"]) {
      fireEvent.press(screen.getByTestId(`today-action-${key}`));
    }
    expect(mockToast.error).toHaveBeenCalledTimes(4);
    expect(mockToast.error).toHaveBeenCalledWith("You're offline. Reconnect to send.");
    expect(screen.queryByTestId("modal-shiftnote")).toBeNull();
    expect(screen.queryByTestId("modal-broadcast")).toBeNull();
  });
});

describe("Supervisor Today — structure", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../components/home/SupervisorHome.tsx"), "utf8");

  it("no longer renders the floor mosaic, status tiles or the old conditional End Shift", () => {
    expect(source).not.toMatch(/FloorMosaic|HeroSignalRow|TeamLoadRow|RoomStatusTile/);
    expect(source).not.toMatch(/snapshot\.ready >= snapshot\.total/);
  });

  it("does not mount a second assistant or floating AI button (the layout owns it)", () => {
    expect(source).not.toMatch(/AssistantFab|AssistantSheet|AssistantProvider|FloatingAIButton|useAiCapability/);
  });

  it("never links to housekeeper-only screens", () => {
    expect(source).not.toMatch(/my-rooms|\/\(app\)\/attention/);
  });

  it("opens exactly one realtime channel per hotel and removes it on unmount", async () => {
    const { supabase } = require("@/lib/supabase");
    const screen = renderHome();
    await waitFor(() => expect(supabase.channel).toHaveBeenCalledTimes(1));
    screen.unmount();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("refreshes through the hook after a realtime event, debounced into one reload", async () => {
    const { supabase } = require("@/lib/supabase");
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-ready"));
    const handler = supabase.channel.mock.results[0].value.on.mock.calls[0][2] as () => void;
    board.mockClear();
    act(() => {
      handler();
      handler();
      handler();
    });
    await waitFor(() => expect(board).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it("does not leak one hotel's data into another", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-readiness-ready"));
    board.mockImplementation(async () => [raw("r-900", "INSPECTED")]);
    mockState.user = { id: "sup-2", role: "housekeeping_supervisor", tenant_id: "h2", language_pref: "en" };
    screen.rerender(
      <ThemeProvider>
        <SupervisorHome name="Other Super" />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("today-readiness-ready").props.children).toBe("1 / 1 ready"));
  });
});

describe("Supervisor Today — Spanish and accessibility", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders in Spanish", async () => {
    await i18n.changeLanguage("es");
    mockState.user = { ...mockState.user, language_pref: "es" };
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId("today-readiness-ready").props.children).toBe("3 / 8 listas"));
    expect(screen.getByText("Requiere tu atención")).toBeTruthy();
    expect(screen.getByText("Pulso del equipo")).toBeTruthy();
    expect(screen.getByText("Acciones rápidas")).toBeTruthy();
    expect(screen.getByText("Entrega de turno")).toBeTruthy();
  });

  it("gives every control a role and a label, with touch targets at least 44pt", async () => {
    const screen = renderHome();
    await waitFor(() => screen.getByTestId("today-team-row-hk-1"));
    for (const id of ["today-bell", "today-profile", "today-readiness", "today-team-manage", "today-action-shiftNote", "today-action-handoff"]) {
      const node = screen.getByTestId(id);
      expect(node.props.accessibilityRole).toMatch(/button|link/);
      expect(String(node.props.accessibilityLabel ?? "").length).toBeGreaterThan(0);
    }
    for (const id of ["today-bell", "today-profile", "today-action-shiftNote"]) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style) as { width?: number; minHeight?: number; height?: number };
      expect(Math.max(style.width ?? 0, style.minHeight ?? 0, style.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });
});
