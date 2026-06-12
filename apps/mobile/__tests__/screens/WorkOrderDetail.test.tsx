import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ woId: "wo-1" }),
  router: { back: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn(),
  MediaTypeOptions: { Images: "Images" },
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("@/lib/api/workOrders", () => ({
  getWorkOrder: jest.fn(),
  claimWorkOrder: jest.fn(),
  completeWorkOrder: jest.fn().mockResolvedValue(undefined),
  setWorkOrderStatus: jest.fn(),
  addWorkOrderComment: jest.fn(),
  uploadWorkOrderPhoto: jest.fn(),
  workOrderPhotoUrl: jest.fn().mockReturnValue(null),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    user: { id: "u1", role: "engineer", language_pref: "en" },
  }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));

import { getWorkOrder, completeWorkOrder } from "@/lib/api/workOrders";
import WorkOrderDetailScreen from "@/app/(app)/work-orders/[woId]";

const mockGet = getWorkOrder as jest.Mock;
const mockComplete = completeWorkOrder as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({
    id: "wo-1",
    title: "Fix AC",
    status: "in_progress",
    priority: "urgent",
    category: "hvac",
    assigned_to: "u1",
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    work_order_photos: [],
    work_order_comments: [],
  });
  mockComplete.mockResolvedValue(undefined);
});

describe("WorkOrderDetailScreen", () => {
  it("renders wrap-up notes input when assigned engineer views an in-progress WO", async () => {
    const { getByTestId } = render(<WorkOrderDetailScreen />);
    await waitFor(() => expect(getByTestId("completion-notes")).toBeTruthy());
    expect(getByTestId("parts-used")).toBeTruthy();
  });

  it("completes with notes and parts_used via the typed API", async () => {
    const { getByTestId, getByText } = render(<WorkOrderDetailScreen />);

    await waitFor(() => expect(getByTestId("completion-notes")).toBeTruthy());

    fireEvent.changeText(getByTestId("completion-notes"), "Fixed it");
    fireEvent.changeText(getByTestId("parts-used"), "Belt A-4L360");
    fireEvent.press(getByText("workOrders.complete"));

    await waitFor(() =>
      expect(mockComplete).toHaveBeenCalledWith("wo-1", {
        notes: "Fixed it",
        parts_used: "Belt A-4L360",
      })
    );
  });

  it("shows Claim & start for open unassigned WOs and not the wrap-up form", async () => {
    mockGet.mockResolvedValue({
      id: "wo-1",
      title: "Fix AC",
      status: "open",
      priority: "normal",
      assigned_to: null,
      work_order_photos: [],
      work_order_comments: [],
    });
    const { getByText, queryByTestId } = render(<WorkOrderDetailScreen />);
    await waitFor(() => expect(getByText("workOrders.claimStart")).toBeTruthy());
    expect(queryByTestId("completion-notes")).toBeNull();
  });
});
