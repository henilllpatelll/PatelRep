import React from "react";
import { RefreshControl, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    mockFocusCb = cb;
    React.useEffect(() => cb(), [cb]);
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/housekeeping/roomDetail/BottomSheet", () => {
  const { View } = require("react-native");
  return {
    MAX_FONT_SCALE: 1.6,
    BottomSheet: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
      visible ? (
        <View testID="sheet-open">
          {children}
          {footer}
        </View>
      ) : null,
  };
});
let mockRealtime: (() => void) | null = null;
let mockFocusCb: (() => void) | null = null;
jest.mock("@/lib/supabase", () => {
  const channel: Record<string, jest.Mock> = {};
  channel.on = jest.fn((_e: unknown, _f: unknown, cb: () => void) => {
    mockRealtime = cb;
    return channel;
  });
  channel.subscribe = jest.fn().mockReturnValue({});
  return { supabase: { channel: jest.fn().mockReturnValue(channel), removeChannel: jest.fn() } };
});
jest.mock("@/lib/api/engineeringTeam", () => ({
  fetchTeamOverview: jest.fn(),
  fetchTechnicians: jest.fn(),
  assignWorkOrder: jest.fn(),
}));
jest.mock("@/lib/api/workOrders", () => ({ listActiveWorkOrders: jest.fn(), getWorkOrderSummary: jest.fn() }));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock("@/lib/engineering/usePmSyncItems", () => ({
  usePmSyncItems: () => ({ rows: [], drafts: [], active: [], loaded: true, refresh: jest.fn() }),
}));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({ useSettingsIdentity: () => ({ hotelName: "Fossil Creek Inn" }) }));
const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));

let mockRole = "chief_engineer";
let mockTenant = "h1";
let mockOnline = true;
let mockUnread = 0;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
      unreadCount: mockUnread,
      pendingActions: [],
      user: { id: "u1", role: mockRole, tenant_id: mockTenant, language_pref: "en" },
    })),
  };
});

import { router } from "expo-router";
import { assignWorkOrder, fetchTeamOverview, fetchTechnicians, type TeamOverview } from "@/lib/api/engineeringTeam";
import { listActiveWorkOrders, getWorkOrderSummary } from "@/lib/api/workOrders";
import { listPmSchedules } from "@/lib/api/assets";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import { darkTheme, lightTheme } from "@/components/shared/tokens";
import { APPEARANCE_STORAGE_KEY } from "@/lib/theme/appearance";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockOverview = fetchTeamOverview as jest.Mock;
const mockTechs = fetchTechnicians as jest.Mock;
const mockAssign = assignWorkOrder as jest.Mock;

const base = (over: Partial<TeamOverview> = {}): TeamOverview => ({
  generated_at: "2026-11-03T12:00:00Z",
  counts: { open: 6, overdue: 1, on_hold: 2, emergency: 1, unassigned: 3, needs_owner: 3, in_progress: 4, pm_overdue: 1 },
  rooms_down: { total: 2, past_expected_return: 1 },
  pm_oversight: {
    overdue: [{ id: "pm-1", name: "Boiler inspection", asset_name: "Boiler", next_due_at: "2026-10-30T00:00:00Z" }],
    overdue_total: 1,
    repeat_defects: [{ asset_id: "a-ahu", asset_name: "AHU 2", count: 3 }],
    repeat_window_days: 90,
  },
  technicians: [
    { user_id: "t1", name: "Jordan M.", active: 3, urgent: 1, on_hold: 0, overdue: 1 },
    { user_id: "t2", name: "Sam R.", active: 5, urgent: 0, on_hold: 1, overdue: 0 },
    { user_id: "t3", name: "Taylor K.", active: 2, urgent: 0, on_hold: 0, overdue: 0 },
  ],
  attention_counts: { emergency_unassigned: 1, urgent_overdue: 1, escalated: 0, on_hold: 1 },
  needs_attention: [
    { kind: "on_hold", id: "wo-hold", work_order_number: 1030, title: "Compressor part", priority: "normal", status: "on_hold", assigned_to: "t1", assigned_to_name: "Jordan M.", hold_reason_code: "awaiting_parts", due_at: null, room_id: null, room_number: null },
    { kind: "urgent_overdue", id: "wo-urg", work_order_number: 1040, title: "HVAC not cooling", priority: "urgent", status: "in_progress", assigned_to: "t2", assigned_to_name: "Sam R.", due_at: "2026-11-01T00:00:00Z", room_id: "r2", room_number: "310" },
    { kind: "emergency_unassigned", id: "wo-emg", work_order_number: 1045, title: "Water leaking under sink", priority: "emergency", status: "open", assigned_to: null, due_at: null, room_id: "r1", room_number: "415" },
  ],
  truncated: false,
  ...over,
});

