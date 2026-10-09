import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Room } from "@/stores/appStore";
import { C } from "@/components/shared/tokens";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";

const mockSetMyRooms = jest.fn();
const mockRefreshRooms = jest.fn().mockResolvedValue(undefined);
let mockIsOnline = true;
const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

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
jest.mock("@/components/housekeeping/KnockModal", () => ({ visible }: { visible: boolean }) => {
  const { Text } = require("react-native");
  return visible ? <Text testID="knock-modal">knock</Text> : null;
});
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

function mockAppState() {
  return {
    isOnline: mockIsOnline,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
    user: { id: "user-1", tenant_id: "hotel-1" },
    refreshRooms: mockRefreshRooms,
    dropQueuedRoomStatus: jest.fn().mockResolvedValue(undefined),
    incrementDndAttempt: jest.fn().mockReturnValue(1),
    resetDndAttempt: jest.fn(),
  };
}

jest.mock("@/stores/appStore", () => {
  const useAppStore = () => mockAppState();
  useAppStore.getState = () => mockAppState();
  return { useAppStore };
});

import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import type { ChecklistItem, LocalCleanSession } from "@/lib/housekeeping/cleanSession";

function item(id: string, label: string, required: boolean, checked = false, section = "General"): ChecklistItem {
  return { item_id: id, section, label, is_required: required, checked, checked_at: checked ? "2026-10-08T10:00:00Z" : null };
}

function seedSession(checklist: ChecklistItem[], overrides: Partial<LocalCleanSession> = {}): void {
  const record: LocalCleanSession = {
    roomId: "room-1",
    sessionId: "sess-1",
    cleanType: "FULL",
    startedAt: "2026-10-08T09:30:00Z",
    entryAcknowledged: true,
    checklist,
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-08T10:00:00Z",
    ...overrides,
  };
  useCleanSessionStore.setState({ scope: "hotel-1:user-1", sessions: { "room-1": record } });
}

function serverSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    room_id: "room-1",
    housekeeper_id: "user-1",
    clean_type: "FULL",
    status: "active",
    started_at: "2026-10-08T09:30:00Z",
    ended_at: null,
    duration_seconds: null,
    checklist: [item("a", "Change linens", true), item("b", "Empty trash", false)],
    checklist_done: 0,
    checklist_total: 2,
    ...overrides,
  };
}

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

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockIsOnline = true;
  mockRooms = [makeRoom()];
  useCleanSessionStore.getState().reset();
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

  it("renders the server-snapshotted checklist for the clean session, grouped by section", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL", clean_type_label: "Full" })];
    seedSession([
      item("a", "Change linens", true, false, "Bedroom"),
      item("b", "Clean bathroom", true, false, "Bathroom"),
      item("c", "Empty trash", false, false, "Bedroom"),
    ]);
    mockApiGet.mockImplementation((path: string) =>
      path.startsWith("/clean-sessions/")
        ? Promise.resolve({ data: serverSession({ checklist: useCleanSessionStore.getState().sessions["room-1"].checklist }) })
        : Promise.resolve({ data: [] }),
    );

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
    expect(getByText("Change linens")).toBeTruthy();
    expect(getByText("Clean bathroom")).toBeTruthy();
    expect(getByText("Empty trash")).toBeTruthy();
    expect(getByText("Bedroom")).toBeTruthy();
    expect(getByText("Bathroom")).toBeTruthy();
    expect(getByText("rooms.detail.session.requiredProgress")).toBeTruthy();
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
    // No hardcoded local checklist: items only exist once the server has snapshotted a session.
    expect(getByText("rooms.detail.session.startToLoad")).toBeTruthy();
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
  describe("clean-session lifecycle", () => {
    const apiError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
    const sessionPath = "/clean-sessions/sess-1/complete";

    it("starts cleaning through the clean-session API and never the legacy status endpoint", async () => {
      mockRooms = [makeRoom({ status: "DIRTY", clean_type: "FULL", fo_status: "VAC", actual_checkout_at: "2026-10-08T08:00:00.000Z" })];
      mockApiPost.mockImplementation((path: string) =>
        path === "/clean-sessions" ? Promise.resolve({ data: serverSession() }) : Promise.resolve({ data: {} }),
      );

      const { getByText } = renderScreen();
      await waitFor(() => expect(getByText("rooms.detail.primary.startCleaning")).toBeTruthy());
      fireEvent.press(getByText("rooms.detail.primary.startCleaning"));

      await waitFor(() =>
        expect(mockApiPost).toHaveBeenCalledWith(
          "/clean-sessions",
          expect.objectContaining({ room_id: "room-1", entry_acknowledged: false }),
        ),
      );
      await waitFor(() =>
        expect(mockSetMyRooms).toHaveBeenCalledWith([expect.objectContaining({ id: "room-1", status: "IN_PROGRESS" })]),
      );
      expect((api.patch as jest.Mock).mock.calls.filter(([path]) => String(path).includes("/status"))).toEqual([]);
      expect(useCleanSessionStore.getState().sessions["room-1"].checklist.map((i) => i.label)).toEqual(["Change linens", "Empty trash"]);
    });

    it("leaves the room alone and says why when the server refuses the start (DND set since the page opened)", async () => {
      mockRooms = [makeRoom({ status: "DIRTY", clean_type: "FULL", fo_status: "VAC", actual_checkout_at: "2026-10-08T08:00:00.000Z" })];
      mockApiPost.mockImplementation((path: string) =>
        path === "/clean-sessions"
          ? Promise.reject(apiError(409, "DND_ACTIVE", "Do Not Disturb is active"))
          : Promise.resolve({ data: {} }),
      );

      const { getByText } = renderScreen();
      await waitFor(() => expect(getByText("rooms.detail.primary.startCleaning")).toBeTruthy());
      fireEvent.press(getByText("rooms.detail.primary.startCleaning"));

      await waitFor(() => expect(mockRefreshRooms).toHaveBeenCalled());
      expect(mockSetMyRooms).not.toHaveBeenCalled();
      expect(useCleanSessionStore.getState().sessions["room-1"]).toBeUndefined();
    });

    it("opens the knock protocol when the server says a guest may now be inside", async () => {
      mockRooms = [makeRoom({ status: "DIRTY", clean_type: "FULL", fo_status: "VAC", actual_checkout_at: "2026-10-08T08:00:00.000Z" })];
      mockApiPost.mockImplementation((path: string, body?: { entry_acknowledged?: boolean }) =>
        path === "/clean-sessions"
          ? body?.entry_acknowledged
            ? Promise.resolve({ data: serverSession() })
            : Promise.reject(apiError(409, "ENTRY_PROTOCOL_REQUIRED", "Knock and announce before entering"))
          : Promise.resolve({ data: {} }),
      );

      const { getByText, findByTestId } = renderScreen();
      await waitFor(() => expect(getByText("rooms.detail.primary.startCleaning")).toBeTruthy());
      fireEvent.press(getByText("rooms.detail.primary.startCleaning"));

      expect(await findByTestId("knock-modal")).toBeTruthy();
      expect(useCleanSessionStore.getState().sessions["room-1"]).toBeUndefined();
    });

    it("blocks Mark Clean while required checklist items are open", async () => {
      mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
      seedSession([item("a", "Change linens", true), item("b", "Empty trash", false, true)]);
      mockApiGet.mockImplementation((path: string) =>
        path.startsWith("/clean-sessions/") ? Promise.resolve({ data: serverSession() }) : Promise.resolve({ data: [] }),
      );

      const { getByText } = renderScreen();
      await waitFor(() => expect(getByText("rooms.detail.checklistGateHint")).toBeTruthy());
      fireEvent.press(getByText("rooms.detail.primary.markClean"));

      expect(mockApiPost).not.toHaveBeenCalledWith(sessionPath, expect.anything());
      expect(mockSetMyRooms).not.toHaveBeenCalled();
    });

    it("completes through the session API and only then marks the room clean", async () => {
      mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
      seedSession([item("a", "Change linens", true, true), item("b", "Empty trash", false)]);
      mockApiGet.mockImplementation((path: string) =>
        path.startsWith("/clean-sessions/")
          ? Promise.resolve({ data: serverSession({ checklist: [item("a", "Change linens", true, true), item("b", "Empty trash", false)] }) })
          : Promise.resolve({ data: [] }),
      );
      let resolveComplete: (value: unknown) => void = () => undefined;
      mockApiPost.mockImplementation((path: string) =>
        path === sessionPath
          ? new Promise((resolve) => {
              resolveComplete = resolve;
            })
          : Promise.resolve({ data: {} }),
      );

      const { getByText } = renderScreen();
      await waitFor(() => expect(getByText("rooms.detail.primary.markClean")).toBeTruthy());
      fireEvent.press(getByText("rooms.detail.primary.markClean"));

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(sessionPath, expect.objectContaining({ ended_at: expect.any(String) })));
      // Server has not answered yet: the UI must not claim the room is clean.
      expect(mockSetMyRooms).not.toHaveBeenCalledWith([expect.objectContaining({ status: "CLEAN" })]);

      await act(async () => {
        resolveComplete({ data: serverSession({ status: "completed", ended_at: "2026-10-08T10:20:00Z", duration_seconds: 1200 }) });
      });
      await waitFor(() =>
        expect(mockSetMyRooms).toHaveBeenCalledWith([expect.objectContaining({ id: "room-1", status: "CLEAN" })]),
      );
      expect((api.patch as jest.Mock).mock.calls.filter(([path]) => String(path).includes("/status"))).toEqual([]);
    });

    it("keeps an offline completion visibly pending and the room In Progress", async () => {
      mockIsOnline = false;
      mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
      seedSession([item("a", "Change linens", true, true)]);

      const { getByText, getByTestId } = renderScreen();
      await waitFor(() => expect(getByText("rooms.detail.primary.markClean")).toBeTruthy());
      fireEvent.press(getByText("rooms.detail.primary.markClean"));

      await waitFor(() => expect(getByTestId("session-completing-banner")).toBeTruthy());
      expect(mockApiPost).not.toHaveBeenCalled();
      expect(mockSetMyRooms).not.toHaveBeenCalledWith([expect.objectContaining({ status: "CLEAN" })]);
      expect(useCleanSessionStore.getState().sessions["room-1"].completionConfirmed).toBe(false);
    });

    it("shows a recoverable conflict instead of silently dropping local work", async () => {
      mockIsOnline = false;
      mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
      seedSession([item("a", "Change linens", true, true)], {
        conflict: { code: "ROOM_NOT_ASSIGNED", message: "This room is assigned to someone else", at: "2026-10-08T10:00:00Z" },
      });

      const { getByTestId, getByText } = renderScreen();
      await waitFor(() => expect(getByTestId("session-conflict-banner")).toBeTruthy());
      expect(getByText("This room is assigned to someone else")).toBeTruthy();
      expect(getByText("rooms.detail.session.conflictKept")).toBeTruthy();
      expect(useCleanSessionStore.getState().sessions["room-1"].checklist[0].checked).toBe(true);
    });
  });
});
