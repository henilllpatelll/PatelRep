import React from "react";
import { act, render, fireEvent, waitFor, screen } from "@testing-library/react-native";

let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => mockParams),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && typeof o.count === "number" ? `${k}:${o.count}` : k),
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

type RealtimeHandler = () => void;
let mockRealtime: RealtimeHandler | null = null;
const mockRemoveChannel = jest.fn();
const mockChannel = jest.fn();
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (...args: unknown[]) => {
      mockChannel(...args);
      const chain = {
        on: (_e: string, _f: unknown, cb: RealtimeHandler) => {
          mockRealtime = cb;
          return chain;
        },
        subscribe: () => ({}),
      };
      return chain;
    },
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));
jest.mock("@/lib/api/workOrders", () => ({
  listWorkOrderPage: jest.fn(),
  claimWorkOrder: jest.fn(),
}));
const mockStore: { isOnline: boolean; user: Record<string, unknown>; hotelTimezone: string; lastSyncedAt: string | null } = {
  isOnline: true,
  user: { id: "u1", tenant_id: "t1", role: "engineer", language_pref: "en" },
  hotelTimezone: "America/Chicago",
  lastSyncedAt: null,
};
jest.mock("@/stores/appStore", () => ({ useAppStore: () => mockStore }));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
  getSyncQueueSummary: jest.fn().mockResolvedValue([]),
}));
const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/components/engineering/CreateWorkOrderModal", () => {
  const { View } = require("react-native");
  return function MockCreate({ visible }: { visible: boolean }) {
    return <View testID="create-modal" accessibilityLabel={visible ? "open" : "closed"} />;
  };
});

import { claimWorkOrder, listWorkOrderPage } from "@/lib/api/workOrders";
import { enqueueAction, getSyncQueueSummary } from "@/lib/offline/db";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { resetClaimConflictsForTests } from "@/lib/engineering/claimConflicts";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import WorkOrdersScreen from "@/app/(app)/work-orders/index";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { WorkOrderListParams } from "@/lib/engineering/workQueue";

const mockList = listWorkOrderPage as jest.Mock;
const mockClaim = claimWorkOrder as jest.Mock;

const ME = "u1";
let seq = 0;
const wo = (over: Partial<WorkOrder> = {}): WorkOrder => {
  seq += 1;
  return {
    id: `wo-${seq}`,
    title: `Job ${seq}`,
    status: "open",
    priority: "normal",
    assigned_to: null,
    category: "hvac",
    created_at: "2026-10-15T10:00:00Z",
    rooms: { room_number: "101" },
    ...over,
  };
};

/** A fake server: applies the request's filters, ordering-free paging and a real has_more. */
function server(rows: () => WorkOrder[], pageSize = 25) {
  mockList.mockImplementation(async (params: WorkOrderListParams, page = 1) => {
    let list = rows().filter((r) => !params.statuses || params.statuses.includes(r.status));
    if (params.mine) list = list.filter((r) => r.assigned_to === ME);
    if (params.unassigned) list = list.filter((r) => !r.assigned_to);
    if (params.assigned_to_others) list = list.filter((r) => r.assigned_to && r.assigned_to !== ME);
    if (params.priority) list = list.filter((r) => r.priority === params.priority);
    if (params.q) list = list.filter((r) => `${r.title} ${r.rooms?.room_number ?? ""} ${r.work_order_number ?? ""}`.toLowerCase().includes(params.q!.toLowerCase()));
    const start = (page - 1) * pageSize;
    return { orders: list.slice(start, start + pageSize), hasMore: start + pageSize < list.length };
  });
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <WorkOrdersScreen />
    </ThemeProvider>,
  );
}

const reqs = () => mockList.mock.calls.map(([params]) => params as WorkOrderListParams);

beforeEach(async () => {
  jest.clearAllMocks();
  seq = 0;
  mockParams = {};
  mockRealtime = null;
  mockStore.isOnline = true;
  mockStore.user = { id: ME, tenant_id: "t1", role: "engineer", language_pref: "en" };
  mockStore.lastSyncedAt = null;
  setQueueOwner("t1:u1");
  resetClaimConflictsForTests();
  await AsyncStorage.clear();
  (getSyncQueueSummary as jest.Mock).mockResolvedValue([]);
});