const apiError = (status: number, message = "x") => Object.assign(new Error(message), { status });
const flat = (style: unknown) => StyleSheet.flatten(style as never) as { color?: string; width?: string };

function renderHome() {
  return render(
    <ThemeProvider>
      <EngineerHome name="Casey Patel" />
    </ThemeProvider>,
  );
}
const ready = (utils: ReturnType<typeof renderHome>) => waitFor(() => expect(utils.getByTestId("chief-priorities")).toBeTruthy());
const lastPush = () => (router.push as jest.Mock).mock.calls.at(-1)?.[0];

beforeEach(async () => {
  jest.clearAllMocks();
  resetAsyncResourceCache();
  await AsyncStorage.clear();
  mockRole = "chief_engineer";
  mockTenant = "h1";
  mockOnline = true;
  mockUnread = 0;
  mockRealtime = null;
  mockOverview.mockResolvedValue(base());
  mockTechs.mockResolvedValue(base().technicians);
  (listActiveWorkOrders as jest.Mock).mockResolvedValue({ orders: [], truncated: false });
  (getWorkOrderSummary as jest.Mock).mockResolvedValue(null);
  (listPmSchedules as jest.Mock).mockResolvedValue([]);
});

describe("role routing", () => {
  it("gives the chief engineer the management Home and never the technician one", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("summary-needs-owner")).toBeTruthy();
    expect(home.queryByTestId("summary-my-jobs")).toBeNull();
    expect(home.queryByTestId("engineer-focus")).toBeNull();
    expect(listActiveWorkOrders).not.toHaveBeenCalled();
  });

  it("gives an engineer the technician Home and never reads the management overview", async () => {
    mockRole = "engineer";
    const home = renderHome();
    await waitFor(() => expect(home.getByTestId("summary-my-jobs")).toBeTruthy());
    expect(home.queryByTestId("summary-needs-owner")).toBeNull();
    expect(home.queryByTestId("chief-priorities")).toBeNull();
    expect(mockOverview).not.toHaveBeenCalled();
    await waitFor(() => expect(home.queryByTestId("engineer-queue-state")).toBeNull());
  });

  it("swaps the whole screen on a role change and keeps no management data for the new role", async () => {
    const home = renderHome();
    await ready(home);
    mockRole = "engineer";
    home.rerender(
      <ThemeProvider>
        <EngineerHome name="Casey Patel" />
      </ThemeProvider>,
    );
    await waitFor(() => expect(home.getByTestId("summary-my-jobs")).toBeTruthy());
    expect(home.queryByTestId("chief-priorities")).toBeNull();
    expect(home.queryByText("Water leaking under sink")).toBeNull();
    expect(home.queryByTestId("priority-assign-wo-emg")).toBeNull();
  });

  it("offers no technician-only work order action anywhere on the chief Home", async () => {
    const home = renderHome();
    await ready(home);
    for (const text of ["home.engineer.continueRepair", "home.engineer.startNextAction", "home.engineer.viewAvailable"]) expect(home.queryByText(text)).toBeNull();
    expect(home.queryByTestId("quick-available")).toBeNull();
    for (const id of ["claim", "start-repair", "complete-repair"]) expect(home.queryByTestId(id)).toBeNull();
  });
});

