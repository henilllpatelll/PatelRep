import React from "react";
import { act, render, fireEvent, waitFor, screen } from "@testing-library/react-native";
import { FlatList } from "react-native";

jest.setTimeout(20000);

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
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => {
      const chain = { on: () => chain, subscribe: () => ({}) };
      return chain;
    },
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/lib/api/workOrders", () => ({
  listWorkOrderPage: jest.fn(),
  claimWorkOrder: jest.fn(),
  getWorkOrderSummary: jest.fn(),
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
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), info: jest.fn(), error: jest.fn() }) }));

import { getWorkOrderSummary, listWorkOrderPage } from "@/lib/api/workOrders";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { resetClaimConflictsForTests } from "@/lib/engineering/claimConflicts";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import WorkOrdersScreen from "@/app/(app)/work-orders/index";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { WorkOrderListParams } from "@/lib/engineering/workQueue";

const mockList = listWorkOrderPage as jest.Mock;
const mockSummary = getWorkOrderSummary as jest.Mock;

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

/** A fake server that applies the request's filters and pages like the real one. */
function server(rows: () => WorkOrder[], pageSize = 25) {
  mockList.mockImplementation(async (params: WorkOrderListParams, page = 1) => {
    let list = rows().filter((r) => !params.statuses || params.statuses.includes(r.status));
    if (params.mine) list = list.filter((r) => r.assigned_to === ME);
    if (params.unassigned) list = list.filter((r) => !r.assigned_to);
    if (params.assigned_to_others) list = list.filter((r) => r.assigned_to && r.assigned_to !== ME);
    if (params.priority) list = list.filter((r) => r.priority === params.priority);
    if (params.priorities) list = list.filter((r) => params.priorities!.includes(r.priority));
    if (params.q) list = list.filter((r) => `${r.title} ${r.rooms?.room_number ?? ""}`.toLowerCase().includes(params.q!.toLowerCase()));
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
const lastReq = () => reqs().at(-1)!;
const asRole = (role: string) => {
  mockStore.user = { ...mockStore.user, role };
};

beforeEach(async () => {
  jest.clearAllMocks();
  seq = 0;
  mockParams = {};
  mockStore.isOnline = true;
  mockStore.user = { id: ME, tenant_id: "t1", role: "engineer", language_pref: "en" };
  mockStore.lastSyncedAt = null;
  mockSummary.mockResolvedValue({ urgent: 0, inProgress: 0, waiting: 0 });
  setQueueOwner("t1:u1");
  resetClaimConflictsForTests();
  await AsyncStorage.clear();
});

describe("primary navigation by role", () => {
  it("gives an engineer My Work and Available, with On hold and History as shortcuts, not tabs", async () => {
    server(() => []);
    renderScreen();
    await screen.findByTestId("wo-view-mine");
    expect(screen.getByTestId("wo-view-available")).toBeTruthy();
    expect(screen.queryByTestId("wo-view-team")).toBeNull();
    // The shortcuts exist, but outside the tab list.
    expect(screen.getByTestId("wo-view-waiting")).toBeTruthy();
    expect(screen.getByTestId("wo-view-done")).toBeTruthy();
    expect(screen.getByTestId("wo-views").props.accessibilityRole).toBe("tablist");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.mine");
    expect(screen.getByText("workQueue.eyebrow")).toBeTruthy();
    expect(screen.queryByTestId("wo-back")).toBeNull();
  });

  it("lands a chief engineer on Team with Available beside it, no My Work and no summary tiles", async () => {
    asRole("chief_engineer");
    server(() => [wo({ id: "t", title: "Their repair", status: "in_progress", assigned_to: "sam", assigned_to_name: "Sam Ortiz" }), wo({ id: "u", title: "Free job" })]);
    renderScreen();
    await screen.findByText("Their repair");
    expect(lastReq()).toMatchObject({ assigned_to_others: true });
    expect(screen.queryByTestId("wo-view-mine")).toBeNull();
    expect(screen.getByTestId("wo-view-team")).toBeTruthy();
    expect(screen.getByTestId("wo-view-available")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.team");
    expect(screen.queryByTestId("wo-summary")).toBeNull();
    expect(mockSummary).not.toHaveBeenCalled();
  });

  it("describes Available to a manager as work that needs an owner, and offers no Claim", async () => {
    asRole("chief_engineer");
    server(() => [wo({ id: "u", title: "Free job" })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-available"));
    await screen.findByText("Free job");
    expect(screen.getByTestId("wo-subtitle").props.children).toBe("workQueue.viewSubtitles.availableManager");
    expect(screen.queryByText("workQueue.action.claim")).toBeNull();
  });

  it("shows a GM all three tabs", async () => {
    asRole("gm");
    server(() => []);
    renderScreen();
    await screen.findByTestId("wo-view-mine");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByTestId("wo-view-team")).toBeTruthy();
  });

  it("blocks Team for an engineer even by deep link: no Team request, lands on My Work", async () => {
    mockParams = { view: "team" };
    server(() => []);
    renderScreen();
    await screen.findByTestId("wo-view-mine");
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(reqs().some((r) => r.assigned_to_others)).toBe(false);
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.mine");
  });

  it("sends a chief engineer's old My Work deep link to Team", async () => {
    asRole("chief_engineer");
    mockParams = { view: "mine" };
    server(() => []);
    renderScreen();
    await screen.findByTestId("wo-view-team");
    expect(reqs().every((r) => !r.mine)).toBe(true);
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.team");
  });
});

describe("On hold and History", () => {
  it("opens On hold from its shortcut, shows where you are, and Back returns to the default screen", async () => {
    server(() => [wo({ id: "h", title: "Pump", status: "on_hold", assigned_to: ME }), wo({ id: "m", title: "Mine", status: "in_progress", assigned_to: ME })]);
    renderScreen();
    await screen.findByText("Mine");
    fireEvent.press(screen.getByTestId("wo-view-waiting"));
    await screen.findByText("Pump");
    expect(lastReq()).toMatchObject({ statuses: ["on_hold"] });
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.waiting");
    expect(screen.getByTestId("wo-back")).toBeTruthy();
    expect(screen.queryByTestId("wo-views")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();

    fireEvent.press(screen.getByTestId("wo-back"));
    await screen.findByText("Mine");
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.mine");
    expect(screen.queryByTestId("wo-back")).toBeNull();
  });

  it("opens History as closed records, with a note that they are not actionable", async () => {
    server(() => [wo({ id: "c", title: "Fixed it", status: "completed", assigned_to: ME })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-done"));
    await screen.findByText("Fixed it");
    expect(lastReq()).toMatchObject({ statuses: ["completed"], sort_by: "updated_at" });
    expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.done");
    expect(screen.getByTestId("wo-history-note")).toBeTruthy();
    expect(screen.queryByText("workQueue.action.claim")).toBeNull();
  });

  it("keeps both reachable by deep link, for every Work role", async () => {
    server(() => [wo({ id: "h", title: "Pump", status: "on_hold", assigned_to: ME })]);
    mockParams = { view: "waiting" };
    const first = renderScreen();
    await screen.findByText("Pump");
    expect(screen.getByTestId("wo-back")).toBeTruthy();
    first.unmount();

    asRole("chief_engineer");
    mockParams = { view: "done" };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.done"));
    expect(lastReq()).toMatchObject({ statuses: ["completed"] });
  });

  it("Back from History goes to the chief engineer's own default, Team", async () => {
    asRole("chief_engineer");
    server(() => []);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-done"));
    fireEvent.press(await screen.findByTestId("wo-back"));
    await waitFor(() => expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.team"));
  });
});

describe("My Work summary", () => {
  it("shows the server's counts, not a count of the rows that happen to be loaded", async () => {
    // 30 of my orders, only 2 of them urgent in the first page of 25; the server knows the true figures.
    const rows = [
      ...Array.from({ length: 30 }, () => wo({ status: "in_progress", assigned_to: ME })),
    ];
    server(() => rows);
    mockSummary.mockResolvedValue({ urgent: 12, inProgress: 30, waiting: 4 });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("summary-urgent-count").props.children).toBe("12"));
    expect(screen.getByTestId("summary-inProgress-count").props.children).toBe("30");
    expect(screen.getByTestId("summary-waiting-count").props.children).toBe("4");
  });

  it("shows a dash, never zero, while counts are unknown or unavailable", async () => {
    server(() => []);
    mockSummary.mockRejectedValue(new Error("boom"));
    renderScreen();
    await screen.findByTestId("wo-summary-unavailable");
    for (const key of ["urgent", "inProgress", "waiting"]) {
      expect(screen.getByTestId(`summary-${key}-count`).props.children).toBe("workQueue.summary.unknown");
    }
  });

  it("section counts become a floor ('N+') while more pages remain", async () => {
    server(() => Array.from({ length: 30 }, () => wo({ status: "in_progress", assigned_to: ME })));
    renderScreen();
    await screen.findByText("25+");
    expect(screen.getByText("workQueue.groups.in_progress")).toBeTruthy();
  });

  it("Urgent applies emergency + urgent server-side, shows the selection, and clears with a second press or the chip", async () => {
    server(() => [wo({ id: "u", title: "Urgent job", priority: "urgent", status: "in_progress", assigned_to: ME }), wo({ id: "n", title: "Normal job", status: "in_progress", assigned_to: ME })]);
    mockSummary.mockResolvedValue({ urgent: 1, inProgress: 2, waiting: 0 });
    renderScreen();
    await screen.findByText("Normal job");

    fireEvent.press(screen.getByTestId("summary-urgent"));
    await waitFor(() => expect(screen.queryByText("Normal job")).toBeNull());
    expect(lastReq()).toMatchObject({ mine: true, priorities: ["emergency", "urgent"] });
    expect(screen.getByTestId("summary-urgent").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("wo-chip-urgent")).toBeTruthy();

    fireEvent.press(screen.getByTestId("summary-urgent"));
    await screen.findByText("Normal job");
    expect(screen.queryByTestId("wo-chip-urgent")).toBeNull();

    fireEvent.press(screen.getByTestId("summary-urgent"));
    await waitFor(() => expect(screen.queryByText("Normal job")).toBeNull());
    fireEvent.press(screen.getByTestId("wo-chip-urgent"));
    await screen.findByText("Normal job");
    expect(screen.getByTestId("summary-urgent").props.accessibilityState.selected).toBe(false);
  });

  it("In progress filters My Work to that status", async () => {
    server(() => [wo({ id: "p", title: "Doing it", status: "in_progress", assigned_to: ME }), wo({ id: "r", title: "Not yet", status: "open", assigned_to: ME })]);
    renderScreen();
    await screen.findByText("Not yet");
    fireEvent.press(screen.getByTestId("summary-inProgress"));
    await waitFor(() => expect(screen.queryByText("Not yet")).toBeNull());
    expect(lastReq()).toMatchObject({ mine: true, statuses: ["in_progress"] });
    expect(screen.getByTestId("wo-chip-status")).toBeTruthy();
    expect(screen.getByTestId("summary-inProgress").props.accessibilityState.selected).toBe(true);
  });

  it("Waiting opens On hold narrowed to my own held work, and Back keeps my other selections", async () => {
    server(() => [
      wo({ id: "h", title: "Mine held", status: "on_hold", assigned_to: ME }),
      wo({ id: "o", title: "Theirs held", status: "on_hold", assigned_to: "sam" }),
      wo({ id: "u", title: "Urgent job", priority: "urgent", status: "in_progress", assigned_to: ME }),
      wo({ id: "n", title: "Normal job", status: "in_progress", assigned_to: ME }),
    ]);
    renderScreen();
    await screen.findByText("Normal job");
    fireEvent.press(screen.getByTestId("summary-urgent"));
    await waitFor(() => expect(screen.queryByText("Normal job")).toBeNull());

    fireEvent.press(screen.getByTestId("summary-waiting"));
    await screen.findByText("Mine held");
    expect(screen.queryByText("Theirs held")).toBeNull();
    expect(lastReq()).toMatchObject({ statuses: ["on_hold"], mine: true });
    expect(screen.getByTestId("wo-chip-assignment")).toBeTruthy();
    expect(screen.queryByTestId("wo-summary")).toBeNull();

    fireEvent.press(screen.getByTestId("wo-back"));
    await screen.findByText("Urgent job");
    expect(screen.queryByText("Normal job")).toBeNull();
    expect(screen.getByTestId("wo-chip-urgent")).toBeTruthy();
  });

  it("appears only on My Work", async () => {
    server(() => []);
    renderScreen();
    await screen.findByTestId("wo-summary");
    fireEvent.press(screen.getByTestId("wo-view-available"));
    await waitFor(() => expect(screen.queryByTestId("wo-summary")).toBeNull());
  });

  it("recounts when the list is pulled to refresh", async () => {
    server(() => []);
    renderScreen();
    await waitFor(() => expect(mockSummary).toHaveBeenCalledTimes(1));
    mockSummary.mockResolvedValue({ urgent: 3, inProgress: 0, waiting: 0 });
    await act(async () => {
      await screen.getByTestId("wo-list").props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId("summary-urgent-count").props.children).toBe("3"));
  });
});

describe("search, filters and paging across views", () => {
  it("searches in every queue view with the same debounce, on the server", async () => {
    server(() => [wo({ id: "a", title: "Boiler" }), wo({ id: "b", title: "Elevator" })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-available"));
    await screen.findByText("Boiler");
    fireEvent.changeText(screen.getByTestId("wo-search"), "boil");
    await waitFor(() => expect(lastReq()).toMatchObject({ q: "boil", unassigned: true }));
    await waitFor(() => expect(screen.queryByText("Elevator")).toBeNull());
    expect(screen.getByText("Boiler")).toBeTruthy();
  });

  it("restarts paging from the first page when a filter changes", async () => {
    server(() => Array.from({ length: 60 }, (_, i) => wo({ id: `r${i}`, priority: i % 2 ? "urgent" : "normal", status: "in_progress", assigned_to: ME })));
    renderScreen();
    await screen.findByTestId("wo-load-more");
    fireEvent.press(screen.getByTestId("wo-load-more"));
    await waitFor(() => expect(mockList.mock.calls.some(([, page]) => page === 2)).toBe(true));

    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-priority-urgent"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => expect(lastReq()).toMatchObject({ priority: "urgent" }));
    const filtered = mockList.mock.calls.filter(([p]) => (p as WorkOrderListParams).priority === "urgent");
    expect(filtered[0][1]).toBe(1);
  });

  it("the filter sheet offers Urgent & emergency, and choosing a single priority replaces it", async () => {
    server(() => [wo({ id: "u", title: "Urgent job", priority: "urgent", status: "in_progress", assigned_to: ME })]);
    renderScreen();
    await screen.findByText("Urgent job");
    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-priority-urgentOnly"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => expect(lastReq()).toMatchObject({ priorities: ["emergency", "urgent"] }));

    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-priority-low"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => expect(lastReq()).toMatchObject({ priority: "low" }));
    expect(lastReq().priorities).toBeUndefined();
    expect(screen.queryByTestId("wo-chip-urgent")).toBeNull();
  });

  it("keeps each view's filters when moving between views, but never shares them", async () => {
    server(() => [wo({ id: "a", title: "Open one", priority: "urgent" }), wo({ id: "b", title: "Open low", priority: "low" })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-available"));
    await screen.findByText("Open low");
    fireEvent.press(screen.getByTestId("wo-filter-open"));
    fireEvent.press(screen.getByTestId("filter-priority-urgent"));
    fireEvent.press(screen.getByTestId("filter-apply"));
    await waitFor(() => expect(screen.queryByText("Open low")).toBeNull());

    fireEvent.press(screen.getByTestId("wo-view-mine"));
    await waitFor(() => expect(screen.queryByTestId("wo-chip-priority")).toBeNull());
    fireEvent.press(screen.getByTestId("wo-view-available"));
    await waitFor(() => expect(screen.getByTestId("wo-chip-priority")).toBeTruthy());
  });
});

describe("states", () => {
  it("says 'no matches' with a clear action, not 'all caught up', when Urgent finds nothing", async () => {
    server(() => [wo({ status: "in_progress", assigned_to: ME })]);
    renderScreen();
    await screen.findByTestId("summary-urgent");
    fireEvent.press(screen.getByTestId("summary-urgent"));
    await screen.findByText("workQueue.empty.noMatches");
    fireEvent.press(screen.getByTestId("wo-clear-narrowing"));
    await waitFor(() => expect(screen.queryByTestId("wo-chip-urgent")).toBeNull());
  });

  it("shows an error with Retry rather than an empty queue when the load fails", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    renderScreen();
    await screen.findByText("common.retry");
    expect(screen.queryByText("workQueue.empty.mine")).toBeNull();
  });

  it("opens Report an Issue from the header, on every view including History", async () => {
    server(() => []);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-new"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/work-orders/new");
    fireEvent.press(screen.getByTestId("wo-view-done"));
    fireEvent.press(await screen.findByTestId("wo-new"));
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it("opens a work order's detail from any view", async () => {
    server(() => [wo({ id: "h", title: "Pump", status: "on_hold", assigned_to: ME })]);
    renderScreen();
    fireEvent.press(await screen.findByTestId("wo-view-waiting"));
    fireEvent.press(await screen.findByTestId("wo-h"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/work-orders/h");
  });
});

describe("account and property switching", () => {
  it("starts clean for a different person: no filters, search, view, or counts carried over", async () => {
    server(() => [wo({ id: "u", title: "Urgent job", priority: "urgent", status: "in_progress", assigned_to: ME })]);
    mockSummary.mockImplementation(async () => (mockStore.user.id === "u1" ? { urgent: 9, inProgress: 8, waiting: 7 } : { urgent: 1, inProgress: 2, waiting: 3 }));
    const view = renderScreen();
    await waitFor(() => expect(screen.getByTestId("summary-urgent-count").props.children).toBe("9"));
    fireEvent.press(screen.getByTestId("summary-urgent"));
    fireEvent.changeText(screen.getByTestId("wo-search"), "pump");
    fireEvent.press(screen.getByTestId("wo-view-waiting"));
    await screen.findByTestId("wo-back");

    mockStore.user = { ...mockStore.user, id: "u2", tenant_id: "t2" };
    setQueueOwner("t2:u2");
    view.rerender(
      <ThemeProvider>
        <WorkOrdersScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("wo-title").props.children).toBe("workQueue.viewTitles.mine"));
    expect(screen.queryByTestId("wo-back")).toBeNull();
    expect(screen.getByTestId("wo-search").props.value).toBe("");
    expect(screen.queryByTestId("wo-chip-urgent")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("summary-urgent-count").props.children).toBe("1"));
    expect(screen.getByTestId("summary-inProgress-count").props.children).toBe("2");
    expect(reqs().at(-1)).toMatchObject({ mine: true });
    expect(reqs().at(-1)?.priorities).toBeUndefined();
    expect(reqs().at(-1)?.q).toBeUndefined();
  });
});

describe("scroll position", () => {
  it("returns each view to where it was left", async () => {
    server(() => Array.from({ length: 5 }, () => wo({ status: "in_progress", assigned_to: ME })));
    const scrollTo = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => undefined);
    renderScreen();
    await screen.findByTestId("wo-view-available");
    fireEvent.scroll(screen.getByTestId("wo-list"), { nativeEvent: { contentOffset: { y: 420 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 800 } } });
    fireEvent.press(screen.getByTestId("wo-view-available"));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ offset: 0, animated: false }));
    fireEvent.press(screen.getByTestId("wo-view-mine"));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ offset: 420, animated: false }));
    scrollTo.mockRestore();
  });
});
