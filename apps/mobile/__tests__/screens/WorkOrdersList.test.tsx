import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";

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
  claimWorkOrder: jest.fn(),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: false, user: { id: "u1", language_pref: "en" } }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));

import { listWorkOrders } from "@/lib/api/workOrders";
import { enqueueAction } from "@/lib/offline/db";
import WorkOrdersScreen from "@/app/(app)/work-orders/index";

const mockList = listWorkOrders as jest.Mock;

const sampleWO = {
  id: "wo-1",
  title: "Fix AC",
  status: "open",
  priority: "urgent",
  rooms: { room_number: "101" },
  assigned_to: null,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockImplementation(async (status: string) => (status === "open" ? [sampleWO] : []));
});

describe("WorkOrdersScreen", () => {
  it("renders WO card with title, room number, and urgent chip", async () => {
    render(<WorkOrdersScreen />);
    await waitFor(() => expect(screen.getByText(/Fix AC/)).toBeTruthy());
    expect(screen.getByText(/101/)).toBeTruthy();
    expect(screen.getByText("workOrders.chipUrgent")).toBeTruthy();
  });

  it("shows Claim button on open unassigned WOs", async () => {
    render(<WorkOrdersScreen />);
    await waitFor(() => expect(screen.getByText("workOrders.claim")).toBeTruthy());
  });

  it("enqueues work_order/claim when offline and Claim is tapped", async () => {
    render(<WorkOrdersScreen />);
    await waitFor(() => screen.getByText("workOrders.claim"));
    fireEvent.press(screen.getByText("workOrders.claim"));
    await waitFor(() =>
      expect(enqueueAction).toHaveBeenCalledWith("work_order", "claim", {}, "wo-1")
    );
  });
});
