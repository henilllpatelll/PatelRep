import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/offline/db", () => ({ getPendingSyncQueue: jest.fn() }));

import { router } from "expo-router";
import { getPendingSyncQueue } from "@/lib/offline/db";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { REPORT_QUEUE_MARK, dismissReportRecord, loadReportRecords, recordReport } from "@/lib/engineering/pendingReports";
import { PendingReportsBanner } from "@/components/engineering/report/PendingReportsBanner";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const pending = getPendingSyncQueue as jest.Mock;
const renderBanner = () =>
  render(
    <ThemeProvider>
      <PendingReportsBanner />
    </ThemeProvider>,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setQueueOwner("h1:u1");
  for (const record of await loadReportRecords()) await dismissReportRecord(record.requestId);
  pending.mockResolvedValue([]);
});

describe("reports made without a connection", () => {
  it("renders nothing when there is nothing to say", async () => {
    const screen = renderBanner();
    await act(async () => undefined);
    expect(screen.queryByTestId("pending-reports")).toBeNull();
  });

  it("says a queued report is saved on this device and waiting, not accepted", async () => {
    pending.mockResolvedValue([{ entity_type: "work_order", action: "create", entity_id: `${REPORT_QUEUE_MARK}k1`, payload: JSON.stringify({ title: "AC not cooling" }) }]);
    const screen = renderBanner();
    const queued = await screen.findByTestId("pending-reports-queued");
    expect(queued).toHaveTextContent(/report\.pending\.waiting:count=1/);
    expect(queued).toHaveTextContent(/AC not cooling/);
    expect(screen.queryByTestId("pending-report-synced")).toBeNull();
  });

  it("shows the real work order number once the server accepted it, opens it, and can be dismissed", async () => {
    await recordReport({ requestId: "k1", kind: "synced", title: "AC not cooling", workOrderId: "wo-9", workOrderNumber: "1042" });
    const screen = renderBanner();
    const synced = await screen.findByTestId("pending-report-synced");
    expect(synced).toHaveTextContent(/report\.pending\.synced:number=WO-1042/);
    fireEvent.press(screen.getByTestId("pending-report-open"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "wo-9" } });
    fireEvent.press(screen.getByTestId("pending-report-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("pending-report-synced")).toBeNull());
  });

  it("tells the person a report was refused and why, instead of letting it vanish", async () => {
    await recordReport({ requestId: "k2", kind: "refused", title: "Door sticks", message: "Room not found" });
    const screen = renderBanner();
    const refused = await screen.findByTestId("pending-report-refused");
    expect(refused).toHaveTextContent(/report\.pending\.refused/);
    expect(refused).toHaveTextContent(/Door sticks/);
    expect(refused).toHaveTextContent(/Room not found/);
    expect(screen.queryByTestId("pending-report-open")).toBeNull();
  });
});
