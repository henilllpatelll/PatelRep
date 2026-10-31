import React from "react";
import { render, fireEvent, waitFor, waitForElementToBeRemoved } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o)
        ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}`
        : k,
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnValue({}),
    }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/lib/api/workOrders", () => ({
  listAllWorkOrders: jest.fn(),
  listWorkOrders: jest.fn(),
}));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({
  useSettingsIdentity: () => ({ hotelName: "Fossil Creek Inn" }),
}));
let mockRole = "engineer";
let mockOnline = true;
let mockUnread = 0;
let mockPending = 0;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
      unreadCount: mockUnread,
      pendingActions: Array.from({ length: mockPending }, (_, i) => ({ id: `a${i}` })),
      user: { id: "u1", role: mockRole, tenant_id: "h1", language_pref: "en" },
    })),
  };
});

import { router } from "expo-router";
import { listAllWorkOrders } from "@/lib/api/workOrders";
import { listPmSchedules } from "@/lib/api/assets";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockAll = listAllWorkOrders as jest.Mock;
const mockPm = listPmSchedules as jest.Mock;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

type Row = Record<string, unknown>;
/** Serves each status its own rows, in the paged { orders, truncated } shape the Home screen reads. */
function serve(byStatus: Partial<Record<string, Row[]>>, truncated = false) {
  mockAll.mockImplementation(async (status: string) => ({ orders: byStatus[status] ?? [], truncated }));
}

function renderHome() {
  return render(
    <ThemeProvider>
      <EngineerHome name="Dev Patel" />
    </ThemeProvider>,
  );
}

const wo = (over: Row): Row => ({
  title: "Job",
  status: "open",
  priority: "normal",
  assigned_to: null,
  created_at: new Date().toISOString(),
  ...over,
});

const mine = wo({
  id: "wo-mine",
  title: "Replace fan-coil belt",
  status: "in_progress",
  priority: "urgent",
  rooms: { room_number: "209" },
  work_order_number: "WO-1042",
  category: "hvac",
  assigned_to: "u1",
  started_at: new Date(Date.now() - 22 * 60_000).toISOString(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "engineer";
  mockOnline = true;
  mockUnread = 0;
  mockPending = 0;
  serve({});
  mockPm.mockResolvedValue([]);
});

describe("EngineerHome header", () => {
  it("shows the label, greeting, hotel and a synced status only after data loaded", async () => {
    const { getByText, getByTestId } = renderHome();
    await waitFor(() => expect(getByText(/home\.engineer\.syncDone/)).toBeTruthy());
    expect(getByText("home.engineer.headerLabel")).toBeTruthy();
    expect(getByTestId("engineer-hotel").props.children).toBe("Fossil Creek Inn");
  });

  it("never claims a sync when the queue failed to load", async () => {
    mockAll.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByText, queryByText } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.syncFailedEmpty")).toBeTruthy());
    expect(queryByText(/home\.engineer\.syncDone/)).toBeNull();
  });

  it("says offline, with the last sync, instead of synced", async () => {
    const { getByText, rerender } = renderHome();
    await waitFor(() => expect(getByText(/home\.engineer\.syncDone/)).toBeTruthy());
    mockOnline = false;
    rerender(
      <ThemeProvider>
        <EngineerHome name="Dev Patel" />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByText(/home\.engineer\.syncOfflineSince/)).toBeTruthy());
  });

  it("shows waiting-to-sync actions and opens notifications from the bell", async () => {
    mockPending = 2;
    mockUnread = 3;
    const { getByText, getByTestId } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.syncPending:count=2")).toBeTruthy());
    fireEvent.press(getByTestId("engineer-bell"));
    expect(router.push).toHaveBeenCalledWith("/(app)/notifications");
  });
});

describe("EngineerHome summary cards", () => {
  it("counts My Jobs, Urgent (emergency included) and PM Due from live data", async () => {
    serve({
      open: [wo({ id: "o1", priority: "emergency" }), wo({ id: "o2", assigned_to: "u1" })],
      in_progress: [mine],
    });
    mockPm.mockResolvedValue([
      { id: "pm1", asset_id: "a1", name: "Filters", interval_type: "monthly", next_due_at: day(-3), is_active: true },
      { id: "pm2", asset_id: "a2", name: "Belts", interval_type: "weekly", next_due_at: day(30), is_active: true },
    ]);
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 2"));
    expect(getByTestId("summary-urgent").props.accessibilityLabel).toBe("home.engineer.cardUrgent: 2");
    expect(getByTestId("summary-pm-due").props.accessibilityLabel).toBe("home.engineer.cardPmDue: 1");
  });

  it("does not show zero when loading failed: the queue cards read unavailable", async () => {
    mockAll.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    mockPm.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: home.engineer.unavailable");
    expect(getByTestId("summary-pm-due").props.accessibilityLabel).toBe("home.engineer.cardPmDue: home.engineer.unavailable");
  });

  it("shows a lower-bound count when there may be more work than was read", async () => {
    serve({ open: [wo({ id: "o1", assigned_to: "u1" })] }, true);
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 1+"));
  });

  it("sends each card to its destination", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 0"));
    fireEvent.press(getByTestId("summary-my-jobs"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders");
    fireEvent.press(getByTestId("summary-urgent"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders");
    fireEvent.press(getByTestId("summary-pm-due"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules");
  });
});

describe("EngineerHome Continue Working", () => {
  it("shows my in-progress job with number, room and a truthful started time, and opens it", async () => {
    serve({ in_progress: [mine, wo({ id: "theirs", title: "Not mine", status: "in_progress", assigned_to: "other" })] });
    const { getByText, getByTestId, queryByText } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(getByText("Replace fan-coil belt")).toBeTruthy();
    expect(getByText("WO-1042 · home.engineer.roomLabel:room=209")).toBeTruthy();
    expect(getByText(/home\.engineer\.startedAt/)).toBeTruthy();
    expect(queryByText("Not mine")).toBeNull();
    fireEvent.press(getByTestId("engineer-continue"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-mine");
  });

  it("offers a way to the Work queue when several jobs are in progress", async () => {
    serve({ in_progress: [mine, { ...mine, id: "wo-2", priority: "normal", title: "Second" }] });
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-more-active")).toBeTruthy());
    fireEvent.press(getByTestId("engineer-more-active"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders");
  });

  it("shows a compact empty state with an action when nothing is in progress", async () => {
    serve({ open: [wo({ id: "o1" })] });
    const { getByTestId, getByText } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-no-active")).toBeTruthy());
    expect(getByText("home.engineer.noActiveTitle")).toBeTruthy();
    fireEvent.press(getByTestId("engineer-view-work"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders");
  });

  it("gives a chief engineer a view-only action, never a claim or continue", async () => {
    mockRole = "chief_engineer";
    serve({ in_progress: [mine] });
    const { getByText, queryByText } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.viewOrder")).toBeTruthy());
    expect(queryByText("home.engineer.continueRepair")).toBeNull();
  });
});

describe("EngineerHome Needs Attention", () => {
  it("lists an emergency first with its room and 'not assigned', and opens it", async () => {
    serve({
      open: [wo({ id: "emg", title: "Water leaking under sink", priority: "emergency", rooms: { room_number: "415" } })],
      escalated: [wo({ id: "late", title: "Late job", status: "escalated", due_at: day(-1) })],
    });
    mockPm.mockResolvedValue([
      { id: "pm1", asset_id: "a1", name: "Boiler inspection", interval_type: "monthly", next_due_at: day(-2), is_active: true, assets: { name: "Mechanical Room" } },
    ]);
    const { getByTestId, getByText } = renderHome();
    await waitFor(() => expect(getByTestId("attention-wo:emg")).toBeTruthy());
    expect(getByText("Water leaking under sink")).toBeTruthy();
    expect(getByTestId("attention-wo:emg").props.accessibilityLabel).toContain("home.engineer.reason.emergency");
    expect(getByTestId("attention-wo:emg").props.accessibilityLabel).toContain("home.engineer.notAssigned");
    expect(getByTestId("attention-pm:pm1")).toBeTruthy();
    fireEvent.press(getByTestId("attention-wo:emg"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders/emg");
    fireEvent.press(getByTestId("attention-pm:pm1"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules");
  });

  it("includes escalated work in the urgent count and in the list", async () => {
    serve({ escalated: [wo({ id: "esc", title: "Escalated leak", status: "escalated", priority: "emergency" })] });
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("attention-wo:esc")).toBeTruthy());
    expect(getByTestId("summary-urgent").props.accessibilityLabel).toBe("home.engineer.cardUrgent: 1");
  });

  it("is truthfully empty only when both sources loaded", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("attention-empty")).toBeTruthy());
  });

  it("does not claim all-clear when PM failed; it keeps the queue and offers Retry for PM", async () => {
    mockPm.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    serve({ open: [wo({ id: "emg", title: "Leak", priority: "emergency" })] });
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("pm-error")).toBeTruthy());
    expect(getByTestId("attention-wo:emg")).toBeTruthy();
    expect(queryByTestId("attention-empty")).toBeNull();
    mockPm.mockResolvedValue([]);
    fireEvent.press(getByTestId("pm-error"));
    await waitForElementToBeRemoved(() => queryByTestId("pm-error"));
  });

  it("shows only the most severe five and links to the rest", async () => {
    serve({ open: Array.from({ length: 7 }, (_, i) => wo({ id: `e${i}`, priority: "emergency", title: `Emergency ${i}` })) });
    const { getByTestId, getByText, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("attention-more")).toBeTruthy());
    expect(getByText("home.engineer.attentionMore:count=2")).toBeTruthy();
    expect(queryByTestId("attention-wo:e6")).toBeNull();
  });
});

describe("EngineerHome load, error and refresh states", () => {
  it("shows an error with Retry, not an empty Continue card, when the queue fails", async () => {
    mockAll.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByTestId, queryByTestId, getByText } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(queryByTestId("engineer-no-active")).toBeNull();
    expect(getByText("engineeringState.loadFailed")).toBeTruthy();

    serve({ in_progress: [mine] });
    fireEvent.press(getByText("common.retry"));
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
  });

  it("treats one failed status as a failure, never a quietly shorter queue", async () => {
    mockAll.mockImplementation(async (status: string) => {
      if (status === "escalated") throw Object.assign(new Error("boom"), { status: 500 });
      return { orders: status === "open" ? [wo({ id: "o1" })] : [], truncated: false };
    });
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(queryByTestId("engineer-no-active")).toBeNull();
  });

  it("explains a forbidden load", async () => {
    mockAll.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    const { getByText } = renderHome();
    await waitFor(() => expect(getByText("engineeringState.forbidden")).toBeTruthy());
  });

  it("explains offline with nothing cached, instead of an empty queue", async () => {
    mockOnline = false;
    mockAll.mockRejectedValue(new Error("Network request failed"));
    const { getByText, queryByTestId } = renderHome();
    await waitFor(() => expect(getByText("engineeringState.offline")).toBeTruthy());
    expect(queryByTestId("engineer-no-active")).toBeNull();
  });

  it("reads only the active statuses, never completed history", async () => {
    renderHome();
    await waitFor(() => expect(mockAll).toHaveBeenCalled());
    expect(mockAll.mock.calls.map((c) => c[0]).sort()).toEqual(["escalated", "in_progress", "on_hold", "open"]);
  });

  it("makes each request once on mount (no duplicate fetches)", async () => {
    renderHome();
    await waitFor(() => expect(mockPm).toHaveBeenCalledTimes(1));
    expect(mockAll).toHaveBeenCalledTimes(4);
  });
});

describe("EngineerHome quick actions", () => {
  it("opens Report Issue on the Work tab with a fresh request, and the other three destinations", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("quick-report")).toBeTruthy());

    fireEvent.press(getByTestId("quick-report"));
    const arg = (router.push as jest.Mock).mock.calls.at(-1)[0];
    expect(arg.pathname).toBe("/(app)/work-orders");
    expect(arg.params.new).toMatch(/^\d+$/);

    fireEvent.press(getByTestId("quick-room"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/room-status");
    fireEvent.press(getByTestId("quick-asset"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/assets");
    fireEvent.press(getByTestId("quick-pm"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules");
  });

  it("labels the asset action honestly: there is no scanner, so it is Find Asset", async () => {
    const { getByText, queryByText } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.quickAsset")).toBeTruthy());
    expect(queryByText(/scan/i)).toBeNull();
  });

  it("gives every quick action a button role and an accessible name", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("quick-report")).toBeTruthy());
    for (const id of ["quick-report", "quick-room", "quick-asset", "quick-pm"]) {
      expect(getByTestId(id).props.accessibilityRole).toBe("button");
      expect(getByTestId(id).props.accessibilityLabel).toBeTruthy();
    }
  });
});
