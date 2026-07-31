import React from "react";
import { act, render, fireEvent, waitFor, screen } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

let mockSearchParams: { filter?: string } = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
  router: { push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn() },
}));
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
jest.mock("@/lib/theme/useToast", () => ({
  useToast: () => ({
    error: mockToastError,
    success: mockToastSuccess,
    info: jest.fn(),
  }),
}));
let mockStoreUser: { role: string; effective_role?: string } | null = null;
let mockIsOnline = true;
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: mockIsOnline, user: mockStoreUser }),
}));
jest.mock("@/lib/api/workOrders", () => ({
  createWorkOrder: jest.fn(),
}));

import { api } from "@/lib/api/client";
import { createWorkOrder } from "@/lib/api/workOrders";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomStatusScreen from "@/app/(app)/room-status/index";

const mockApiGet = api.get as jest.Mock;
const mockApiPatch = api.patch as jest.Mock;
const mockCreateWorkOrder = createWorkOrder as jest.Mock;

// Board rows carry room identity nested under rooms(...) — no flat room_number.
const rows = [
  { room_id: "r1", status: "DIRTY", fo_status: "VAC", vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null, rooms: { room_number: "101", floor: 1 } },
  { room_id: "r2", status: "OCCUPIED", fo_status: "OCC", vip_flag: false, dnd_flag: false, guest_name: "Guest A", checkout_time: null, rooms: { room_number: "102", floor: 1 } },
  { room_id: "r3", status: "CLEAN", fo_status: null, vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null, rooms: { room_number: "103", floor: 1 } },
  { room_id: "r4", status: "PICKUP", fo_status: null, vip_flag: false, dnd_flag: false, guest_name: "Guest B", checkout_time: null, rooms: { room_number: "204", floor: 2 } },
  { room_id: "r5", status: "OUT_OF_SERVICE", fo_status: "VAC", vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null, rooms: { room_number: "105", floor: 1 } },
];

function renderScreen() {
  return render(
    <ThemeProvider>
      <RoomStatusScreen />
    </ThemeProvider>,
  );
}

function alertButtons(callIndex: number): AlertButton[] {
  return (jest.mocked(Alert.alert).mock.calls[callIndex]?.[2] ?? []) as AlertButton[];
}

