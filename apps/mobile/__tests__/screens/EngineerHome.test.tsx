import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o && typeof o.count === "number" ? `${k}:${o.count}` : k),
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
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
  listWorkOrders: jest.fn(),
  claimWorkOrder: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/api/assets", () => ({
  listAssets: jest.fn(),
  getFailurePredictions: jest.fn().mockResolvedValue({ data: [] }),
  acknowledgePrediction: jest.fn(),
  createWorkOrderFromPrediction: jest.fn(),
  listPmSchedules: jest.fn(),
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn().mockResolvedValue({ data: [] }) },
}));
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: true,
      hotelTimezone: "America/Chicago",
      user: { id: "u1", role: mockRole, tenant_id: "h1", language_pref: "en" },
    })),
  };
});
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));

import { router } from "expo-router";
import { listWorkOrders, claimWorkOrder } from "@/lib/api/workOrders";
import { getFailurePredictions, listPmSchedules } from "@/lib/api/assets";
import { api } from "@/lib/api/client";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockList = listWorkOrders as jest.Mock;
const mockClaim = claimWorkOrder as jest.Mock;
const mockPredictions = getFailurePredictions as jest.Mock;
const mockApiGet = api.get as jest.Mock;
const mockPmList = listPmSchedules as jest.Mock;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

function renderEngineerHome() {
  return render(
    <ThemeProvider>
      <EngineerHome name="Dev Patel" />
    </ThemeProvider>
  );
}

const openWO = {
  id: "wo-open",
  title: "Reseat toilet flange",
  status: "open",
  priority: "normal",
  rooms: { room_number: "144" },
  assigned_to: null,
  created_at: new Date().toISOString(),
};

const myActiveWO = {
  id: "wo-mine",
  title: "Replace fan-coil belt",
  status: "in_progress",
  priority: "urgent",
  rooms: { room_number: "209" },
  assigned_to: "u1",
  created_at: new Date().toISOString(),
  started_at: new Date(Date.now() - 22 * 60_000).toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockPredictions.mockResolvedValue({ data: [] });
  mockApiGet.mockResolvedValue({ data: [] });
  mockPmList.mockResolvedValue([]);
  mockRole = "engineer";
});

describe("EngineerHome", () => {
  it("shows my in-progress order as the bench focus card", async () => {
    mockList.mockImplementation(async (status: string) => {
      if (status === "in_progress") return [myActiveWO];
      if (status === "open") return [openWO];
      return [];
    });

    const { getByText, getByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(getByText("home.engineer.benchKicker")).toBeTruthy();
    expect(getByText("Replace fan-coil belt")).toBeTruthy();
    expect(getByText("home.engineer.openOrder")).toBeTruthy();
  });

  it("offers Claim & start on the top queue order when the bench is empty", async () => {
    mockList.mockImplementation(async (status: string) => (status === "open" ? [openWO] : []));

    const { getByText, getByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(getByText("home.engineer.startKicker")).toBeTruthy();

    fireEvent.press(getByText("workOrders.claimStart"));
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("wo-open"));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-open")
    );
  });

  it("shows the bench-clear state when there is no live work", async () => {
    const { getByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-clear")).toBeTruthy());
  });

  it("renders a real failure prediction when one is unacknowledged", async () => {
    mockPredictions.mockResolvedValue({
      data: [
        {
          id: "p1",
          asset_id: "a1",
          risk_score: 82,
          recommendation: "Swap the belt before Friday.",
          is_acknowledged: false,
          assets: { name: "Fan-coil 209" },
          generated_at: new Date().toISOString(),
        },
      ],
    });

    const { getByText } = renderEngineerHome();
    await waitFor(() => expect(getByText(/Swap the belt before Friday/)).toBeTruthy());
    expect(getByText(/Fan-coil 209/)).toBeTruthy();
  });

  it("gives every engineer quick links to Orders, Rooms, Assets, and PM", async () => {
    const { getByText, getByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-clear")).toBeTruthy());

    const links = [
      ["home.engineer.quickOrders", "/(app)/work-orders"],
      ["home.engineer.quickRooms", "/(app)/room-status"],
      ["home.engineer.quickAssets", "/(app)/assets"],
      ["home.engineer.quickPm", "/(app)/pm-schedules"],
    ] as const;

    for (const [label, href] of links) {
      fireEvent.press(getByText(label));
      expect(router.push).toHaveBeenLastCalledWith(href);
    }
    expect(mockPmList).toHaveBeenCalled();
  });

  it("shows an error with Retry, not Bench is clear, when the work queue fails to load", async () => {
    const failure = Object.assign(new Error("boom"), { status: 500 });
    mockList.mockRejectedValue(failure);

    const { getByTestId, queryByTestId, getByText } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(queryByTestId("engineer-clear")).toBeNull();
    expect(getByText("engineeringState.loadFailed")).toBeTruthy();

    mockList.mockImplementation(async (status: string) => (status === "open" ? [openWO] : []));
    fireEvent.press(getByText("common.retry"));
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(queryByTestId("engineer-load-error")).toBeNull();
  });

  it("a partly failed load is a failure too, never a quietly shorter queue", async () => {
    mockList.mockImplementation(async (status: string) => {
      if (status === "in_progress") throw Object.assign(new Error("boom"), { status: 500 });
      return status === "open" ? [openWO] : [];
    });
    const { getByTestId, queryByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-load-error")).toBeTruthy());
    expect(queryByTestId("engineer-clear")).toBeNull();
  });

  it("explains a forbidden load instead of showing an empty bench", async () => {
    mockList.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    const { getByText, queryByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByText("engineeringState.forbidden")).toBeTruthy());
    expect(queryByTestId("engineer-clear")).toBeNull();
  });

  it("builds the PM strip from the real schedule rows (next_due_at, no status field)", async () => {
    mockPmList.mockResolvedValue([
      { id: "pm1", asset_id: "a1", name: "Filters", interval_type: "monthly", next_due_at: day(-3), is_active: true },
      { id: "pm2", asset_id: "a2", name: "Belts", interval_type: "weekly", next_due_at: day(30), is_active: true },
    ]);
    const { getByTestId, getByText } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-pm-strip")).toBeTruthy());
    expect(getByText("home.engineer.pmAttention")).toBeTruthy();
  });

  it("hides the PM strip when nothing is overdue or due today", async () => {
    mockPmList.mockResolvedValue([
      { id: "pm2", asset_id: "a2", name: "Belts", interval_type: "weekly", next_due_at: day(30), is_active: true },
    ]);
    const { getByTestId, queryByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-clear")).toBeTruthy());
    expect(queryByTestId("engineer-pm-strip")).toBeNull();
  });

  it("counts an emergency order on the urgent chip alongside urgent ones", async () => {
    mockList.mockImplementation(async (status: string) => {
      if (status === "open") return [{ ...openWO, priority: "emergency" }];
      if (status === "in_progress") return [myActiveWO];
      return [];
    });
    const { getByText } = renderEngineerHome();
    await waitFor(() => expect(getByText("workOrders.signalUrgent:2")).toBeTruthy());
  });

  it("does not offer a chief engineer the Claim action, only a way to open the order", async () => {
    mockRole = "chief_engineer";
    mockList.mockImplementation(async (status: string) => (status === "open" ? [openWO] : []));
    const { getByText, queryByText, getByTestId } = renderEngineerHome();
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(queryByText("workOrders.claimStart")).toBeNull();
    expect(getByText("home.engineer.openOrder")).toBeTruthy();
    expect(mockClaim).not.toHaveBeenCalled();
  });
});
