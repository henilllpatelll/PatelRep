import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import type { Room } from "@/stores/appStore";
import { C } from "@/components/shared/tokens";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";

const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();
const mockT = (key: string) => key;

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "101",
    floor: 1,
    status: "CLEAN",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: null,
    clean_type: null,
    clean_type_label: null,
    updated_at: "2026-05-25T15:00:00.000Z",
    room_type_code: "KS",
    room_type_name: "King Suite",
    rooms: { room_types: { name: "King Suite", code: "KS" } },
    ...overrides,
  };
}

let mockRooms: Room[] = [makeRoom()];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ roomId: "room-1" }),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: `icon-${name}` }, name);
  },
}));
jest.mock("@/components/housekeeping/ReportIssueModal", () => () => null);
jest.mock("@/components/housekeeping/FoundItemModal", () => () => null);
jest.mock("@/components/housekeeping/SupplyRequestModal", () => () => null);
jest.mock("@/components/housekeeping/KnockModal", () => () => null);
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));
let mockChecklistProgress: Record<string, Record<string, boolean>> = {};

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
    enqueueAction: mockEnqueueAction,
    user: { id: "user-1" },
    refreshRooms: jest.fn(),
    incrementDndAttempt: jest.fn().mockReturnValue(1),
    resetDndAttempt: jest.fn(),
    roomChecklistProgress: mockChecklistProgress,
    setRoomChecklistItem: (roomId: string, key: string, checked: boolean) => {
      mockChecklistProgress = { ...mockChecklistProgress, [roomId]: { ...mockChecklistProgress[roomId], [key]: checked } };
    },
    resetRoomChecklist: (roomId: string) => {
      const next = { ...mockChecklistProgress };
      delete next[roomId];
      mockChecklistProgress = next;
    },
  }),
}));

import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";

const mockApiPost = api.post as jest.Mock;
const mockApiGet = api.get as jest.Mock;

// RoomDetailScreen consumes useTheme()/useToast(), both of which throw outside their
// providers — wrap every render/rerender the same way _layout.tsx nests them at runtime.
function withProviders() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RoomDetailScreen />
      </ToastProvider>
    </ThemeProvider>
  );
}

function renderScreen() {
  return render(withProviders());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms = [makeRoom()];
  mockChecklistProgress = {};
  mockApiGet.mockResolvedValue({
    data: [],
  });
  mockApiPost.mockResolvedValue({
    data: {
      ...mockRooms[0],
      status: "IN_PROGRESS",
    },
  });
});

