/* ─── Engineering Home request-count harness ────────────────────────────────
   A repeatable development check (not a timing test): it counts the API reads each Home screen issues for the
   situations Phase 5 cares about. It asserts on counts only, never on milliseconds, so it is stable in CI.
   Run it alone and read the table:  npx jest __tests__/perf/engineeringHomeRequests.test.tsx --runInBand  */
import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";

const mockFocusCallbacks: Array<() => void> = [];
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(() => {
      mockFocusCallbacks.push(cb);
    }, [cb]);
  },
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" }, t: (k: string) => k }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const mockRealtimeHandlers: Array<() => void> = [];
const mockChannels: string[] = [];
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn((name: string) => {
      mockChannels.push(name);
      const ch: { on: jest.Mock; subscribe: jest.Mock } = { on: jest.fn(), subscribe: jest.fn().mockReturnValue({}) };
      ch.on.mockImplementation((_t: string, _f: unknown, cb: () => void) => {
        mockRealtimeHandlers.push(cb);
        return ch;
      });
      return ch;
    }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/lib/api/workOrders", () => ({ listActiveWorkOrders: jest.fn(), getWorkOrderSummary: jest.fn() }));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
const mockSchedule = jest.fn();
jest.mock("@/lib/api/schedulingTeam", () => ({ fetchTeamSchedule: (...args: unknown[]) => mockSchedule(...args) }));
jest.mock("@/lib/api/engineeringTeam", () => ({
  fetchTeamOverview: jest.fn(),
  fetchTechnicians: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({ useSettingsIdentity: () => ({ hotelName: "Fossil Creek Inn" }) }));
jest.mock("@/lib/engineering/usePmSyncItems", () => ({
  usePmSyncItems: () => ({ rows: [], drafts: [], active: [], loaded: true, refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock("@/lib/engineering/usePendingActions", () => ({
  usePendingActions: () => ({ actions: [], loaded: true, refresh: jest.fn().mockResolvedValue(undefined), retry: jest.fn(), discard: jest.fn() }),
}));
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: true,
      hotelTimezone: "America/Chicago",
      unreadCount: 0,
      pendingActions: [],
      user: { id: "u1", role: mockRole, tenant_id: "h1", language_pref: "en" },
    })),
  };
});

import { getWorkOrderSummary, listActiveWorkOrders } from "@/lib/api/workOrders";
import { listPmSchedules } from "@/lib/api/assets";
import { fetchTeamOverview } from "@/lib/api/engineeringTeam";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import { emitWorkOrderMutated } from "@/lib/engineering/teamEvents";

const active = listActiveWorkOrders as jest.Mock;
const summary = getWorkOrderSummary as jest.Mock;
const pm = listPmSchedules as jest.Mock;
const overview = fetchTeamOverview as jest.Mock;

const OVERVIEW = {
  generated_at: new Date().toISOString(),
  counts: { open: 0, overdue: 0, on_hold: 0, emergency: 0, unassigned: 0, needs_owner: 0, in_progress: 0, pm_overdue: 0 },
  attention_counts: {},
  needs_attention: [],
  technicians: [],
  rooms_down: { total: 0, past_expected_return: 0 },
  pm_oversight: { overdue: [], overdue_total: 0, repeat_defects: [], repeat_window_days: 30 },
  truncated: false,
};

const table: Array<{ scenario: string; role: string; work: number; pm: number; summary: number; overview: number }> = [];
function snapshot(scenario: string, role: string) {
  table.push({ scenario, role, work: active.mock.calls.length, pm: pm.mock.calls.length, summary: summary.mock.calls.length, overview: overview.mock.calls.length });
}
function reset() {
  active.mockClear();
  pm.mockClear();
  summary.mockClear();
  overview.mockClear();
}

const mount = () =>
  render(
    <ThemeProvider>
      <EngineerHome name="Dev Patel" />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockFocusCallbacks.length = 0;
  mockRealtimeHandlers.length = 0;
  mockChannels.length = 0;
  resetAsyncResourceCache();
  active.mockReset().mockResolvedValue({ orders: [], truncated: false });
  pm.mockReset().mockResolvedValue([]);
  summary.mockReset().mockResolvedValue({ urgent: 0, in_progress: 0, waiting: 0, total: 0 });
  overview.mockReset().mockResolvedValue(OVERVIEW);
  mockSchedule.mockReset().mockRejectedValue(new Error("no schedule"));
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`ENGINEERING HOME REQUEST COUNTS\n${table.map((r) => `${r.role.padEnd(9)} ${r.scenario.padEnd(46)} work=${r.work} pm=${r.pm} summary=${r.summary} overview=${r.overview}`).join("\n")}`);
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const burst = async (n: number) => {
  await act(async () => {
    for (let i = 0; i < n; i += 1) mockRealtimeHandlers.forEach((h) => h());
    jest.advanceTimersByTime(3000);
  });
  await flush();
};
const focus = async (n: number) => {
  await act(async () => {
    for (let i = 0; i < n; i += 1) mockFocusCallbacks[mockFocusCallbacks.length - 1]?.();
  });
  await flush();
};

describe.each([
  ["engineer", "technician"],
  ["chief_engineer", "chief"],
])("%s Home request counts", (role) => {
  beforeEach(() => {
    mockRole = role;
  });

  it("opens with one read per source", async () => {
    const view = mount();
    await flush();
    await waitFor(() => expect(role === "engineer" ? active.mock.calls.length : overview.mock.calls.length).toBeGreaterThan(0));
    snapshot("initial open", role);
    if (role === "engineer") expect(active).toHaveBeenCalledTimes(1);
    else expect(overview).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("a burst of 10 realtime events costs one refresh", async () => {
    const view = mount();
    await flush();
    reset();
    await burst(10);
    snapshot("10 realtime events in one burst", role);
    expect(role === "engineer" ? active.mock.calls.length : overview.mock.calls.length).toBe(1);
    view.unmount();
  });

  it("three quick focus events cost at most one refresh", async () => {
    const view = mount();
    await flush();
    await focus(1); // the very first focus is the initial read
    reset();
    await focus(3);
    snapshot("3 focus events inside one second", role);
    expect(role === "engineer" ? active.mock.calls.length : overview.mock.calls.length).toBeLessThanOrEqual(1);
    view.unmount();
  });

  it("a focus event and a realtime event together cost one refresh", async () => {
    const view = mount();
    await flush();
    await focus(1);
    reset();
    await act(async () => {
      mockFocusCallbacks[mockFocusCallbacks.length - 1]?.();
      mockRealtimeHandlers.forEach((h) => h());
      jest.advanceTimersByTime(3000);
    });
    await flush();
    snapshot("focus + realtime together", role);
    expect(role === "engineer" ? active.mock.calls.length : overview.mock.calls.length).toBeLessThanOrEqual(1);
    view.unmount();
  });

  it("a confirmed local change and its realtime echo cost one refresh", async () => {
    const view = mount();
    await flush();
    reset();
    await act(async () => {
      emitWorkOrderMutated(); // e.g. a repair was completed on this phone
      jest.advanceTimersByTime(500);
      mockRealtimeHandlers.forEach((h) => h()); // the server's echo of the same change
      jest.advanceTimersByTime(3000);
    });
    await flush();
    snapshot("local mutation + realtime echo", role);
    expect(role === "engineer" ? active.mock.calls.length : overview.mock.calls.length).toBe(1);
    view.unmount();
  });

  it("opens exactly one realtime subscription for the hotel", async () => {
    const view = mount();
    await flush();
    expect(mockChannels).toHaveLength(1);
    view.unmount();
  });
});

describe("chief_engineer schedule read (workload lines)", () => {
  beforeEach(() => {
    mockRole = "chief_engineer";
  });

  it("is one extra read on open, and realtime bursts and focus events never repeat it", async () => {
    const view = mount();
    await flush();
    await waitFor(() => expect(overview.mock.calls.length).toBeGreaterThan(0));
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    await burst(10);
    await focus(3);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("is not read at all for a technician", async () => {
    mockRole = "engineer";
    const view = mount();
    await flush();
    expect(mockSchedule).not.toHaveBeenCalled();
    view.unmount();
  });
});
