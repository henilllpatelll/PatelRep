import React from "react";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen opened through deep links (Supervisor Today, the Attention Center, the Room Board): the
   tab and filter, a named room or person resolved against THIS hotel's verified board, safe messages for anything
   else, and no second sheet or channel. Only the network, the realtime channel, the router and the toast are doubled. */

let mockLanguage: Language = "en";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockRealtime: { handlers: Array<() => void> } = { handlers: [] };
const mockParams: Record<string, string | undefined> = {};

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
    // The real router clears the keys it is given; the screen reads fresh params on its next render.
    setParams: jest.fn((next: Record<string, unknown>) => {
      for (const key of Object.keys(next)) if (next[key] === undefined) delete mockParams[key];
    }),
  },
  useLocalSearchParams: () => ({ ...mockParams }),
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn(() => {
      const channel: { on: jest.Mock; subscribe: jest.Mock } = {
        on: jest.fn((_type: string, _filter: unknown, handler: () => void) => {
          mockRealtime.handlers.push(handler);
          return channel;
        }),
        subscribe: jest.fn(() => ({})),
      };
      return channel;
    }),
    removeChannel: jest.fn(),
  },
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

import { router } from "expo-router";
import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchLateCheckoutsVerified,
  fetchScheduledShifts,
  fetchShiftRoster,
  fetchWorkloadSettings,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { supabase } from "@/lib/supabase";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import { STAFF, hotelBoard } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const staffList = fetchAssignableStaff as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const text = (node: { props: { children?: unknown } }) => String(node.props.children);

const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

const rosterRows = () =>
  [["hk-1", "active"], ["hk-2", "on_break"], ["hk-3", "ended"]].map(([user_id, status]) => ({
    user_id,
    status,
    started_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  }));

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockRealtime.handlers = [];
  mockLanguage = "en";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  board.mockResolvedValue(hotelBoard());
  staffList.mockResolvedValue(STAFF);
  roster.mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (fetchWorkloadSettings as jest.Mock).mockResolvedValue({ targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: {} });
  (fetchScheduledShifts as jest.Mock).mockResolvedValue([]);
});

const loaded = (screen: ReturnType<typeof render>) => waitFor(() => expect(screen.queryByTestId("assignments-skeleton")).toBeNull());
const sheets = (screen: ReturnType<typeof render>) => screen.queryAllByTestId("assignment-sheet");
const selected = (screen: ReturnType<typeof render>, id: string) => screen.getByTestId(id).props.accessibilityState.selected;

/** Opens the screen with link params already on the route, as a push from another screen would. */
async function openWith(params: Record<string, string>) {
  Object.assign(mockParams, params);
  const screen = render(ui());
  await loaded(screen);
  return screen;
}

describe("Supervisor Today -> Assignments", () => {
  it("Unassigned opens Rooms with the Unassigned view on, and the link is consumed", async () => {
    const screen = await openWith({ tab: "rooms", filter: "unassigned" });
    await waitFor(() => expect(selected(screen, "assignments-quick-unassigned")).toBe(true));
    expect(selected(screen, "assignments-tab-rooms")).toBe(true);
    expect(screen.getByTestId("assignment-room-101")).toBeTruthy();
    expect(screen.queryByTestId("assignment-room-102")).toBeNull();
    expect(router.setParams).toHaveBeenCalled();
  });

  it("Urgent opens Rooms on the existing urgent priority view, not simply every dirty room", async () => {
    const screen = await openWith({ tab: "rooms", filter: "urgent" });
    await waitFor(() => expect(selected(screen, "assignments-quick-urgent")).toBe(true));
    expect(screen.getByTestId("assignment-room-201")).toBeTruthy();
    expect(screen.queryByTestId("assignment-room-101")).toBeNull();
  });

  it("a workload concern opens the Team tab", async () => {
    const screen = await openWith({ tab: "team" });
    await waitFor(() => expect(screen.getByTestId("team-card-hk-1")).toBeTruthy());
    expect(selected(screen, "assignments-tab-team")).toBe(true);
  });

  it("a person opens the Team tab and their drawer", async () => {
    const screen = await openWith({ staffId: "hk-1" });
    await waitFor(() => expect(screen.getByTestId("team-detail-name")).toBeTruthy());
    expect(text(screen.getByTestId("team-detail-name"))).toBe("Ana Torres");
    expect(selected(screen, "assignments-tab-team")).toBe(true);
  });

  it("a person who is not on this hotel's team fails safely: Team list plus a short message, no drawer", async () => {
    const screen = await openWith({ staffId: "someone-from-another-hotel" });
    await waitFor(() => expect(screen.getByTestId("assignments-link-missing")).toBeTruthy());
    expect(screen.queryByTestId("team-detail-name")).toBeNull();
    expect(screen.getByTestId("team-card-hk-1")).toBeTruthy();
    expect(screen.getByText(tr("assignments.v2.link.staffMissing"))).toBeTruthy();
  });

  it("malformed ids are dropped without a lookup or a message", async () => {
    const screen = await openWith({ roomId: "../../etc/passwd" });
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    expect(sheets(screen)).toHaveLength(0);
    expect(screen.queryByTestId("assignments-link-missing")).toBeNull();
  });
});

