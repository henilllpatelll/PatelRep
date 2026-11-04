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
  listActiveWorkOrders: jest.fn(),
  getWorkOrderSummary: jest.fn(),
}));
let mockSync: {
  rows: unknown[];
  drafts: Array<{ scheduleId: string; label: string | null; answered: number; total: number; updatedAt: string }>;
  active: number[];
  loaded: boolean;
  refresh: jest.Mock;
};
jest.mock("@/lib/engineering/usePmSyncItems", () => ({ usePmSyncItems: () => mockSync }));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({
  useSettingsIdentity: () => ({ hotelName: "Fossil Creek Inn" }),
}));
let mockRole = "engineer";
let mockTenant = "h1";
let mockUserId = "u1";
let mockOnline = true;
let mockUnread = 0;
let mockPending = 0;
let mockAttention = 0;
let mockVerified = true;
const mockSyncRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/engineering/useEngineeringSyncSummary", () => ({
  useEngineeringSyncSummary: () => ({ waiting: mockPending, attention: mockAttention, verified: mockVerified, sending: false, refresh: mockSyncRefresh }),
}));
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
      unreadCount: mockUnread,
      pendingActions: [],
      user: { id: mockUserId, role: mockRole, tenant_id: mockTenant, language_pref: "en" },
    })),
  };
});

import { router } from "expo-router";
import { getWorkOrderSummary, listActiveWorkOrders } from "@/lib/api/workOrders";
import { listPmSchedules } from "@/lib/api/assets";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockActive = listActiveWorkOrders as jest.Mock;
const mockSummary = getWorkOrderSummary as jest.Mock;
const mockPm = listPmSchedules as jest.Mock;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

type Row = Record<string, unknown>;
/** Serves the whole active queue in the { orders, truncated } shape the Home screen reads (one request). */
function serve(byStatus: Partial<Record<string, Row[]>>, truncated = false) {
  mockActive.mockResolvedValue({ orders: Object.values(byStatus).flatMap((rows) => rows ?? []), truncated });
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
  mockTenant = "h1";
  mockUserId = "u1";
  mockOnline = true;
  mockUnread = 0;
  mockPending = 0;
  mockAttention = 0;
  mockVerified = true;
  serve({});
  mockPm.mockResolvedValue([]);
  mockSummary.mockResolvedValue(null);
  mockSync = { rows: [], drafts: [], active: [], loaded: true, refresh: jest.fn().mockResolvedValue(undefined) };
});