describe("header", () => {
  it("shows the management heading, hotel, role and last sync, and keeps profile, bell and sync navigation", async () => {
    mockUnread = 4;
    const home = renderHome();
    await ready(home);
    expect(home.getByText("home.chief.heading")).toBeTruthy();
    expect(home.getByTestId("engineer-hotel").props.children).toBe("Fossil Creek Inn");
    expect(home.getByTestId("engineer-role").props.children).toBe("home.chief.roleLine:name=Casey");
    expect(home.getByText(/home\.engineer\.syncDone/)).toBeTruthy();
    expect(home.getByTestId("engineer-bell").props.accessibilityLabel).toBe("home.engineer.notificationsUnread:count=4");
    fireEvent.press(home.getByTestId("engineer-bell"));
    expect(lastPush()).toBe("/(app)/notifications");
    fireEvent.press(home.getByTestId("engineer-profile"));
    expect(lastPush()).toBe("/(app)/profile");
    fireEvent.press(home.getByTestId("engineer-sync"));
    expect(lastPush()).toBe("/(app)/engineering-sync");
  });

  it("does not say synced when the first read failed", async () => {
    mockOverview.mockRejectedValue(apiError(500));
    const home = renderHome();
    await waitFor(() => expect(home.getByTestId("chief-load-error")).toBeTruthy());
    expect(home.queryByText(/home\.engineer\.syncDone/)).toBeNull();
  });
});

describe("summary cards", () => {
  it("shows the server's exact Needs owner, In progress and On hold counts with accessible labels", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 3");
    expect(home.getByTestId("summary-in-progress").props.accessibilityLabel).toBe("home.chief.cardInProgress: 4");
    expect(home.getByTestId("summary-on-hold").props.accessibilityLabel).toBe("home.chief.cardOnHold: 2");
    expect(home.getByTestId("summary-on-hold").props.accessibilityRole).toBe("button");
  });

  it("opens the matching Work view for each card", async () => {
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("summary-needs-owner"));
    expect(lastPush()).toEqual({ pathname: "/(app)/work-orders", params: { view: "available", nav: expect.any(String) } });
    fireEvent.press(home.getByTestId("summary-in-progress"));
    expect(lastPush()).toEqual({ pathname: "/(app)/work-orders", params: { view: "team", filter: "in_progress", nav: expect.any(String) } });
    fireEvent.press(home.getByTestId("summary-on-hold"));
    expect(lastPush()).toEqual({ pathname: "/(app)/work-orders", params: { view: "waiting", nav: expect.any(String) } });
  });

  it("shows unavailable, never zero, while loading and when the read fails", async () => {
    let release!: (v: TeamOverview) => void;
    mockOverview.mockReturnValueOnce(new Promise<TeamOverview>((r) => (release = r)));
    const home = renderHome();
    for (const id of ["summary-needs-owner", "summary-in-progress", "summary-on-hold"]) {
      expect(home.getByTestId(id).props.accessibilityLabel).toContain("home.engineer.unavailable");
    }
    await act(async () => release(base()));
    await ready(home);
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 3");
  });

  it("shows an unavailable count for a field an older server does not send, not zero", async () => {
    const counts = { open: 6, overdue: 1, on_hold: 2, emergency: 1, unassigned: 3, pm_overdue: 1 };
    mockOverview.mockResolvedValue(base({ counts }));
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: home.engineer.unavailable");
    expect(home.getByTestId("summary-in-progress").props.accessibilityLabel).toContain("home.engineer.unavailable");
    expect(home.getByTestId("summary-on-hold").props.accessibilityLabel).toBe("home.chief.cardOnHold: 2");
  });

  it("marks counts as a minimum when the server read only part of the active work", async () => {
    mockOverview.mockResolvedValue(base({ truncated: true }));
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 3+");
    expect(home.getByTestId("priority-truncated")).toBeTruthy();
  });

  it("says every job has an owner only when the server confirms zero and counts are complete", async () => {
    mockOverview.mockResolvedValue(base({ counts: { ...base().counts, needs_owner: 0 } }));
    const a = renderHome();
    await ready(a);
    expect(a.getByTestId("chief-all-owned")).toBeTruthy();
    a.unmount();
    resetAsyncResourceCache();
    mockOverview.mockResolvedValue(base({ counts: { ...base().counts, needs_owner: 0 }, truncated: true }));
    const b = renderHome();
    await ready(b);
    expect(b.queryByTestId("chief-all-owned")).toBeNull();
  });
});