describe("room links", () => {
  it("opens that room's sheet when the room is on this hotel's board", async () => {
    const screen = await openWith({ roomId: "room-101" });
    await waitFor(() => expect(sheets(screen)).toHaveLength(1));
    expect(text(screen.getByTestId("assignment-sheet-number"))).toBe("101");
  });

  it("a room that is not on the board opens nothing and says so", async () => {
    const screen = await openWith({ roomId: "room-999" });
    await waitFor(() => expect(screen.getByTestId("assignments-link-missing")).toBeTruthy());
    expect(sheets(screen)).toHaveLength(0);
    expect(screen.getByText(tr("assignments.v2.link.roomMissing"))).toBeTruthy();
  });

  it("a link that arrives before the board loads waits, then opens once", async () => {
    let release: (rows: ReturnType<typeof hotelBoard>) => void = () => undefined;
    board.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    Object.assign(mockParams, { roomId: "room-101" });
    const screen = render(ui());
    expect(sheets(screen)).toHaveLength(0);
    await act(async () => release(hotelBoard()));
    await waitFor(() => expect(sheets(screen)).toHaveLength(1));
  });

  it("is single-use: a later refresh does not reopen a sheet the supervisor closed", async () => {
    const screen = await openWith({ roomId: "room-101" });
    await waitFor(() => expect(sheets(screen)).toHaveLength(1));
    fireEvent.press(screen.getByTestId("assignment-sheet-close"));
    await waitFor(() => expect(sheets(screen)).toHaveLength(0));
    await act(async () => { mockRealtime.handlers.forEach((handler) => handler()); });
    expect(sheets(screen)).toHaveLength(0);
  });

  it("never opens a second sheet for a repeated or different link", async () => {
    const screen = await openWith({ roomId: "room-101" });
    await waitFor(() => expect(sheets(screen)).toHaveLength(1));
    Object.assign(mockParams, { roomId: "room-201" });
    screen.rerender(ui());
    await waitFor(() => expect(text(screen.getByTestId("assignment-sheet-number"))).toBe("201"));
    expect(sheets(screen)).toHaveLength(1);
    Object.assign(mockParams, { roomId: "room-201" });
    screen.rerender(ui());
    expect(sheets(screen)).toHaveLength(1);
  });

  it("honouring links adds no subscription and no board fetch", async () => {
    const screen = await openWith({ roomId: "room-101" });
    await waitFor(() => expect(sheets(screen)).toHaveLength(1));
    const channels = (supabase.channel as jest.Mock).mock.calls.length;
    const fetches = board.mock.calls.length;
    Object.assign(mockParams, { tab: "team" });
    screen.rerender(ui());
    await waitFor(() => expect(selected(screen, "assignments-tab-team")).toBe(true));
    expect((supabase.channel as jest.Mock).mock.calls.length).toBe(channels);
    expect(board.mock.calls.length).toBe(fetches);
  });

  it("a link that was waiting when the signed-in hotel changed is dropped, not applied to the new hotel", async () => {
    let release: (rows: ReturnType<typeof hotelBoard>) => void = () => undefined;
    board.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    Object.assign(mockParams, { roomId: "room-101" });
    const screen = render(ui());
    mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    board.mockResolvedValue(hotelBoard());
    await act(async () => release(hotelBoard()));
    await waitFor(() => expect(screen.queryByTestId("assignments-skeleton")).toBeNull());
    expect(sheets(screen)).toHaveLength(0);
  });
});
