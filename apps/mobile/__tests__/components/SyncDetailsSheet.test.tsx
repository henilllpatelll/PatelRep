import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockSyncOnConnect = jest.fn();
const mockLoadSyncRows = jest.fn();
const appState: { myRooms: Array<{ id: string; room_number: string }>; lastSyncedAt: string | null; pendingActions: unknown[] } = {
  myRooms: [{ id: "room-218", room_number: "218" }, { id: "room-224", room_number: "224" }],
  lastSyncedAt: null,
  pendingActions: [],
};

jest.mock("@/lib/offline/sync", () => ({ syncOnConnect: () => mockSyncOnConnect() }));
jest.mock("@/lib/housekeeping/syncDetails", () => ({ loadSyncRows: () => mockLoadSyncRows() }));
const loaded = (rows: unknown[], complete = true) => ({ rows, complete });
jest.mock("@/stores/appStore", () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector(appState) }));
// Stable references, like the real stores: a new object every render would re-run the sheet's effect.
const mockSessionsState = { sessions: {} };
jest.mock("@/stores/cleanSessionStore", () => ({ useCleanSessionStore: (selector: (state: unknown) => unknown) => selector(mockSessionsState) }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key) }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { SyncDetailsSheet } from "@/components/housekeeping/roomDetail/SyncDetailsSheet";

function renderSheet(isOnline = true) {
  return render(
    <ThemeProvider>
      <SyncDetailsSheet visible isOnline={isOnline} ctx={{ language: "en", timeZone: "America/Chicago" }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  appState.lastSyncedAt = null;
  mockSyncOnConnect.mockResolvedValue(undefined);
});

describe("SyncDetailsSheet", () => {
  it("lists only what is actually queued, with the room and a worded state", async () => {
    mockLoadSyncRows.mockResolvedValue(
      loaded([
        { key: "a", roomId: "room-218", kind: "checklist", state: "pending", count: 2 },
        { key: "b", roomId: "room-218", kind: "completion", state: "retrying" },
        { key: "c", roomId: "room-224", kind: "work_order", state: "failed" },
      ]),
    );
    const { findAllByTestId, getByTestId } = renderSheet();
    const rows = await findAllByTestId("sync-row");

    expect(rows).toHaveLength(3);
    expect(rows[0].props.accessibilityLabel).toContain("rooms.work.sync.states.pending");
    expect(rows[1].props.accessibilityLabel).toContain("rooms.work.sync.states.retrying");
    expect(rows[2].props.accessibilityLabel).toContain("rooms.work.sync.states.failed");
    expect(rows[2].props.accessibilityLabel).toContain('"room":"224"');
    expect(getByTestId("sync-count").props.children).toContain('"count":4');
    expect(getByTestId("sync-failed-help")).toBeTruthy();
  });

  it("says everything is saved when nothing is queued, and does not offer a pointless retry", async () => {
    mockLoadSyncRows.mockResolvedValue(loaded([]));
    const { findByTestId, getByTestId } = renderSheet();
    await findByTestId("sync-empty");
    expect(getByTestId("sync-retry").props.accessibilityState.disabled).toBe(true);
  });

  it("offline: titled as working offline, retry disabled", async () => {
    mockLoadSyncRows.mockResolvedValue(loaded([{ key: "a", roomId: "room-218", kind: "checklist", state: "pending", count: 1 }]));
    const { findAllByTestId, getByText, getByTestId } = renderSheet(false);
    await findAllByTestId("sync-row");
    expect(getByText("rooms.work.sync.titleOffline")).toBeTruthy();
    expect(getByTestId("sync-retry").props.accessibilityState.disabled).toBe(true);
  });

  it("Retry runs the app's single in-order flush, once, then re-reads the queues", async () => {
    mockLoadSyncRows
      .mockResolvedValueOnce(loaded([{ key: "a", roomId: "room-218", kind: "checklist", state: "pending", count: 1 }]))
      .mockResolvedValue(loaded([]));
    const { findAllByTestId, getByTestId, findByTestId } = renderSheet();
    await findAllByTestId("sync-row");
    fireEvent.press(getByTestId("sync-retry"));
    fireEvent.press(getByTestId("sync-retry"));

    await waitFor(() => expect(mockSyncOnConnect).toHaveBeenCalledTimes(1));
    await findByTestId("sync-empty");
  });

  it("never says everything is saved when the work-order queue could not be read", async () => {
    mockLoadSyncRows.mockResolvedValue(loaded([], false));
    const { findByTestId, queryByTestId } = renderSheet();
    await findByTestId("sync-unreadable");
    expect(queryByTestId("sync-empty")).toBeNull();
  });

  it("shows the last successful sync time in hotel time, or that there has not been one", async () => {
    mockLoadSyncRows.mockResolvedValue(loaded([]));
    const first = renderSheet();
    await first.findByTestId("sync-empty");
    expect(first.getByTestId("sync-last").props.children).toBe("rooms.work.sync.neverSynced");
    first.unmount();

    appState.lastSyncedAt = "2026-10-08T17:24:00.000Z";
    const second = renderSheet();
    await second.findByTestId("sync-empty");
    expect(second.getByTestId("sync-last").props.children).toContain("rooms.work.sync.lastSync");
    expect(second.getByTestId("sync-last").props.children).toContain("12:24");
  });
});