describe("property priorities", () => {
  const order = (home: ReturnType<typeof renderHome>) => home.queryAllByTestId(/^priority-(wo|rooms|pm|repeat)/).map((n) => n.props.testID as string);

  it("puts the emergency first, then urgent overdue, the room figure, then held work", async () => {
    const home = renderHome();
    await ready(home);
    expect(order(home)).toEqual(["priority-wo:wo-emg", "priority-wo:wo-urg", "priority-rooms-down", "priority-wo:wo-hold"]);
  });

  it("describes each work order with its number, room, title and owner or unassigned", async () => {
    const home = renderHome();
    await ready(home);
    const emergency = home.getByTestId("priority-wo:wo-emg").props.accessibilityLabel as string;
    for (const part of ["engineeringTeam.attention.emergency_unassigned", "WO-1045", "workQueue.roomLabel:room=415", "Water leaking under sink", "workQueue.unassigned"]) {
      expect(emergency).toContain(part);
    }
    expect(home.getByTestId("priority-wo:wo-urg").props.accessibilityLabel).toContain("workQueue.assignedTo:name=Sam R.");
  });

  it("opens the exact work order, and the existing room screen for the room figure", async () => {
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-wo:wo-emg"));
    expect(lastPush()).toEqual({ pathname: "/(app)/work-orders/[woId]", params: { woId: "wo-emg" } });
    fireEvent.press(home.getByTestId("priority-rooms-down"));
    expect(lastPush()).toBe("/(app)/room-status");
  });

  it("reports the room aggregate as the server gave it and fabricates no individual rooms", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("priority-rooms-down").props.accessibilityLabel).toContain("home.chief.roomsDownTitle:count=2");
    expect(home.queryAllByTestId(/^priority-room(?!s-down)/)).toHaveLength(0);
  });

  it("does not treat an open repair as a room being down", async () => {
    mockOverview.mockResolvedValue(base({ rooms_down: { total: 0, past_expected_return: 0 } }));
    const home = renderHome();
    await ready(home);
    expect(home.queryByTestId("priority-rooms-down")).toBeNull();
    expect(home.getByTestId("priority-wo:wo-emg")).toBeTruthy();
  });

  it("expands in place to include PM and repeated-defect rows, each opening its real record", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.queryByTestId("priority-pm:pm-1")).toBeNull();
    fireEvent.press(home.getByTestId("priority-view-all"));
    expect(order(home)).toEqual(["priority-wo:wo-emg", "priority-wo:wo-urg", "priority-rooms-down", "priority-wo:wo-hold", "priority-pm:pm-1", "priority-repeat:a-ahu"]);
    fireEvent.press(home.getByTestId("priority-pm:pm-1"));
    expect(lastPush()).toBe("/(app)/pm-schedules/pm-1");
    fireEvent.press(home.getByTestId("priority-repeat:a-ahu"));
    expect(lastPush()).toEqual({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a-ahu" } });
    fireEvent.press(home.getByTestId("priority-view-all"));
    expect(home.queryByTestId("priority-pm:pm-1")).toBeNull();
  });

  it("points to Team Overview for flagged work orders the server did not send", async () => {
    mockOverview.mockResolvedValue(base({ attention_counts: { emergency_unassigned: 1, urgent_overdue: 1, escalated: 0, on_hold: 4 } }));
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-more-in-team"));
    expect(lastPush()).toBe("/(app)/team");
  });

  it("shows a calm state only when nothing is flagged and every source was readable", async () => {
    mockOverview.mockResolvedValue(
      base({
        rooms_down: { total: 0, past_expected_return: 0 },
        pm_oversight: { overdue: [], overdue_total: 0, repeat_defects: [], repeat_window_days: 90 },
        attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 0, on_hold: 0 },
        needs_attention: [],
      }),
    );
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("priority-empty")).toBeTruthy();
    expect(order(home)).toEqual([]);
  });

  it("keeps work orders and marks PM unavailable when PM could not be read, with no all-clear", async () => {
    mockOverview.mockResolvedValue(base({ pm_oversight: null, needs_attention: [], attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 0, on_hold: 0 }, rooms_down: { total: 0, past_expected_return: 0 } }));
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("pm-unavailable")).toBeTruthy();
    expect(home.queryByTestId("priority-empty")).toBeNull();
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 3");
  });

  it("marks rooms unavailable (not zero) when the room figure could not be read", async () => {
    mockOverview.mockResolvedValue(base({ rooms_down: null }));
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("rooms-unavailable")).toBeTruthy();
    expect(home.getByTestId("oversight-rooms").props.accessibilityLabel).toContain("engineeringTeam.tiles.unknown");
    expect(home.getByTestId("priority-wo:wo-emg")).toBeTruthy();
  });
});