describe("EngineerHome header", () => {
  it("shows the label, greeting, hotel and a synced status only after data loaded", async () => {
    const { getByText, getByTestId } = renderHome();
    await waitFor(() => expect(getByText(/home\.engineer\.syncDone/)).toBeTruthy());
    expect(getByTestId("engineer-role").props.children).toBe("home.engineer.roleTechnician");
    expect(getByTestId("engineer-hotel").props.children).toBe("Fossil Creek Inn");
  });

  it("opens profile from the avatar", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-profile")).toBeTruthy());
    fireEvent.press(getByTestId("engineer-profile"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/profile");
  });

  it("opens Engineering Sync from the connection line", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-sync")).toBeTruthy());
    fireEvent.press(getByTestId("engineer-sync"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/engineering-sync");
  });

  it("never claims a sync when the queue failed to load", async () => {
    mockActive.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
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

describe("EngineerHome sync honesty", () => {
  it("asks for review (not 'synced') when a saved change was refused or is stuck", async () => {
    mockAttention = 2;
    const { getByText, queryByText } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.syncReview:count=2")).toBeTruthy());
    expect(queryByText(/home\.engineer\.syncDone/)).toBeNull();
  });

  it("never says synced, and never claims an all-clear, when a queue could not be read", async () => {
    mockVerified = false;
    const { getByText, queryByText, queryByTestId, getByTestId } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.syncUnverified")).toBeTruthy());
    expect(queryByText(/home\.engineer\.syncDone/)).toBeNull();
    expect(queryByTestId("attention-empty")).toBeNull();
    expect(getByTestId("engineer-sync")).toBeTruthy();
  });

  it("shows My Jobs as a lower bound when the queue was cut off and the exact count is unavailable", async () => {
    serve({ open: [wo({ id: "m1", assigned_to: "u1" }), wo({ id: "m2", assigned_to: "u1" })] }, true);
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 2+"));
    expect(getByTestId("summary-urgent").props.accessibilityLabel).toBe("home.engineer.cardUrgent: 0+");
  });

  it("prefers the server's exact own-work count over the cut-off queue", async () => {
    serve({ open: [wo({ id: "m1", assigned_to: "u1" })] }, true);
    mockSummary.mockResolvedValue({ urgent: 0, in_progress: 0, waiting: 1, total: 6 });
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 5"));
  });

  it("shows unknown, never 0, for every card when nothing could be read", async () => {
    mockActive.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    mockPm.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    for (const id of ["summary-my-jobs", "summary-urgent", "summary-pm-due"]) expect(getByTestId(id).props.accessibilityLabel).toContain("home.engineer.unavailable");
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
    mockActive.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
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

  it("uses the server's exact count of my active work (held work excluded) instead of the page-limited queue", async () => {
    serve({ open: [wo({ id: "o1", assigned_to: "u1" })] }, true);
    mockSummary.mockResolvedValue({ urgent: 1, inProgress: 2, waiting: 1, total: 7 });
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 6"));
  });

  it("falls back to the queue count when the summary request fails", async () => {
    serve({ open: [wo({ id: "o1", assigned_to: "u1" })] });
    mockSummary.mockRejectedValue(new Error("boom"));
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 1"));
  });

  it("sends each card to its destination", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("summary-my-jobs").props.accessibilityLabel).toBe("home.engineer.cardMyJobs: 0"));
    fireEvent.press(getByTestId("summary-my-jobs"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/work-orders", params: { view: "mine", filter: "actionable", nav: expect.any(String) } });
    fireEvent.press(getByTestId("summary-urgent"));
    // Urgent spans own, unclaimed and held work, so it opens the all view narrowed to urgent (never a single queue).
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/work-orders", params: { view: "all", filter: "urgent", nav: expect.any(String) } });
    fireEvent.press(getByTestId("summary-pm-due"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules");
  });
});

describe("EngineerHome primary card", () => {
  it("continues my in-progress job with number, room and a truthful started time, and opens it", async () => {
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
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/work-orders", params: { view: "mine", nav: expect.any(String) } });
  });

  it("offers the next assigned job by opening it (never starting it from Home) when nothing is in progress", async () => {
    serve({ open: [wo({ id: "mine-open", title: "Fix door closer", assigned_to: "u1", priority: "urgent" }), wo({ id: "free", title: "Unassigned" })] });
    const { getByTestId, getByText, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(getByText("Fix door closer")).toBeTruthy();
    expect(getByText("home.engineer.startNextKicker")).toBeTruthy();
    expect(queryByTestId("engineer-continue")).toBeNull();
    fireEvent.press(getByTestId("engineer-start-next"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders/mine-open");
    // The primary card's order is not repeated in Needs Attention.
    expect(queryByTestId("attention-wo:mine-open")).toBeNull();
  });

  it("never presents an unassigned or someone else's order as my job", async () => {
    serve({ open: [wo({ id: "free", title: "Unassigned", priority: "emergency" }), wo({ id: "theirs", title: "Theirs", assigned_to: "other" })] });
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus-available")).toBeTruthy());
    expect(queryByTestId("engineer-focus")).toBeNull();
  });

  it("resumes a real saved PM inspection draft through the existing inspection route", async () => {
    mockPm.mockResolvedValue([{ id: "pm1", asset_id: "a1", name: "Boiler inspection", interval_type: "monthly", next_due_at: day(5), is_active: true, assets: { name: "Mechanical Room" } }]);
    mockSync.drafts = [{ scheduleId: "pm1", label: "Boiler inspection", answered: 3, total: 8, updatedAt: new Date().toISOString() }];
    const { getByTestId, getByText } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus-pm")).toBeTruthy());
    expect(getByText("home.engineer.resumePmProgress:answered=3,total=8")).toBeTruthy();
    expect(getByText("home.engineer.resumePmLocal")).toBeTruthy();
    fireEvent.press(getByTestId("engineer-resume-pm"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules/inspect/pm1");
  });

  it("does not offer a draft whose schedule is no longer an active one", async () => {
    mockSync.drafts = [{ scheduleId: "gone", label: "Old", answered: 1, total: 4, updatedAt: new Date().toISOString() }];
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-caught-up")).toBeTruthy());
    expect(queryByTestId("engineer-focus-pm")).toBeNull();
  });

  it("shows the available-work card with the existing queue as its destination", async () => {
    serve({ open: [wo({ id: "free", title: "Unassigned" })] });
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus-available")).toBeTruthy());
    fireEvent.press(getByTestId("engineer-view-available"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/work-orders", params: { view: "available", nav: expect.any(String) } });
  });

  it("says caught up only when the queue, PM and drafts all loaded", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-caught-up")).toBeTruthy());
  });

  it("does not claim caught up when PM could not be read", async () => {
    mockPm.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByText, queryByText } = renderHome();
    await waitFor(() => expect(getByText("home.engineer.caughtUpPmUnknown")).toBeTruthy());
    expect(queryByText("home.engineer.caughtUp")).toBeNull();
  });

  it("never shows a healthy empty state when the queue failed", async () => {
    mockActive.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(queryByTestId("engineer-caught-up")).toBeNull();
    expect(queryByTestId("engineer-focus-available")).toBeNull();
  });

  it("still lets me resume a saved draft when the queue could not load (offline)", async () => {
    mockOnline = false;
    mockActive.mockRejectedValue(new Error("Network request failed"));
    mockSync.drafts = [{ scheduleId: "pm9", label: "Rooftop unit", answered: 2, total: 5, updatedAt: new Date().toISOString() }];
    mockPm.mockRejectedValue(new Error("Network request failed"));
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus-pm")).toBeTruthy());
    fireEvent.press(getByTestId("engineer-resume-pm"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules/inspect/pm9");
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
    // An overdue PM signal opens that schedule's detail, not just the list.
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules/pm1");
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

  it("does not claim a clear Needs Attention while saved actions are still waiting to sync", async () => {
    mockPending = 1;
    const { queryByTestId, getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-caught-up")).toBeTruthy());
    expect(queryByTestId("attention-empty")).toBeNull();
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

  it("previews the top three and View all expands the complete list in place", async () => {
    // Same-priority orders sort newest first, so give them strictly older timestamps: e0 is newest, e6 is the last.
    serve({ open: Array.from({ length: 7 }, (_, i) => wo({ id: `e${i}`, priority: "emergency", title: `Emergency ${i}`, created_at: new Date(Date.now() - i * 60_000).toISOString() })) });
    const { getByTestId, getByText, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("attention-view-all")).toBeTruthy());
    expect(getByText("home.engineer.attentionViewAll:count=7")).toBeTruthy();
    expect(queryByTestId("attention-wo:e3")).toBeNull();
    fireEvent.press(getByTestId("attention-view-all"));
    expect(getByTestId("attention-wo:e6")).toBeTruthy();
    expect(getByText("home.engineer.attentionShowLess")).toBeTruthy();
  });

  it("the full list includes PM, not just work orders", async () => {
    serve({ open: Array.from({ length: 3 }, (_, i) => wo({ id: `e${i}`, priority: "emergency", title: `Emergency ${i}`, created_at: new Date(Date.now() - i * 60_000).toISOString() })) });
    mockPm.mockResolvedValue([
      { id: "pm1", asset_id: "a1", name: "Boiler", interval_type: "monthly", next_due_at: day(-2), is_active: true },
      { id: "pm2", asset_id: "a2", name: "Filters", interval_type: "monthly", next_due_at: day(-3), is_active: true },
    ]);
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("attention-view-all")).toBeTruthy());
    expect(queryByTestId("attention-pm:pm1")).toBeNull();
    fireEvent.press(getByTestId("attention-view-all"));
    fireEvent.press(getByTestId("attention-pm:pm2"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/pm-schedules/pm2");
  });

  it("raises a blocked saved inspection that needs the person and opens Engineering Sync", async () => {
    mockSync.rows = [
      { rowId: 7, createdAt: new Date().toISOString(), attempts: 1, lastError: "conflict_completed", data: { phase: "queued", scheduleId: "pm1", scheduleName: "Boiler", evidence: [], confirmedAt: null } },
    ];
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("attention-sync:pm")).toBeTruthy());
    fireEvent.press(getByTestId("attention-sync:pm"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/engineering-sync");
  });
});

describe("EngineerHome load, error and refresh states", () => {
  it("shows an error with Retry, not an empty Continue card, when the queue fails", async () => {
    mockActive.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { getByTestId, queryByTestId, getByText } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(queryByTestId("engineer-no-active")).toBeNull();
    expect(getByText("engineeringState.loadFailed")).toBeTruthy();

    serve({ in_progress: [mine] });
    fireEvent.press(getByText("common.retry"));
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
  });

  it("explains a forbidden load", async () => {
    mockActive.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    const { getByText } = renderHome();
    await waitFor(() => expect(getByText("engineeringState.forbidden")).toBeTruthy());
  });

  it("explains offline with nothing cached, instead of an empty queue", async () => {
    mockOnline = false;
    mockActive.mockRejectedValue(new Error("Network request failed"));
    const { getByText, queryByTestId } = renderHome();
    await waitFor(() => expect(getByText("engineeringState.offline")).toBeTruthy());
    expect(queryByTestId("engineer-no-active")).toBeNull();
  });

  it("reads the whole active queue with a single request, never completed history", async () => {
    renderHome();
    await waitFor(() => expect(mockActive).toHaveBeenCalled());
    expect(mockActive).toHaveBeenCalledTimes(1);
    expect(mockActive).toHaveBeenCalledWith();
  });

  it("makes each request once on mount (no duplicate fetches)", async () => {
    renderHome();
    await waitFor(() => expect(mockPm).toHaveBeenCalledTimes(1));
    expect(mockActive).toHaveBeenCalledTimes(1);
    expect(mockSummary).toHaveBeenCalledTimes(1);
  });

  it("keeps the queue when only the summary fails", async () => {
    mockSummary.mockRejectedValue(new Error("boom"));
    serve({ in_progress: [mine] });
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(queryByTestId("engineer-load-error")).toBeNull();
  });
});

describe("EngineerHome quick actions", () => {
  it("opens Report an Issue, the existing asset scanner, Room Status and Available Work", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("quick-report")).toBeTruthy());

    fireEvent.press(getByTestId("quick-report"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders/new");
    fireEvent.press(getByTestId("quick-scan"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/assets/scan");
    fireEvent.press(getByTestId("quick-room"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/room-status");
    fireEvent.press(getByTestId("quick-available"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/work-orders", params: { view: "available", nav: expect.any(String) } });
  });

  it("shows exactly the four technician shortcuts", async () => {
    const { getByTestId, queryByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("quick-report")).toBeTruthy());
    expect(queryByTestId("quick-pm")).toBeNull();
    expect(queryByTestId("quick-find-asset")).toBeNull();
  });

  it("gives every quick action a button role and an accessible name", async () => {
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("quick-report")).toBeTruthy());
    for (const id of ["quick-report", "quick-scan", "quick-room", "quick-available"]) {
      expect(getByTestId(id).props.accessibilityRole).toBe("button");
      expect(getByTestId(id).props.accessibilityLabel).toBeTruthy();
    }
  });

  it("still navigates while offline or after a failed load (the destinations read their own state)", async () => {
    mockOnline = false;
    mockActive.mockRejectedValue(new Error("Network request failed"));
    const { getByTestId } = renderHome();
    await waitFor(() => expect(getByTestId("quick-scan")).toBeTruthy());
    fireEvent.press(getByTestId("quick-scan"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/assets/scan");
    fireEvent.press(getByTestId("quick-report"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders/new");
  });
});

describe("EngineerHome tenant and person isolation", () => {
  it("drops the previous hotel's queue immediately when the signed-in scope changes", async () => {
    serve({ open: [wo({ id: "emg", title: "Hotel one leak", priority: "emergency" })] });
    const { getByTestId, queryByTestId, rerender } = renderHome();
    await waitFor(() => expect(getByTestId("attention-wo:emg")).toBeTruthy());

    mockTenant = "h2";
    serve({});
    rerender(
      <ThemeProvider>
        <EngineerHome name="Dev Patel" />
      </ThemeProvider>,
    );
    expect(queryByTestId("attention-wo:emg")).toBeNull();
    await waitFor(() => expect(getByTestId("attention-empty")).toBeTruthy());
  });
});
