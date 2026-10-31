import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ woId: "wo-1" }),
  router: { back: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => {
      if (k === "workOrders.roomOccupancy.occupied") return "Occupied";
      if (k === "workOrders.roomOccupancy.vacant") return "Vacant";
      return k;
    },
  }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
  transitionWorkOrder: jest.fn().mockResolvedValue(undefined),
  addWorkOrderComment: jest.fn(),
  uploadWorkOrderPhoto: jest.fn(),
  workOrderPhotoUrl: jest.fn().mockReturnValue(null),
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoard: jest.fn(),
}));
let mockUser = { id: "u1", role: "engineer", language_pref: "en" };
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    user: mockUser,
  }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { getWorkOrder, completeWorkOrder, transitionWorkOrder } from "@/lib/api/workOrders";
import { fetchBoard } from "@/lib/api/housekeepingSupervisor";
import WorkOrderDetailScreen from "@/app/(app)/work-orders/[woId]";

const mockGet = getWorkOrder as jest.Mock;
const mockComplete = completeWorkOrder as jest.Mock;
const mockTransition = transitionWorkOrder as jest.Mock;
const mockFetchBoard = fetchBoard as jest.Mock;

// WorkOrderDetailScreen consumes useTheme()/useToast(), both of which throw outside their
// providers — wrap every render the same way _layout.tsx nests them at runtime.
function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <WorkOrderDetailScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "u1", role: "engineer", language_pref: "en" };
  mockGet.mockResolvedValue({
    id: "wo-1",
    title: "Fix AC",
    status: "in_progress",
    priority: "urgent",
    category: "hvac",
    room_id: "room-101",
    rooms: { room_number: "101", floor: 1 },
    assigned_to: "u1",
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    work_order_photos: [],
    work_order_comments: [],
  });
  mockFetchBoard.mockResolvedValue([
    {
      room_id: "room-101",
      status: "DIRTY",
      fo_status: "OCC",
      rooms: { room_number: "101", floor: 1, room_types: { name: "King" } },
    },
  ]);
  mockComplete.mockResolvedValue(undefined);
});

describe("WorkOrderDetailScreen", () => {
  it("renders wrap-up notes input when assigned engineer views an in-progress WO", async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("completion-notes")).toBeTruthy());
    expect(getByTestId("parts-used")).toBeTruthy();
  });

  it("completes with notes and parts_used via the typed API", async () => {
    const { getByTestId, getByText } = renderScreen();

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
    const { getByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByText("workOrders.claimStart")).toBeTruthy());
    expect(queryByTestId("completion-notes")).toBeNull();
  });

  it("shows room occupancy for a room-linked work order", async () => {
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("Occupied")).toBeTruthy());
  });

  it("gives a chief engineer a read-only view of an in-progress work order", async () => {
    mockUser = { id: "chief-1", role: "chief_engineer", language_pref: "en" };
    mockGet.mockResolvedValue({
      id: "wo-1",
      title: "Fix AC",
      status: "in_progress",
      priority: "normal",
      assigned_to: "other-engineer",
      work_order_photos: [],
      work_order_comments: [],
    });

    const { getByTestId, queryByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-view-only")).toBeTruthy());
    expect(queryByText("workOrders.claimedElsewhere")).toBeNull();
    expect(queryByTestId("completion-notes")).toBeNull();
    expect(queryByText("workOrders.complete")).toBeNull();
  });

  it("does not offer a chief engineer the Claim action on an open work order", async () => {
    mockUser = { id: "chief-1", role: "chief_engineer", language_pref: "en" };
    mockGet.mockResolvedValue({
      id: "wo-1",
      title: "Fix AC",
      status: "open",
      priority: "normal",
      assigned_to: null,
      work_order_photos: [],
      work_order_comments: [],
    });
    const { getByTestId, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-view-only")).toBeTruthy());
    expect(queryByText("workOrders.claimStart")).toBeNull();
  });

  it("keeps another engineer's claimed order read-only for an engineer", async () => {
    mockGet.mockResolvedValue({
      id: "wo-1",
      title: "Fix AC",
      status: "in_progress",
      priority: "normal",
      assigned_to: "someone-else",
      work_order_photos: [],
      work_order_comments: [],
    });
    const { getByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByText("workOrders.claimedElsewhere")).toBeTruthy());
    expect(queryByTestId("completion-notes")).toBeNull();
  });

  it("shows the emergency badge for an emergency order", async () => {
    mockGet.mockResolvedValue({
      id: "wo-1",
      title: "Burst pipe",
      status: "in_progress",
      priority: "emergency",
      assigned_to: "u1",
      work_order_photos: [],
      work_order_comments: [],
    });
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByText("workOrders.chipEmergency")).toBeTruthy());
    expect(queryByText("workOrders.chipUrgent")).toBeNull();
  });

  describe("hold and resume use the transition endpoint", () => {
    it("asks for a reason before putting a work order on hold", async () => {
      const { getByLabelText, getByTestId } = renderScreen();
      await waitFor(() => expect(getByLabelText("workOrders.hold")).toBeTruthy());
      fireEvent.press(getByLabelText("workOrders.hold"));
      await waitFor(() => expect(getByTestId("hold-reason-sheet")).toBeTruthy());
      // Nothing is sent until a reason is chosen — a reason is never guessed.
      expect(mockTransition).not.toHaveBeenCalled();

      fireEvent.press(getByTestId("hold-reason-awaiting_parts"));
      await waitFor(() =>
        expect(mockTransition).toHaveBeenCalledWith("wo-1", { status: "on_hold", reason_code: "awaiting_parts" }),
      );
    });

    it("resumes a held order with no reason", async () => {
      mockGet.mockResolvedValue({
        id: "wo-1",
        title: "Fix AC",
        status: "on_hold",
        priority: "normal",
        assigned_to: "u1",
        work_order_photos: [],
        work_order_comments: [],
      });
      const { getByText } = renderScreen();
      await waitFor(() => expect(getByText("workOrders.resume")).toBeTruthy());
      fireEvent.press(getByText("workOrders.resume"));
      await waitFor(() => expect(mockTransition).toHaveBeenCalledWith("wo-1", { status: "in_progress", reason_code: undefined }));
    });
  });
});