describe("assignment", () => {
  it("opens the existing sheet for that work order with its number, priority, room and the eligible technicians", async () => {
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t1")).toBeTruthy());
    expect(home.getByText("WO-1045 · workQueue.priority.emergency · workQueue.roomLabel:room=415")).toBeTruthy();
    expect(within(home.getByTestId("sheet-open")).getByText("Water leaking under sink")).toBeTruthy();
    expect(home.getByTestId("assign-tech-t2")).toBeTruthy();
    expect(home.getByTestId("assign-confirm").props.accessibilityState?.disabled).toBe(true);
  });

  it("never labels anyone as available", async () => {
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t1")).toBeTruthy());
    for (const word of [/available now/i, /clocked in/i, /on shift/i, /free/i]) expect(home.queryByText(word)).toBeNull();
  });

  it("assigns, refreshes the overview and counts after the server confirms, and only then reports success", async () => {
    mockAssign.mockResolvedValueOnce({ changed: true, assignedTo: "t3" });
    const after = base({
      counts: { ...base().counts, needs_owner: 2 },
      needs_attention: base().needs_attention.map((n) => (n.id === "wo-emg" ? { ...n, assigned_to: "t3", assigned_to_name: "Taylor K." } : n)),
    });
    mockOverview.mockResolvedValueOnce(base()).mockResolvedValueOnce(after);
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t3")).toBeTruthy());
    fireEvent.press(home.getByTestId("assign-tech-t3"));
    expect(mockToast.success).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(home.getByTestId("assign-confirm"));
    });
    expect(mockAssign).toHaveBeenCalledWith({ workOrderId: "wo-emg", assignedTo: "t3", expectedAssignedTo: null, note: undefined });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("engineeringTeam.assign.done:name=Taylor K."));
    await waitFor(() => expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 2"));
    expect(mockOverview).toHaveBeenCalledTimes(2);
    expect(home.getByTestId("priority-wo:wo-emg").props.accessibilityLabel).toContain("workQueue.assignedTo:name=Taylor K.");
    expect(home.queryByTestId("sheet-open")).toBeNull();
  });

  it("sends the assignee the manager saw when reassigning, so a stale view is detected", async () => {
    mockAssign.mockResolvedValueOnce({ changed: true, assignedTo: "t3" });
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-urg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t3")).toBeTruthy());
    expect(home.getByTestId("assign-current")).toBeTruthy();
    fireEvent.press(home.getByTestId("assign-tech-t3"));
    await act(async () => {
      fireEvent.press(home.getByTestId("assign-confirm"));
    });
    expect(mockAssign).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: "wo-urg", expectedAssignedTo: "t2" }));
  });

  it("explains a conflict, keeps the sheet open, shows no success and re-reads the overview", async () => {
    mockAssign.mockRejectedValueOnce(apiError(409, "Work order was already assigned"));
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t1")).toBeTruthy());
    fireEvent.press(home.getByTestId("assign-tech-t1"));
    await act(async () => {
      fireEvent.press(home.getByTestId("assign-confirm"));
    });
    await waitFor(() => expect(home.getByTestId("assign-error")).toBeTruthy());
    expect(home.getByText("engineeringTeam.assign.failure.conflict")).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(home.getByTestId("sheet-open")).toBeTruthy();
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(2));
  });

  it.each([
    [403, "not_allowed"],
    [500, "failed"],
  ])("shows a %s refusal as an error, never as success", async (status, failure) => {
    mockAssign.mockRejectedValueOnce(apiError(status));
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t1")).toBeTruthy());
    fireEvent.press(home.getByTestId("assign-tech-t1"));
    await act(async () => {
      fireEvent.press(home.getByTestId("assign-confirm"));
    });
    await waitFor(() => expect(home.getByText(`engineeringTeam.assign.failure.${failure}`)).toBeTruthy());
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("sends one request when confirm is pressed twice quickly", async () => {
    let resolve!: (v: { changed: boolean; assignedTo: string }) => void;
    mockAssign.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t1")).toBeTruthy());
    fireEvent.press(home.getByTestId("assign-tech-t1"));
    fireEvent.press(home.getByTestId("assign-confirm"));
    fireEvent.press(home.getByTestId("assign-confirm"));
    expect(mockAssign).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ changed: true, assignedTo: "t1" }));
  });

  it("reports an assignment that changed nothing as already done, not as a new assignment", async () => {
    mockAssign.mockResolvedValueOnce({ changed: false, assignedTo: "t1" });
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    await waitFor(() => expect(home.getByTestId("assign-tech-t1")).toBeTruthy());
    fireEvent.press(home.getByTestId("assign-tech-t1"));
    await act(async () => {
      fireEvent.press(home.getByTestId("assign-confirm"));
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("engineeringTeam.assign.alreadyDone"));
  });

  it("blocks assignment while offline: the control is disabled and says why", async () => {
    mockOnline = false;
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("priority-assign-wo-emg").props.accessibilityState).toEqual({ disabled: true });
    expect(home.getByTestId("priority-offline-note")).toBeTruthy();
    fireEvent.press(home.getByTestId("priority-assign-wo-emg"));
    expect(home.queryByTestId("sheet-open")).toBeNull();
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("offers no Assign on held work that has no owner or on room/PM rows", async () => {
    mockOverview.mockResolvedValue(
      base({
        needs_attention: [{ kind: "on_hold", id: "wo-held", work_order_number: 7, title: "Held", priority: "normal", status: "on_hold", assigned_to: null, due_at: null, room_id: null, room_number: null }],
        attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 0, on_hold: 1 },
      }),
    );
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("priority-wo:wo-held")).toBeTruthy();
    expect(home.queryByTestId("priority-assign-wo-held")).toBeNull();
    expect(home.queryAllByTestId(/^priority-assign-/)).toHaveLength(0);
  });
});

