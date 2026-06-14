import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn().mockResolvedValue({ data: [] }) },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    user: { id: "u1", role: "engineer", tenant_id: "h1", language_pref: "en" },
  }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));

import { router } from "expo-router";
import { listWorkOrders, claimWorkOrder } from "@/lib/api/workOrders";
import { getFailurePredictions } from "@/lib/api/assets";
import { api } from "@/lib/api/client";
import { EngineerHome } from "@/components/engineering/EngineerHome";

const mockList = listWorkOrders as jest.Mock;
const mockClaim = claimWorkOrder as jest.Mock;
const mockPredictions = getFailurePredictions as jest.Mock;
const mockApiGet = api.get as jest.Mock;

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
});

describe("EngineerHome", () => {
  it("shows my in-progress order as the bench focus card", async () => {
    mockList.mockImplementation(async (status: string) => {
      if (status === "in_progress") return [myActiveWO];
      if (status === "open") return [openWO];
      return [];
    });

    const { getByText, getByTestId } = render(<EngineerHome name="Dev Patel" />);
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(getByText("home.engineer.benchKicker")).toBeTruthy();
    expect(getByText("Replace fan-coil belt")).toBeTruthy();
    expect(getByText("home.engineer.openOrder")).toBeTruthy();
  });

  it("offers Claim & start on the top queue order when the bench is empty", async () => {
    mockList.mockImplementation(async (status: string) => (status === "open" ? [openWO] : []));

    const { getByText, getByTestId } = render(<EngineerHome name="Dev Patel" />);
    await waitFor(() => expect(getByTestId("engineer-focus")).toBeTruthy());
    expect(getByText("home.engineer.startKicker")).toBeTruthy();

    fireEvent.press(getByText("workOrders.claimStart"));
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("wo-open"));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-open")
    );
  });

  it("shows the bench-clear state when there is no live work", async () => {
    const { getByTestId } = render(<EngineerHome name="Dev Patel" />);
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

    const { getByText } = render(<EngineerHome name="Dev Patel" />);
    await waitFor(() => expect(getByText(/Swap the belt before Friday/)).toBeTruthy());
    expect(getByText(/Fan-coil 209/)).toBeTruthy();
  });

  it("gives every engineer quick links to Orders, Rooms, Assets, and PM", async () => {
    const { getByText, getByTestId } = render(<EngineerHome name="Dev Patel" />);
    await waitFor(() => expect(getByTestId("engineer-clear")).toBeTruthy());

    const links = [
      ["home.engineer.quickOrders", "/(app)/work-orders"],
      ["home.engineer.quickRooms", "/(app)/rooms"],
      ["home.engineer.quickAssets", "/(app)/assets"],
      ["home.engineer.quickPm", "/(app)/pm-schedules"],
    ] as const;

    for (const [label, href] of links) {
      fireEvent.press(getByText(label));
      expect(router.push).toHaveBeenLastCalledWith(href);
    }
    expect(mockApiGet).toHaveBeenCalledWith("/engineering/pm-schedules");
  });
});