async function pressAlertButton(callIndex: number, text: string) {
  const button = alertButtons(callIndex).find((candidate) => candidate.text === text);
  expect(button).toBeDefined();
  await act(async () => {
    button?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = {};
  mockStoreUser = null;
  mockIsOnline = true;
  mockApiGet.mockResolvedValue({ data: rows });
  mockApiPatch.mockResolvedValue({ data: {} });
  mockCreateWorkOrder.mockResolvedValue({ id: "wo-1" });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RoomStatusScreen", () => {
  it("renders room numbers from the nested rooms join, grouped by floor", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
    expect(screen.getByText("102")).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.getByText("105")).toBeTruthy();
    expect(screen.getByText("204")).toBeTruthy();
    expect(screen.getAllByText("roomStatus.floorSection")).toHaveLength(2);
  });

  it("offers exactly All / Vacant / Occupied / OOO filters", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
    expect(screen.getByTestId("room-filter-all")).toBeTruthy();
    expect(screen.getByTestId("room-filter-VACANT")).toBeTruthy();
    expect(screen.getByTestId("room-filter-OCCUPIED")).toBeTruthy();
    expect(screen.getByTestId("room-filter-OOO")).toBeTruthy();
    expect(screen.queryByTestId("room-filter-DIRTY")).toBeNull();
    expect(screen.queryByTestId("room-filter-CLEAN")).toBeNull();
    expect(screen.queryByTestId("room-filter-INSPECTED")).toBeNull();
  });

  it("Vacant filter hides occupied rooms (FO OCC, OCCUPIED, and PICKUP)", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-filter-VACANT"));

    expect(screen.getByText("101")).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.getByText("105")).toBeTruthy();
    expect(screen.queryByText("102")).toBeNull();
    expect(screen.queryByText("204")).toBeNull();
    // Floor 2 had only an occupied room, so its section collapses too.
    expect(screen.getAllByText("roomStatus.floorSection")).toHaveLength(1);
  });

  it("OOO filter shows only out-of-order/out-of-service rooms", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-filter-OOO"));

    expect(screen.getByText("105")).toBeTruthy();
    expect(screen.queryByText("101")).toBeNull();
    expect(screen.queryByText("102")).toBeNull();
    expect(screen.queryByText("103")).toBeNull();
    expect(screen.queryByText("204")).toBeNull();
  });

  it("honors a valid initial OOO filter from route params", async () => {
    mockSearchParams = { filter: "OOO" };
    renderScreen();

    await waitFor(() => expect(screen.getByText("105")).toBeTruthy());
    expect(screen.queryByText("101")).toBeNull();
    expect(screen.queryByText("102")).toBeNull();
  });

  it("shows the shared empty state when the board request fails", async () => {
    mockApiGet.mockRejectedValueOnce(new Error("offline"));
    renderScreen();

    await waitFor(() => expect(screen.getByText("roomStatus.noRoomsMatch")).toBeTruthy());
    expect(screen.getByText("roomStatus.noRoomsMatchHint")).toBeTruthy();
  });

  it("renders translated room statuses through the shared status badge contract", async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByText("roomStatus.statusLabels.DIRTY")).toBeTruthy());
    expect(screen.getAllByText("roomStatus.statusLabels.OCCUPIED").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("roomStatus.statusLabels.CLEAN")).toBeTruthy();
    expect(screen.getByText("roomStatus.statusLabels.PICKUP")).toBeTruthy();
    expect(screen.getByText("roomStatus.statusLabels.OUT_OF_SERVICE")).toBeTruthy();
  });

  it("opens the room-scoped work-order modal from the room action sheet", async () => {
    mockStoreUser = { role: "engineer", effective_role: "engineer" };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("room-status-card-r1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-status-card-r1"));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    await pressAlertButton(0, "roomStatus.createWo");

    fireEvent.changeText(screen.getByPlaceholderText("workOrders.whatNeedsFixing"), "Replace lamp");
    fireEvent.press(screen.getByText("Create Work Order"));

    await waitFor(() =>
      expect(mockCreateWorkOrder).toHaveBeenCalledWith(
        expect.objectContaining({ room_id: "r1", title: "Replace lamp" }),
      ),
    );
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it("keeps the OOO reason sheet and reports no-reason failures with toast.error", async () => {
    mockStoreUser = { role: "engineer", effective_role: "engineer" };
    mockApiPatch.mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("room-status-card-r1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-status-card-r1"));
    await pressAlertButton(0, "roomStatus.placeOOO");
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    await pressAlertButton(1, "roomStatus.oooNoReason");

    await waitFor(() =>
      expect(mockApiPatch).toHaveBeenCalledWith("/rooms/r1/status", { status: "OOO", notes: undefined }),
    );
    expect(mockToastError).toHaveBeenCalledWith("roomStatus.oooError");
    expect(Alert.alert).toHaveBeenCalledTimes(2);
  });

  it("reloads the tenant-scoped board after a successful no-reason OOO update", async () => {
    mockStoreUser = { role: "engineer", effective_role: "engineer" };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("room-status-card-r1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-status-card-r1"));
    await pressAlertButton(0, "roomStatus.placeOOO");
    await pressAlertButton(1, "roomStatus.oooNoReason");

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    expect(mockApiPatch).toHaveBeenCalledWith("/rooms/r1/status", {
      status: "OOO",
      notes: undefined,
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("reports return-to-service failures with toast.error without adding another alert", async () => {
    mockStoreUser = { role: "engineer", effective_role: "engineer" };
    mockApiPatch.mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("room-status-card-r5")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-status-card-r5"));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    await pressAlertButton(0, "roomStatus.removeOoo");

    await waitFor(() =>
      expect(mockApiPatch).toHaveBeenCalledWith("/rooms/r5/status", { status: "DIRTY" }),
    );
    expect(mockToastError).toHaveBeenCalledWith("roomStatus.removeOooError");
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it("reports custom-reason OOO failures with toast.error after the reason sheet", async () => {
    mockStoreUser = { role: "engineer", effective_role: "engineer" };
    mockApiPatch.mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("room-status-card-r1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-status-card-r1"));
    await pressAlertButton(0, "roomStatus.placeOOO");
    await pressAlertButton(1, "roomStatus.oooAddReason");
    fireEvent.changeText(screen.getByPlaceholderText("roomStatus.oooReasonPlaceholder"), "Broken fan");
    fireEvent.press(screen.getByText("roomStatus.oooReasonModalConfirm"));

    await waitFor(() =>
      expect(mockApiPatch).toHaveBeenCalledWith("/rooms/r1/status", {
        status: "OOO",
        notes: "Broken fan",
      }),
    );
    expect(mockToastError).toHaveBeenCalledWith("roomStatus.oooError");
    expect(Alert.alert).toHaveBeenCalledTimes(2);
  });
});