describe("RoomDetailScreen", () => {
  it("shows a compact last-action line in the sticky bar instead of a status section", async () => {
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/rooms/room-1/history?limit=1"));
    await waitFor(() => expect(getByText(/rooms\.detail\.lastAction\.at/)).toBeTruthy());
    expect(queryByText("Current Status")).toBeNull();
    expect(queryByText("Status History")).toBeNull();
  });

  it("shows translated Before you enter copy near the top for unsafe rooms and does not offer Start", async () => {
    mockRooms = [
      makeRoom({
        // OCCUPIED departure: the only case that warns "Not checked out"
        status: "OCCUPIED",
        clean_type: "DEP",
        clean_type_label: "Departure",
        dnd_flag: true,
        guest_name: "Taylor Guest",
        fo_status: "OCC",
        actual_checkout_at: null,
      }),
    ];

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("rooms.detail.beforeEnter")).toBeTruthy());
    expect(getByText("rooms.detail.warnings.dnd.label")).toBeTruthy();
    expect(getByText("rooms.detail.warnings.checkout.label")).toBeTruthy();
    // DND rooms are in the "skipped" bucket → action kind is "view" → button says "View"
    expect(getByText("rooms.detail.primary.view")).toBeTruthy();
    expect(queryByText("Start Cleaning")).toBeNull();
  });

  it("shows reservation and timing context", async () => {
    mockRooms = [
      makeRoom({
        status: "DIRTY",
        guest_name: "Taylor Guest",
        fo_status: "VAC",
        clean_type: "DEP",
        actual_checkout_at: "2026-06-09T10:00:00.000Z",
        checkout_time: "2026-06-09T11:00:00.000Z",
        checkin_time: "2026-06-09T16:00:00.000Z",
        predicted_ready_at: "2026-06-09T12:15:00.000Z",
      }),
    ];

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("rooms.detail.reservationTiming")).toBeTruthy());
    expect(getByText("rooms.detail.timing.guest")).toBeTruthy();
    expect(getByText("Taylor Guest")).toBeTruthy();
    expect(getByText("rooms.detail.timing.foStatus")).toBeTruthy();
    expect(getByText("VAC")).toBeTruthy();
    expect(getByText("rooms.detail.timing.checkin")).toBeTruthy();
    expect(getByText("rooms.detail.timing.scheduledCheckout")).toBeTruthy();
    expect(getByText("rooms.detail.timing.actualCheckout")).toBeTruthy();
    expect(getByText("rooms.detail.timing.predictedReady")).toBeTruthy();
  });

  it("shows the room type code in room detail instead of the room type name", async () => {
    mockRooms = [makeRoom({ room_type_code: "KS", room_type_name: "King Suite" })];

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/rooms/room-1/history?limit=1"));

    expect(getByText("KS")).toBeTruthy();
    expect(queryByText("King Suite")).toBeNull();
  });

  it("shows a local cleaning checklist based on clean_type", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL", clean_type_label: "Full" })];

    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText("rooms.detail.cleaningChecklist")).toBeTruthy());
    const fullChip = getByLabelText("rooms.detail.cleanTypeAccessibility");
    expect(fullChip).toBeTruthy();
    expect(StyleSheet.flatten(fullChip.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: C.cautionSoft,
        borderColor: C.cautionLine,
      }),
    );
    expect(getByText("rooms.detail.checklist.makeBedPickup")).toBeTruthy();
    expect(getByText("rooms.detail.checklist.replaceTowelsUsed")).toBeTruthy();
    expect(getByText("rooms.detail.checklist.vacuumIfNeeded")).toBeTruthy();
  });

  it("removes Full and Light clean-type symbols from pickup room hero chips", async () => {
    mockRooms = [makeRoom({ status: "PICKUP", clean_type: "FULL", clean_type_label: "Full" })];

    const { getByLabelText, queryByTestId, rerender } = renderScreen();

    await waitFor(() => expect(getByLabelText("rooms.detail.cleanTypeAccessibility")).toBeTruthy());
    expect(queryByTestId("icon-refresh-circle-outline")).toBeNull();

    mockRooms = [makeRoom({ status: "PICKUP", clean_type: "LIGHT", clean_type_label: "Light" })];
    rerender(withProviders());

    await waitFor(() => expect(getByLabelText("rooms.detail.cleanTypeAccessibility")).toBeTruthy());
    expect(queryByTestId("icon-flash-outline")).toBeNull();
  });

  it("keeps room detail actions compact, button-driven, and translated", async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("rooms.detailActions.addNote")).toBeTruthy());
    expect(getByText("rooms.detailActions.workOrder")).toBeTruthy();
    expect(getByText("rooms.detailActions.lostFound")).toBeTruthy();
    expect(getByText("rooms.detailActions.supplies")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockSetMyRooms).not.toHaveBeenCalled();
  });

  it("translates the hero status, clean type, departure banner, checklist, and primary action", async () => {
    mockRooms = [
      makeRoom({
        status: "DIRTY",
        clean_type: "DEP",
        clean_type_label: "Departure",
        actual_checkout_at: "2026-06-09T10:00:00.000Z",
      }),
    ];

    const { getAllByText, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("rooms.detail.roomEyebrow")).toBeTruthy());
    expect(getAllByText("rooms.detail.status.DIRTY").length).toBeGreaterThan(0);
    expect(getByText("rooms.detail.cleanType.DEP")).toBeTruthy();
    expect(getByText("rooms.detail.departure.title")).toBeTruthy();
    expect(getByText("rooms.detail.departure.subtitle")).toBeTruthy();
    expect(getByText("rooms.detail.cleaningChecklist")).toBeTruthy();
    expect(getByText("rooms.detail.checklist.lostFoundCheck")).toBeTruthy();
    expect(getByText("rooms.detail.primary.startCleaning")).toBeTruthy();
    expect(queryByText("Vacant Dirty")).toBeNull();
    expect(queryByText("Departure")).toBeNull();
    expect(queryByText("Guest checked out — full turnover required")).toBeNull();
    expect(queryByText("Start Cleaning")).toBeNull();
  });

  it("lets housekeepers remove the latest quick-blocker note instead of showing Undo", async () => {
    mockRooms = [makeRoom({ status: "PICKUP", latest_note: null, latest_note_at: null })];

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("blockers.guestInside")).toBeTruthy());
    fireEvent.press(getByText("blockers.guestInside"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "BLOCKER: Guest inside" }),
    );
    await waitFor(() => expect(getByText("rooms.detail.warnings.note.label")).toBeTruthy());
    expect(getByText("BLOCKER: Guest inside")).toBeTruthy();
    expect(getByText("rooms.detail.removeNote")).toBeTruthy();
    expect(queryByText("Undo")).toBeNull();

    fireEvent.press(getByText("rooms.detail.removeNote"));

    expect(queryByText("BLOCKER: Guest inside")).toBeNull();
    expect(queryByText("rooms.detail.removeNote")).toBeNull();
  });

  it("formats typed come-back-later time before saving the blocker note", async () => {
    mockRooms = [makeRoom({ status: "PICKUP", latest_note: null, latest_note_at: null })];

    const { getByPlaceholderText, getByText } = renderScreen();

    await waitFor(() => expect(getByText("blockers.comeBackLater")).toBeTruthy());
    fireEvent.press(getByText("blockers.comeBackLater"));
    fireEvent.changeText(getByPlaceholderText("blockers.timePlaceholder"), "1:30");
    fireEvent.press(getByText("blockers.report"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "BLOCKER: Come back later — 1:30 PM" }),
    );
  });

  it("clears undo loading if the undo request hangs", async () => {
    jest.useFakeTimers();
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z" })];
    mockApiPost.mockImplementation(() => new Promise(() => {}));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === "rooms.undoConfirm")?.onPress?.();
    });

    try {
      const { getByText } = renderScreen();

      await waitFor(() => expect(getByText("rooms.detail.primary.markClean")).toBeTruthy());
      await act(async () => {
        fireEvent.press(getByText("rooms.detail.primary.undo"));
        await Promise.resolve();
      });

      expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/status/undo", {});
      act(() => {
        jest.advanceTimersByTime(12000);
      });
      await waitFor(() => expect(getByText("rooms.detail.primary.markClean")).toBeTruthy());
    } finally {
      alertSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