describe("team workload", () => {
  it("lists each technician's real active count with a bar relative to the busiest shown", async () => {
    const home = renderHome();
    await ready(home);
    const label = (id: string) => home.getByTestId(`workload-${id}`).props.accessibilityLabel as string;
    expect(label("t2")).toContain("Sam R.");
    expect(label("t2")).toContain("engineeringTeam.load.active:count=5");
    expect(label("t3")).toContain("engineeringTeam.load.active:count=2");
    const bar = (id: string) => flat(home.getByTestId(`workload-bar-${id}`, { includeHiddenElements: true }).props.style);
    expect(bar("t2")).toMatchObject({ width: "100%" });
    expect(bar("t3")).toMatchObject({ width: "40%" });
    expect(bar("t1")).toMatchObject({ width: "60%" });
  });

  it("states the meaning of the figures and invents no availability, capacity or percentage", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByText("home.chief.workloadNote")).toBeTruthy();
    for (const word of [/available/i, /overloaded/i, /capacity/i, /%/]) expect(home.queryByText(word)).toBeNull();
  });

  it("opens the technician's own work and the team overview", async () => {
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("workload-t1"));
    expect(lastPush()).toBe("/(app)/team/t1");
    fireEvent.press(home.getByTestId("workload-view-team"));
    expect(lastPush()).toBe("/(app)/team");
  });

  it("shows an accurate empty state when there are no technicians", async () => {
    mockOverview.mockResolvedValue(base({ technicians: [] }));
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("workload-empty")).toBeTruthy();
  });
});

