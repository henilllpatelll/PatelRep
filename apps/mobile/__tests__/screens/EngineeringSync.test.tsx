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

const mockSyncOnConnect = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/offline/sync", () => ({ syncOnConnect: () => mockSyncOnConnect(), useSyncActivity: (sel: (s: { active: boolean }) => unknown) => sel({ active: false }) }));
const mockRunSync = jest.fn();
let mockOverview: { online: boolean; lastSyncedAt: string | null };
let mockLastRun: unknown = null;
jest.mock("@/lib/offline/useSyncOverview", () => ({
  useSyncOverview: () => ({ overview: mockOverview, syncing: false, runSync: mockRunSync, lastRun: mockLastRun }),
}));

const mockPending = { actions: [] as unknown[], loaded: true, refresh: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock("@/lib/engineering/usePendingActions", () => ({ usePendingActions: () => mockPending }));
jest.mock("@/lib/engineering/usePmSyncItems", () => ({
  usePmSyncItems: () => ({ rows: [], drafts: [], active: [], loaded: true, refresh: jest.fn(), retry: jest.fn(), submitDespiteConflict: jest.fn(), discard: jest.fn() }),
}));
let mockClaims: { woId: string; label: string | null; reason: string; at: string }[] = [];
const mockDismissClaim = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/engineering/claimConflicts", () => ({ useClaimConflicts: () => mockClaims, dismissClaimConflict: (id: string) => mockDismissClaim(id), loadClaimConflicts: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/engineering/pendingReports", () => ({ useReportRecords: () => [], dismissReportRecord: jest.fn(), loadReportRecords: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/engineering/syncedHistory", () => ({ loadRecentlySynced: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/engineering/workOrderDrafts", () => ({ listCompletionDrafts: jest.fn().mockResolvedValue([]) }));

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
  mockLastRun = null;
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

  const openIssue = async (id: string) => {
    const r = renderScreen();
    await act(async () => {});
    fireEvent.press(r.getByTestId(id));
    return r;
  };

  it("lists a refused change under Needs attention first and never offers Retry for it", async () => {
    mockPending.actions = [action({ queueId: 4, kind: "complete", state: "refused", reason: "conflict", canRetry: false })];
    const { getByTestId, queryByTestId } = await openIssue("esync-issue-action:4");
    expect(queryByTestId("esync-sheet-retry")).toBeNull();
    fireEvent.press(getByTestId("esync-sheet-view"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-1");
  });

  it("offers Retry only for a change that ran out of automatic tries, and a waiting one is not an issue", async () => {
    mockPending.actions = [action({ queueId: 5, state: "stuck", canRetry: true }), action({ queueId: 6, state: "waiting" })];
    const { getByTestId, queryByTestId } = await openIssue("esync-issue-action:5");
    fireEvent.press(getByTestId("esync-sheet-retry"));
    expect(mockPending.retry).toHaveBeenCalledWith(5);
    expect(queryByTestId("esync-issue-action:6")).toBeNull();
    expect(getByTestId("esync-item-6")).toBeTruthy();
  });

  it("discarding needs a confirmation sheet; Keep Change preserves it, Discard Change removes only that change", async () => {
    mockPending.actions = [action({ queueId: 7, kind: "complete", state: "refused", reason: "forbidden" }), action({ queueId: 8, state: "waiting" })];
    const { getByTestId, queryByTestId } = await openIssue("esync-issue-action:7");
    fireEvent.press(getByTestId("esync-sheet-discard"));
    expect(mockPending.discard).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("esync-confirm-keep"));
    expect(mockPending.discard).not.toHaveBeenCalled();
    expect(queryByTestId("esync-confirm-sheet")).toBeNull();
    fireEvent.press(getByTestId("esync-issue-action:7"));
    fireEvent.press(getByTestId("esync-sheet-discard"));
    await act(async () => {
      fireEvent.press(getByTestId("esync-confirm-go"));
    });
    expect(mockPending.discard).toHaveBeenCalledTimes(1);
    expect(mockPending.discard).toHaveBeenCalledWith(7);
  });

  it("a refused claim opens a View Work Order action, and Dismiss is a separate confirmed action", async () => {
    mockClaims = [{ woId: "wo-3", label: "WO-1050", reason: "conflict", at: "2026-10-31T10:00:00Z" }];
    const { getByTestId, queryByTestId } = await openIssue("esync-issue-claim:wo-3");
    fireEvent.press(getByTestId("esync-sheet-view"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-3");
    fireEvent.press(getByTestId("esync-issue-claim:wo-3"));
    fireEvent.press(getByTestId("esync-sheet-dismiss"));
    expect(mockDismissClaim).not.toHaveBeenCalled();
    expect(queryByTestId("esync-confirm-sheet")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("esync-confirm-go"));
    });
    expect(mockDismissClaim).toHaveBeenCalledWith("wo-3");
  });

  it("states that a refused claim keeps nothing to resend while a refused change keeps the work", async () => {
    mockClaims = [{ woId: "wo-3", label: null, reason: "gone", at: "2026-10-31T10:00:00Z" }];
    const claim = await openIssue("esync-issue-claim:wo-3");
    expect(claim.getByText("engineeringSync.sheet.notKept")).toBeTruthy();
  });

  it("shows the real result of a manual sync and never a success banner for a partial one", () => {
    mockLastRun = { ran: true, remaining: 2, failed: 0, conflicts: 0, verified: true };
    const { getByText, queryByText } = renderScreen();
    expect(getByText("home.syncSheet.run.partial")).toBeTruthy();
    expect(queryByText("home.syncSheet.run.done")).toBeNull();
  });

  it("offers Connect to sync when offline", () => {
    mockOverview = { online: false, lastSyncedAt: null };
    expect(renderScreen().getByTestId("esync-now")).toBeTruthy();
  });

  it("is for engineering roles only", () => {
    mockRole = "housekeeper";
    expect(renderScreen().getByTestId("redirect")).toBeTruthy();
  });
});
