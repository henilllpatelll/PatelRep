import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn((cb: () => void) => cb()),
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
  claimWorkOrder: jest.fn(),
}));
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: false, user: { id: "u1", role: mockRole, language_pref: "en" } }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));

import { listWorkOrders } from "@/lib/api/workOrders";
import { enqueueAction } from "@/lib/offline/db";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import WorkOrdersScreen from "@/app/(app)/work-orders/index";

function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <WorkOrdersScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

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
  mockRole = "engineer";
  mockList.mockImplementation(async (status: string) => (status === "open" ? [sampleWO] : []));
});

describe("WorkOrdersScreen", () => {
  it("renders WO card with title, room number, and urgent chip", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Fix AC/)).toBeTruthy());
    expect(screen.getByText(/101/)).toBeTruthy();
    expect(screen.getByText("workOrders.chipUrgent")).toBeTruthy();
  });

  it("groups open orders under the queue section with a Done toggle below", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("workOrders.sectionQueue")).toBeTruthy());
    expect(screen.getByTestId("wo-done-toggle")).toBeTruthy();
    // No bench or team work in this fixture — those sections stay hidden.
    expect(screen.queryByText("workOrders.sectionBench")).toBeNull();
    expect(screen.queryByText("workOrders.sectionTeam")).toBeNull();
  });

  it("shows Claim button on open unassigned WOs", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("workOrders.claim")).toBeTruthy());
  });

  it("enqueues work_order/claim when offline and Claim is tapped", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("workOrders.claim"));
    fireEvent.press(screen.getByText("workOrders.claim"));
    await waitFor(() =>
      expect(enqueueAction).toHaveBeenCalledWith("work_order", "claim", {}, "wo-1")
    );
  });

  it("does not offer Claim to a chief engineer, whom the API only lets read work orders", async () => {
    mockRole = "chief_engineer";
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Fix AC/)).toBeTruthy());
    expect(screen.queryByText("workOrders.claim")).toBeNull();
  });

  it("counts emergency orders on the urgent signal", async () => {
    mockList.mockImplementation(async (status: string) =>
      status === "open" ? [sampleWO, { ...sampleWO, id: "wo-2", title: "Flooded corridor", priority: "emergency" }] : [],
    );
    renderScreen();
    await waitFor(() => expect(screen.getByText("workOrders.signalUrgent:2")).toBeTruthy());
  });

  describe("when the queue fails to load", () => {
    const failure = () => Object.assign(new Error("boom"), { status: 500 });

    it("shows an error with Retry instead of an empty queue", async () => {
      mockList.mockRejectedValue(failure());
      renderScreen();
      await waitFor(() => expect(screen.getByText("engineeringState.loadFailed")).toBeTruthy());
      expect(screen.queryByText("workOrders.emptyOpen")).toBeNull();
      expect(screen.queryByText("workOrders.sectionQueue")).toBeNull();

      mockList.mockImplementation(async (status: string) => (status === "open" ? [sampleWO] : []));
      fireEvent.press(screen.getByText("common.retry"));
      await waitFor(() => expect(screen.getByText(/Fix AC/)).toBeTruthy());
      expect(screen.queryByText("engineeringState.loadFailed")).toBeNull();
    });

    it("treats one failed status as a failure, not a shorter queue", async () => {
      mockList.mockImplementation(async (status: string) => {
        if (status === "on_hold") throw failure();
        return status === "open" ? [sampleWO] : [];
      });
      renderScreen();
      await waitFor(() => expect(screen.getByText("engineeringState.loadFailed")).toBeTruthy());
      expect(screen.queryByText("workOrders.emptyOpen")).toBeNull();
    });

    it("says so when the role is not allowed, rather than showing nothing", async () => {
      mockList.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
      renderScreen();
      await waitFor(() => expect(screen.getByText("engineeringState.forbidden")).toBeTruthy());
    });

    it("keeps the genuinely empty queue as the empty state", async () => {
      mockList.mockResolvedValue([]);
      renderScreen();
      await waitFor(() => expect(screen.getByText("workOrders.emptyOpen")).toBeTruthy());
      expect(screen.queryByText("engineeringState.loadFailed")).toBeNull();
    });
  });
});