describe("oversight and shortcuts", () => {
  it("opens rooms and the PM Plan from the aggregates", async () => {
    const home = renderHome();
    await ready(home);
    fireEvent.press(home.getByTestId("oversight-rooms"));
    expect(lastPush()).toBe("/(app)/room-status");
    fireEvent.press(home.getByTestId("oversight-pm"));
    expect(lastPush()).toEqual({ pathname: "/(app)/pm-schedules", params: { view: "plan" } });
  });

  it("shows four working management shortcuts and none for technician-only work", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.queryAllByTestId(/^quick-/)).toHaveLength(4);
    fireEvent.press(home.getByTestId("quick-assign"));
    expect(lastPush()).toEqual({ pathname: "/(app)/work-orders", params: { view: "available", nav: expect.any(String) } });
    fireEvent.press(home.getByTestId("quick-team"));
    expect(lastPush()).toBe("/(app)/team");
    fireEvent.press(home.getByTestId("quick-pm"));
    expect(lastPush()).toEqual({ pathname: "/(app)/pm-schedules", params: { view: "plan" } });
    fireEvent.press(home.getByTestId("quick-assets"));
    expect(lastPush()).toBe("/(app)/assets");
    expect(home.getByTestId("quick-pm").props.accessibilityLabel).toBe("home.chief.quickPm");
  });
});

describe("loading, error, offline and refresh", () => {
  it("shows the failure with a retry (not an empty or all-clear state) when the first read fails", async () => {
    mockOverview.mockRejectedValueOnce(apiError(500));
    const home = renderHome();
    await waitFor(() => expect(home.getByTestId("chief-load-error")).toBeTruthy());
    expect(home.queryByTestId("priority-empty")).toBeNull();
    expect(home.queryByTestId("chief-priorities")).toBeNull();
    fireEvent.press(home.getByText("common.retry"));
    await ready(home);
    expect(mockOverview).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good data and says it is stale when a refresh fails", async () => {
    const home = renderHome();
    await ready(home);
    mockOverview.mockRejectedValueOnce(apiError(500));
    await act(async () => {
      mockFocusCb?.();
    });
    await waitFor(() => expect(home.getByText(/home\.engineer\.syncFailed/)).toBeTruthy());
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 3");
    expect(home.getByTestId("priority-wo:wo-emg")).toBeTruthy();
  });

  it("shows an offline state with no cached data, and labels last-known data as offline when there is some", async () => {
    mockOnline = false;
    mockOverview.mockRejectedValue(new Error("Network request failed"));
    const empty = renderHome();
    await waitFor(() => expect(empty.queryByTestId("chief-load-state") ?? empty.queryByTestId("chief-load-error")).toBeTruthy());
    expect(empty.queryByTestId("chief-priorities")).toBeNull();
    empty.unmount();

    resetAsyncResourceCache();
    mockOnline = true;
    mockOverview.mockResolvedValue(base());
    const live = renderHome();
    await ready(live);
    mockOnline = false;
    live.rerender(
      <ThemeProvider>
        <EngineerHome name="Casey Patel" />
      </ThemeProvider>,
    );
    expect(live.getByText(/home\.engineer\.syncOfflineSince/)).toBeTruthy();
    expect(live.getByTestId("priority-wo:wo-emg")).toBeTruthy();
  });

  it("re-reads on pull-to-refresh", async () => {
    const home = renderHome();
    await ready(home);
    await act(async () => {
      home.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(2));
  });

  it("re-reads when the tab regains focus, but not on the first focus", async () => {
    const home = renderHome();
    await ready(home);
    expect(mockOverview).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockFocusCb?.();
    });
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(2));
  });

  it("coalesces a burst of realtime changes into one trailing read", async () => {
    jest.useFakeTimers();
    try {
      const home = renderHome();
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(home.getByTestId("chief-priorities")).toBeTruthy());
      expect(mockRealtime).toBeTruthy();
      mockOverview.mockClear();
      act(() => {
        mockRealtime?.();
        mockRealtime?.();
        mockRealtime?.();
      });
      expect(mockOverview).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1600);
      });
      expect(mockOverview).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores a slow older answer that arrives after a newer one", async () => {
    let releaseOld!: (v: TeamOverview) => void;
    mockOverview.mockReturnValueOnce(new Promise<TeamOverview>((r) => (releaseOld = r))).mockResolvedValueOnce(base({ counts: { ...base().counts, needs_owner: 9 } }));
    const home = renderHome();
    await act(async () => {
      mockFocusCb?.();
    });
    await waitFor(() => expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 9"));
    await act(async () => releaseOld(base({ counts: { ...base().counts, needs_owner: 1 } })));
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toBe("home.chief.cardNeedsOwner: 9");
  });
});

