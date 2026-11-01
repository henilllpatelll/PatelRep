import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native");
    return <Text testID="redirect">{href}</Text>;
  },
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => k + (o?.defaultValue ? "" : "") }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/housekeeping/useTextContext", () => ({ useTextContext: () => ({}) }));
jest.mock("@/lib/housekeeping/myRoomsText", () => ({ formatClock: (v: string | null) => (v ? "10:42 AM" : null) }));

let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: true, user: { id: "u1", tenant_id: "h1", role: mockRole } })) };
});

const mockRunSync = jest.fn();
let mockOverview: { online: boolean; lastSyncedAt: string | null };
jest.mock("@/lib/offline/useSyncOverview", () => ({
  useSyncOverview: () => ({ overview: mockOverview, syncing: false, runSync: mockRunSync }),
}));

const mockPending = { actions: [] as unknown[], loaded: true, refresh: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock("@/lib/engineering/usePendingActions", () => ({ usePendingActions: () => mockPending }));
let mockClaims: { woId: string; label: string | null; reason: string; at: string }[] = [];
jest.mock("@/lib/engineering/claimConflicts", () => ({ useClaimConflicts: () => mockClaims, dismissClaimConflict: jest.fn() }));
jest.mock("@/lib/engineering/pendingReports", () => ({ useReportRecords: () => [], dismissReportRecord: jest.fn() }));

import { router } from "expo-router";
import EngineeringSyncScreen from "@/app/(app)/engineering-sync/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const action = (over: Record<string, unknown>) => ({
  key: "queue-1", queueId: 1, kind: "claim", state: "waiting", woId: "wo-1", label: "WO-1042", savedAt: null, reason: null, canRetry: false, canDiscard: true, ...over,
});
const renderScreen = () =>
  render(
    <ThemeProvider>
      <EngineeringSyncScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "engineer";
  mockOverview = { online: true, lastSyncedAt: "2026-10-31T15:42:00Z" };
  mockPending.actions = [];
  mockPending.loaded = true;
  mockClaims = [];
});

describe("Engineering sync status", () => {
  it("shows the confirmed time from the real record and nothing waiting when the queue is empty", () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId("esync-last").props.children).toBe("engineeringSync.lastConfirmed");
    expect(getByTestId("esync-empty")).toBeTruthy();
  });

  it("says it could not read the queue instead of claiming nothing is waiting", () => {
    mockPending.loaded = false;
    const { getByTestId } = renderScreen();
    expect(getByTestId("esync-empty").props.children).toBe("engineeringSync.unreadable");
  });

  it("offers no confirmed time before the first confirmed sync", () => {
    mockOverview = { online: true, lastSyncedAt: null };
    expect(renderScreen().getByTestId("esync-last").props.children).toBe("engineeringSync.lastUnknown");
  });

  it("never offers Retry for a change the server refused, and opens the order instead", () => {
    mockPending.actions = [action({ queueId: 4, kind: "complete", state: "refused", reason: "conflict", canRetry: false })];
    const { getByTestId, queryByTestId } = renderScreen();
    expect(queryByTestId("esync-retry-4")).toBeNull();
    fireEvent.press(getByTestId("esync-view-4"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-1");
  });

  it("offers Retry only for a change that ran out of automatic tries", () => {
    mockPending.actions = [action({ queueId: 5, state: "stuck", canRetry: true }), action({ queueId: 6, state: "waiting" })];
    const { getByTestId, queryByTestId } = renderScreen();
    fireEvent.press(getByTestId("esync-retry-5"));
    expect(mockPending.retry).toHaveBeenCalledWith(5);
    expect(queryByTestId("esync-retry-6")).toBeNull();
  });

  it("discarding needs a second, deliberate tap and removes only that unsent change", async () => {
    mockPending.actions = [action({ queueId: 7, kind: "complete", state: "refused", reason: "forbidden" })];
    const { getByTestId, queryByTestId } = renderScreen();
    fireEvent.press(getByTestId("esync-discard-7"));
    expect(mockPending.discard).not.toHaveBeenCalled();
    expect(queryByTestId("esync-discard-confirm-7")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("esync-discard-confirm-7"));
    });
    expect(mockPending.discard).toHaveBeenCalledTimes(1);
    expect(mockPending.discard).toHaveBeenCalledWith(7);
  });

  it("lists a refused offline claim with a way to see the order", () => {
    mockClaims = [{ woId: "wo-3", label: "WO-1050", reason: "conflict", at: "2026-10-31T10:00:00Z" }];
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId("esync-claim-wo-3"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-3");
  });

  it("is for engineering roles only", () => {
    mockRole = "housekeeper";
    expect(renderScreen().getByTestId("redirect")).toBeTruthy();
  });
});