describe("My Work", () => {
  it("shows only my orders, grouped by what I can do next, with the number, room and priority", async () => {
    const rows = [
      wo({ id: "a", title: "AC not cooling", status: "in_progress", priority: "urgent", assigned_to: ME, work_order_number: "1042", rooms: { room_number: "312" } }),
      wo({ id: "b", title: "Loose handle", status: "open", assigned_to: ME }),
      wo({ id: "c", title: "Waiting on motor", status: "on_hold", assigned_to: ME, hold_reason_code: "awaiting_parts" }),
      wo({ id: "d", title: "Someone else's", status: "in_progress", assigned_to: "other" }),
      wo({ id: "e", title: "Unclaimed", status: "open" }),
    ];
    server(() => rows);
    renderScreen();
    await waitFor(() => expect(screen.getByText("AC not cooling")).toBeTruthy());
    expect(screen.getByText("WO-1042 · workQueue.roomLabel")).toBeTruthy();
    expect(screen.getByTestId("wo-priority-a").props.children).toBe("workQueue.priority.urgent");
    expect(screen.getByText("workQueue.groups.in_progress")).toBeTruthy();
    expect(screen.getByText("workQueue.groups.ready")).toBeTruthy();
    expect(screen.getByText("workQueue.groups.on_hold")).toBeTruthy();
    expect(screen.getByText("workOrders.holdReason.awaiting_parts")).toBeTruthy();
    expect(screen.queryByText("Someone else's")).toBeNull();
    expect(screen.queryByText("Unclaimed")).toBeNull();
    expect(screen.getByText("workQueue.action.continue")).toBeTruthy();
  });

  it("asks the server for my active work, priority first", async () => {
    server(() => []);
    renderScreen();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(reqs()[0]).toMatchObject({ mine: true, statuses: ["open", "escalated", "in_progress", "on_hold"], sort_by: "priority" });
  });

  it("opens the order when its card is pressed", async () => {
    server(() => [wo({ id: "a", title: "AC", status: "in_progress", assigned_to: ME })]);
    renderScreen();
    await waitFor(() => screen.getByText("AC"));
    fireEvent.press(screen.getByTestId("wo-a"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/work-orders/a");
  });

  it("says 'you're all caught up' only after a successful empty load, and offers Available", async () => {
    server(() => []);
    renderScreen();
    await waitFor(() => expect(screen.getByText("workQueue.empty.mine")).toBeTruthy());
    expect(screen.getByText("workQueue.empty.mineHint")).toBeTruthy();
    fireEvent.press(screen.getByTestId("wo-empty-action"));
    await waitFor(() => expect(reqs().some((r) => r.unassigned)).toBe(true));
  });
});

describe("views", () => {
  it("never loads history until Done is opened, and keeps each view's rows when switching back", async () => {
    server(() => [wo({ id: "m", title: "Mine", status: "in_progress", assigned_to: ME }), wo({ id: "o", title: "Open one" }), wo({ id: "d", title: "Finished", status: "completed", assigned_to: ME })]);
    renderScreen();
    await waitFor(() => screen.getByText("Mine"));
    expect(reqs().some((r) => r.statuses?.includes("completed"))).toBe(false);

    fireEvent.press(screen.getByTestId("wo-view-available"));
    await waitFor(() => screen.getByText("Open one"));
    fireEvent.press(screen.getByTestId("wo-view-done"));
    await waitFor(() => screen.getByText("Finished"));
    const before = mockList.mock.calls.length;
    fireEvent.press(screen.getByTestId("wo-view-mine"));
    await waitFor(() => screen.getByText("Mine"));
    expect(mockList.mock.calls.length).toBe(before);
  });

  it("hides Team from an engineer and shows it to a chief engineer, who sees colleagues' work but cannot claim", async () => {
    server(() => [wo({ id: "t", title: "Their repair", status: "in_progress", assigned_to: "sam", assigned_to_name: "Sam Ortiz" }), wo({ id: "u", title: "Free job" })]);
    const first = renderScreen();
    await waitFor(() => screen.getByTestId("wo-view-mine"));
    expect(screen.queryByTestId("wo-view-team")).toBeNull();
    first.unmount();

    mockStore.user = { ...mockStore.user, role: "chief_engineer" };
    renderScreen();
    await waitFor(() => screen.getByTestId("wo-view-team"));
    fireEvent.press(screen.getByTestId("wo-view-team"));
    await waitFor(() => screen.getByText("Their repair"));
    expect(screen.getByText(/workQueue.assignedTo/)).toBeTruthy();
    expect(reqs().at(-1)).toMatchObject({ assigned_to_others: true });
    fireEvent.press(screen.getByTestId("wo-view-available"));
    await waitFor(() => screen.getByText("Free job"));
    expect(screen.queryByText("workQueue.action.claim")).toBeNull();
  });

  it("Waiting shows the held reason, how long, and who has it", async () => {
    server(() => [wo({ id: "h", title: "Pump", status: "on_hold", assigned_to: "sam", assigned_to_name: "Sam", hold_reason_code: "awaiting_vendor", held_since: new Date(Date.now() - 125 * 60_000).toISOString() }), wo({ id: "n", title: "No record", status: "on_hold" })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-waiting"));
    await waitFor(() => screen.getByText("Pump"));
    expect(screen.getByText(/workOrders.holdReason.awaiting_vendor/)).toBeTruthy();
    expect(screen.getByText(/workQueue.waitingFor/)).toBeTruthy();
    // An order with no recorded reason says so instead of guessing one.
    expect(screen.getByText(/workQueue.holdReasonUnrecorded/)).toBeTruthy();
  });

  it("Done separates completed from cancelled", async () => {
    server(() => [wo({ id: "c", title: "Fixed it", status: "completed", assigned_to: ME }), wo({ id: "x", title: "Called off", status: "cancelled", assigned_to: ME })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-done"));
    await waitFor(() => screen.getByText("Fixed it"));
    expect(screen.queryByText("Called off")).toBeNull();
    expect(reqs().at(-1)).toMatchObject({ statuses: ["completed"], sort_by: "updated_at" });

    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-status-cancelled"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => screen.getByText("Called off"));
    expect(screen.queryByText("Fixed it")).toBeNull();
  });

  it("lands on the view Home asked for and opens the create sheet once for a fresh request", async () => {
    mockParams = { view: "available", new: "123" };
    server(() => [wo({ id: "o", title: "Open one" })]);
    renderScreen();
    await waitFor(() => screen.getByText("Open one"));
    expect(reqs()[0]).toMatchObject({ unassigned: true });
    expect(screen.getByTestId("create-modal").props.accessibilityLabel).toBe("open");
  });
});

describe("claiming", () => {
  const openRows = () => [wo({ id: "e", title: "Water leaking under sink", priority: "emergency" })];

  async function openAvailable() {
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-available"));
    await waitFor(() => screen.getByText("Water leaking under sink"));
  }

  it("confirms with the server, removes the card, and says where to find it", async () => {
    let rows = openRows();
    server(() => rows);
    mockClaim.mockImplementation(async () => {
      rows = [];
    });
    await openAvailable();
    fireEvent.press(screen.getByTestId("wo-claim-e"));
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("e"));
    await waitFor(() => expect(screen.queryByText("Water leaking under sink")).toBeNull());
    expect(mockToast.success).toHaveBeenCalledWith("workQueue.claimed");
  });

  it("shows a pending state and sends one request for a double tap", async () => {
    server(openRows);
    let finish: () => void = () => undefined;
    mockClaim.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await openAvailable();
    fireEvent.press(screen.getByTestId("wo-claim-e"));
    fireEvent.press(screen.getByTestId("wo-claim-e"));
    await act(async () => undefined);
    expect(mockClaim).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("explains a lost race and refreshes the list", async () => {
    let rows = openRows();
    server(() => rows);
    mockClaim.mockImplementation(async () => {
      rows = [];
      throw Object.assign(new Error("no longer open"), { status: 409 });
    });
    await openAvailable();
    const before = mockList.mock.calls.length;
    fireEvent.press(screen.getByTestId("wo-claim-e"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("workQueue.claimConflict"));
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText("Water leaking under sink")).toBeNull());
  });

  it("explains a permission refusal and keeps the card", async () => {
    server(openRows);
    mockClaim.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    await openAvailable();
    fireEvent.press(screen.getByTestId("wo-claim-e"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("workQueue.claimForbidden"));
    expect(screen.getByText("Water leaking under sink")).toBeTruthy();
  });

  it("offline: saves the claim, keeps the card in Available marked as queued, and does not call the API", async () => {
    mockStore.isOnline = false;
    server(openRows);
    await openAvailable();
    fireEvent.press(screen.getByTestId("wo-claim-e"));
    await waitFor(() => expect(enqueueAction).toHaveBeenCalledWith("work_order", "claim", { label: "Water leaking under sink" }, "e"));
    expect(mockClaim).not.toHaveBeenCalled();
    await waitFor(() => screen.getByTestId("wo-claim-queued-e"));
    expect(screen.getByText("workQueue.claimQueued")).toBeTruthy();
    expect(screen.getByText("Water leaking under sink")).toBeTruthy();
    expect(mockToast.info).toHaveBeenCalledWith("workQueue.claimSavedOffline");
  });

  it("restores the queued marker after a restart from the offline queue", async () => {
    (getSyncQueueSummary as jest.Mock).mockResolvedValue([{ id: 1, entity_type: "work_order", action: "claim", entity_id: "e", room_id: null, attempts: 0 }]);
    server(openRows);
    await openAvailable();
    await waitFor(() => screen.getByTestId("wo-claim-queued-e"));
  });

  it("tells the person when a claim they made offline was refused on sync", async () => {
    await AsyncStorage.setItem(
      "engineering.claimConflicts.v1:t1:u1",
      JSON.stringify([{ woId: "e", label: "WO-1045 · Sink", reason: "conflict", at: "2026-10-15T10:00:00Z" }]),
    );
    server(() => []);
    renderScreen();
    await waitFor(() => screen.getByTestId("claim-conflict-e"));
    expect(screen.getByText("workQueue.conflict.conflict")).toBeTruthy();
  });

  it("offers an Open action, not Claim, on escalated work nobody owns", async () => {
    server(() => [wo({ id: "esc", title: "Escalated leak", status: "escalated" }), wo({ id: "o", title: "Plain open" })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-available"));
    await waitFor(() => screen.getByText("Escalated leak"));
    expect(screen.getByTestId("wo-claim-o")).toBeTruthy();
    expect(screen.queryByTestId("wo-claim-esc")).toBeNull();
    expect(screen.getByText("workQueue.groups.needsOwner")).toBeTruthy();
  });
});

describe("search and filters", () => {
  it("searches the server after a pause, not on every keystroke, and not just the first page", async () => {
    server(() => [wo({ id: "a", title: "Noisy fan", status: "in_progress", assigned_to: ME, rooms: { room_number: "312" } }), wo({ id: "b", title: "Dripping", status: "in_progress", assigned_to: ME, rooms: { room_number: "415" } })]);
    renderScreen();
    await waitFor(() => screen.getByText("Noisy fan"));
    const before = mockList.mock.calls.length;
    fireEvent.changeText(screen.getByTestId("wo-search"), "4");
    fireEvent.changeText(screen.getByTestId("wo-search"), "41");
    fireEvent.changeText(screen.getByTestId("wo-search"), "415");
    expect(mockList.mock.calls.length).toBe(before);
    await waitFor(() => expect(reqs().at(-1)).toMatchObject({ q: "415" }));
    await waitFor(() => expect(screen.queryByText("Noisy fan")).toBeNull());
    expect(screen.getByText("Dripping")).toBeTruthy();
    expect(mockList.mock.calls.length).toBe(before + 1);
  });

  it("shows a no-match state (not 'all caught up') and clears search and filters in one tap", async () => {
    server(() => [wo({ title: "Noisy fan", status: "in_progress", assigned_to: ME })]);
    renderScreen();
    await waitFor(() => screen.getByText("Noisy fan"));
    fireEvent.changeText(screen.getByTestId("wo-search"), "zzz");
    await waitFor(() => screen.getByText("workQueue.empty.noMatches"));
    expect(screen.queryByText("workQueue.empty.mine")).toBeNull();
    fireEvent.press(screen.getByTestId("wo-clear-narrowing"));
    await waitFor(() => screen.getByText("Noisy fan"));
    expect(screen.getByTestId("wo-search").props.value).toBe("");
  });

  it("clears the search box with one tap", async () => {
    server(() => []);
    renderScreen();
    await waitFor(() => screen.getByTestId("wo-search"));
    fireEvent.changeText(screen.getByTestId("wo-search"), "abc");
    fireEvent.press(screen.getByTestId("wo-search-clear"));
    expect(screen.getByTestId("wo-search").props.value).toBe("");
  });

  it("applies a priority filter server-side, shows a removable chip, and keeps it when switching away and back", async () => {
    server(() => [wo({ id: "u", title: "Urgent job", priority: "urgent", status: "in_progress", assigned_to: ME }), wo({ id: "n", title: "Normal job", status: "in_progress", assigned_to: ME })]);
    renderScreen();
    await waitFor(() => screen.getByText("Normal job"));
    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-priority-urgent"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => expect(screen.queryByText("Normal job")).toBeNull());
    expect(reqs().at(-1)).toMatchObject({ priority: "urgent", mine: true });
    expect(screen.getByTestId("wo-chip-priority")).toBeTruthy();

    fireEvent.press(screen.getByTestId("wo-view-waiting"));
    fireEvent.press(screen.getByTestId("wo-view-mine"));
    await waitFor(() => screen.getByTestId("wo-chip-priority"));
    expect(screen.queryByText("Normal job")).toBeNull();

    fireEvent.press(screen.getByTestId("wo-chip-priority"));
    await waitFor(() => screen.getByText("Normal job"));
    expect(screen.queryByTestId("wo-chip-priority")).toBeNull();
  });

  it("combines category, location and date filters, and Reset clears them all", async () => {
    server(() => []);
    renderScreen();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-category-hvac"));
    fireEvent.changeText(screen.getByTestId("filter-floor"), "3");
    fireEvent.press(screen.getByTestId("filter-date-overdue"));
    fireEvent.press(screen.getByTestId("filter-sort-due"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => expect(reqs().at(-1)).toMatchObject({ category: "hvac", floor: 3, overdue: true, sort_by: "due_at", sort_dir: "asc" }));

    fireEvent.press(screen.getByTestId("wo-filter-open"));
    const afterFilters = mockList.mock.calls.length;
    fireEvent.press(screen.getByTestId("filter-reset"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    // Back to the unfiltered request: its rows are already cached, so no chips and no needless refetch.
    await waitFor(() => expect(screen.queryByTestId("wo-chip-category")).toBeNull());
    expect(screen.queryByTestId("wo-chip-location")).toBeNull();
    expect(screen.queryByTestId("wo-chip-date")).toBeNull();
    expect(screen.queryByTestId("wo-chip-sort")).toBeNull();
    expect(mockList.mock.calls.length).toBe(afterFilters);
  });

  it("keeps the draft unapplied until Show Results", async () => {
    server(() => []);
    renderScreen();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const before = mockList.mock.calls.length;
    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-priority-urgent"));
    expect(mockList.mock.calls.length).toBe(before);
  });
});

describe("large queues", () => {
  it("loads further pages on demand: over 100 orders, none missing, none repeated", async () => {
    const rows = Array.from({ length: 130 }, (_, i) => wo({ id: `big-${i}`, title: `Big ${i}`, assigned_to: ME, status: "in_progress" }));
    server(() => rows);
    renderScreen();
    await waitFor(() => screen.getByTestId("wo-load-more"));
    for (let i = 0; i < 5; i += 1) {
      const button = screen.queryByTestId("wo-load-more");
      if (!button) break;
      fireEvent.press(button);
      await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(i + 1));
    }
    await waitFor(() => expect(screen.queryByTestId("wo-load-more")).toBeNull());
    const pages = mockList.mock.calls.map((c) => c[1] ?? 1);
    expect(pages).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("honest states", () => {
  const failure = (status = 500) => Object.assign(new Error("boom"), { status });

  it("shows an error with Retry rather than 'all caught up' when the load fails", async () => {
    mockList.mockRejectedValue(failure());
    renderScreen();
    await waitFor(() => screen.getByText("engineeringState.loadFailed"));
    expect(screen.queryByText("workQueue.empty.mine")).toBeNull();
    server(() => [wo({ title: "Recovered", status: "in_progress", assigned_to: ME })]);
    fireEvent.press(screen.getByText("common.retry"));
    await waitFor(() => screen.getByText("Recovered"));
    expect(screen.queryByText("engineeringState.loadFailed")).toBeNull();
  });

  it("says so when the role is not allowed", async () => {
    mockList.mockRejectedValue(failure(403));
    renderScreen();
    await waitFor(() => screen.getByText("engineeringState.forbidden"));
  });

  it("offline with nothing cached says offline, not empty", async () => {
    mockStore.isOnline = false;
    mockList.mockRejectedValue(new Error("Network request failed"));
    renderScreen();
    await waitFor(() => screen.getByText("engineeringState.offline"));
    expect(screen.queryByText("workQueue.empty.mine")).toBeNull();
  });

  it("keeps rows and warns when a refresh fails after a good load", async () => {
    const rows = [wo({ title: "Still here", status: "in_progress", assigned_to: ME })];
    server(() => rows);
    renderScreen();
    await waitFor(() => screen.getByText("Still here"));
    mockList.mockRejectedValue(failure());
    await act(async () => {
      mockRealtime?.();
      await new Promise((r) => setTimeout(r, 900));
    });
    await waitFor(() => screen.getByTestId("engineering-stale-banner"));
    expect(screen.getByText("Still here")).toBeTruthy();
  });

  it("shows cached rows with an offline notice when the connection is lost", async () => {
    server(() => [wo({ title: "Cached job", status: "in_progress", assigned_to: ME })]);
    const view = renderScreen();
    await waitFor(() => screen.getByText("Cached job"));
    mockStore.isOnline = false;
    view.rerender(
      <ThemeProvider>
        <WorkOrdersScreen />
      </ThemeProvider>,
    );
    await waitFor(() => screen.getByTestId("wo-offline-cached"));
    expect(screen.getByText("Cached job")).toBeTruthy();
  });
});

describe("live updates", () => {
  it("subscribes once per hotel, reloads in place on a change (no duplicate cards), and cleans up", async () => {
    let rows = [wo({ id: "a", title: "First", status: "in_progress", assigned_to: ME })];
    server(() => rows);
    const view = renderScreen();
    await waitFor(() => screen.getByText("First"));
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith("work-orders-queue:t1");

    rows = [rows[0], wo({ id: "b", title: "Second", status: "in_progress", assigned_to: ME })];
    await act(async () => {
      mockRealtime?.();
      mockRealtime?.(); // a burst of events coalesces
      await new Promise((r) => setTimeout(r, 900));
    });
    await waitFor(() => screen.getByText("Second"));
    expect(screen.getAllByText("First")).toHaveLength(1);
    expect(screen.getAllByText("Second")).toHaveLength(1);
    expect(mockChannel).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });

  it("resets to the new hotel when the property changes: no old rows, a new subscription", async () => {
    const t1 = [wo({ id: "a", title: "Hotel one job", status: "in_progress", assigned_to: ME })];
    const t2 = [wo({ id: "z", title: "Hotel two job", status: "in_progress", assigned_to: ME })];
    let tenant = "t1";
    server(() => (tenant === "t1" ? t1 : t2));
    const view = renderScreen();
    await waitFor(() => screen.getByText("Hotel one job"));

    tenant = "t2";
    mockStore.user = { ...mockStore.user, tenant_id: "t2" };
    view.rerender(
      <ThemeProvider>
        <WorkOrdersScreen />
      </ThemeProvider>,
    );
    await waitFor(() => screen.getByText("Hotel two job"));
    expect(screen.queryByText("Hotel one job")).toBeNull();
    expect(mockChannel).toHaveBeenLastCalledWith("work-orders-queue:t2");
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });
});