describe("tenant isolation", () => {
  it("drops the previous hotel's work orders and technicians immediately when the property changes", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByText("Water leaking under sink")).toBeTruthy();

    let release!: (v: TeamOverview) => void;
    mockOverview.mockReturnValueOnce(new Promise<TeamOverview>((r) => (release = r)));
    mockTenant = "h2";
    home.rerender(
      <ThemeProvider>
        <EngineerHome name="Casey Patel" />
      </ThemeProvider>,
    );
    expect(home.queryByText("Water leaking under sink")).toBeNull();
    expect(home.queryByText("Sam R.")).toBeNull();
    expect(home.getByTestId("summary-needs-owner").props.accessibilityLabel).toContain("home.engineer.unavailable");
    await act(async () => release(base({ needs_attention: [], technicians: [], attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 0, on_hold: 0 }, counts: { ...base().counts, needs_owner: 0 } })));
    await waitFor(() => expect(home.getByTestId("workload-empty")).toBeTruthy());
    expect(home.queryByText("Water leaking under sink")).toBeNull();
  });
});

describe("accessibility and theming", () => {
  it("caps text scaling, marks section titles as headers and keeps touch targets at 48dp or more", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByText("home.chief.prioritiesTitle").props.accessibilityRole).toBe("header");
    expect(home.getByText("home.chief.workloadTitle").props.accessibilityRole).toBe("header");
    expect(home.getByText("home.chief.prioritiesTitle").props.maxFontSizeMultiplier).toBe(1.4);
    expect(home.getByText("Water leaking under sink").props.maxFontSizeMultiplier).toBe(1.4);
    const minHeight = (id: string) => (StyleSheet.flatten(home.getByTestId(id).props.style) as { minHeight?: number }).minHeight ?? 0;
    expect(minHeight("quick-assign")).toBeGreaterThanOrEqual(48);
    expect(minHeight("oversight-rooms")).toBeGreaterThanOrEqual(48);
    expect(minHeight("priority-assign-wo-emg")).toBeGreaterThanOrEqual(44);
  });

  it("conveys urgency in words as well as colour", async () => {
    const home = renderHome();
    await ready(home);
    expect(home.getByTestId("priority-wo:wo-emg").props.accessibilityLabel).toContain("engineeringTeam.attention.emergency_unassigned");
    expect(home.getByTestId("oversight-rooms").props.accessibilityLabel).toContain("home.chief.roomsPastReturn");
  });

  it("uses theme tokens: dark mode swaps the text colour and light is untouched", async () => {
    const light = renderHome();
    await ready(light);
    expect(flat(light.getByText("Water leaking under sink").props.style).color).toBe(lightTheme.textPrimary);
    light.unmount();
    resetAsyncResourceCache();

    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
    const dark = renderHome();
    await ready(dark);
    await waitFor(() => expect(flat(dark.getByText("Water leaking under sink").props.style).color).toBe(darkTheme.textPrimary));
  });
});
