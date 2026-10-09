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
let mockHotelTimezone: string | null = "America/Chicago";
const mockT = (key: string, options?: Record<string, unknown>) => {
  if (key.startsWith("rooms.dash.") && options && !("defaultValue" in options)) return `${key} ${JSON.stringify(options)}`;
  return (options?.defaultValue as string | undefined) ?? key;
};

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
  useTranslation: () => ({ t: mockT, i18n: { language: "en", resolvedLanguage: "en" } }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const React = require("react");
    const { Text } = require("react-native");
    return React.createElement(Text, { testID: `icon-${name}` }, name);
  },
}));
const mockToast = { error: jest.fn(), info: jest.fn(), success: jest.fn(), warning: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
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
    hotelTimezone: mockHotelTimezone,
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

  it("records a come-back-later attempt on the server with a hotel-local retry instant, then writes the audit note", async () => {
    mockRooms = [makeRoom({ status: "PICKUP", latest_note: null, latest_note_at: null })];
    mockApiPost.mockImplementation((path: string) =>
      path.endsWith("/service-attempts")
        ? Promise.resolve({ data: {}, replayed: false, room: { dnd_flag: false, dnd_attempt_count: 1, dnd_last_attempt_at: "x", dnd_retry_at: "y" } })
        : Promise.resolve({ data: {} }),
    );

    const { getByPlaceholderText, getByText } = renderScreen();

    await waitFor(() => expect(getByText("blockers.comeBackLater")).toBeTruthy());
    fireEvent.press(getByText("blockers.comeBackLater"));
    fireEvent.changeText(getByPlaceholderText("blockers.timePlaceholder"), "11:59 PM");
    fireEvent.press(getByText("blockers.report"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "BLOCKER: Come back later — 11:59 PM" }),
    );
    const attempt = mockApiPost.mock.calls.find(([path]) => path === "/rooms/room-1/service-attempts");
    expect(attempt?.[1]).toMatchObject({ result: "return_later" });
    // 11:59 PM hotel time (America/Chicago) is an absolute instant, not the device's 11:59 PM.
    const retry = new Date(attempt?.[1].return_at as string);
    const hotelClock = retry.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: false });
    expect(hotelClock.replace(/\u202f/g, " ")).toMatch(/^(23:59|11:59)/);
    // The count shown comes from the server response, not a local counter.
    expect(mockSetMyRooms).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "room-1", dnd_attempt_count: 1 })]),
    );
  });

  it("does not write a come-back-later note when the time is not a usable time", async () => {
    mockRooms = [makeRoom({ status: "PICKUP", latest_note: null, latest_note_at: null })];
    const { getByPlaceholderText, getByText } = renderScreen();

    await waitFor(() => expect(getByText("blockers.comeBackLater")).toBeTruthy());
    fireEvent.press(getByText("blockers.comeBackLater"));
    fireEvent.changeText(getByPlaceholderText("blockers.timePlaceholder"), "soonish");
    fireEvent.press(getByText("blockers.report"));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.timeInvalid"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/service-attempts")).toBe(false);
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/notes")).toBe(false);
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


describe("Phase 3: rush, DND, service attempts and reclean", () => {
  const plain = (text: string) => text.replace(/\u202f/g, " ");

  function dndRoom(overrides: Partial<Room> = {}) {
    return makeRoom({
      status: "PICKUP",
      clean_type: "LIGHT",
      clean_type_label: "Light",
      fo_status: "OCC",
      dnd_flag: true,
      dnd_attempt_count: 1,
      dnd_last_attempt_at: "2026-10-08T16:25:00.000Z", // 11:25 AM Chicago
      dnd_retry_at: "2026-10-08T18:30:00.000Z", // 1:30 PM Chicago
      ...overrides,
    });
  }

  it("shows authoritative DND state with persisted attempts, last attempt and retry in hotel time, and no Start", async () => {
    mockRooms = [dndRoom()];
    const { getByText, queryByText, getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("restriction-panel")).toBeTruthy());
    expect(getByText("rooms.dash.detail.restriction.doNotEnter")).toBeTruthy();
    expect(getByText("rooms.dash.detail.restriction.dnd")).toBeTruthy();
    expect(plain(getByText(/restriction\.lastAttempt /).props.children as string)).toContain('"time":"11:25 AM"');
    expect(plain(getByText(/restriction\.retry /).props.children as string)).toContain('"time":"1:30 PM"');
    expect(getByText(/restriction\.attempts /).props.children).toContain('"count":1');
    expect(queryByText("rooms.detail.primary.startCleaning")).toBeNull();
  });

  it("says what is unknown instead of implying nothing happened", async () => {
    mockRooms = [dndRoom({ dnd_attempt_count: 0, dnd_last_attempt_at: null, dnd_retry_at: null })];
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.detail.restriction.lastAttemptUnknown")).toBeTruthy());
    expect(getByText("rooms.dash.detail.restriction.retryUnset")).toBeTruthy();
  });

  it("records an attempt through the service-attempts endpoint and shows the server's count (no local increment)", async () => {
    mockRooms = [dndRoom({ dnd_attempt_count: 1 })];
    mockApiPost.mockResolvedValue({
      data: {},
      replayed: false,
      room: { dnd_flag: true, dnd_attempt_count: 7, dnd_last_attempt_at: "2026-10-08T17:00:00.000Z", dnd_retry_at: null },
    });
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("restriction-record")).toBeTruthy());
    fireEvent.press(getByTestId("restriction-record"));
    fireEvent.press(getByTestId("restriction-option-dnd_no_response"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/service-attempts", expect.objectContaining({ result: "dnd_no_response" })));
    expect(mockSetMyRooms).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "room-1", dnd_attempt_count: 7 })]),
    );
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });

  it("retries a failed attempt with the SAME attempted_at so the server can replay it instead of double counting", async () => {
    mockRooms = [dndRoom()];
    mockApiPost.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValue({
      data: {},
      replayed: true,
      room: { dnd_flag: true, dnd_attempt_count: 2, dnd_last_attempt_at: null, dnd_retry_at: null },
    });
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("restriction-record")).toBeTruthy());
    fireEvent.press(getByTestId("restriction-record"));
    fireEvent.press(getByTestId("restriction-option-guest_answered"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.failed"));

    fireEvent.press(getByTestId("restriction-option-guest_answered"));
    await waitFor(() => expect(mockApiPost.mock.calls.filter(([path]) => path === "/rooms/room-1/service-attempts")).toHaveLength(2));
    const [first, second] = mockApiPost.mock.calls
      .filter(([path]) => path === "/rooms/room-1/service-attempts")
      .map(([, body]) => body as { attempted_at: string });
    expect(second.attempted_at).toBe(first.attempted_at);
  });

  it("refuses to record offline and never pretends it saved", async () => {
    mockIsOnline = false;
    mockRooms = [dndRoom()];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("restriction-record")).toBeTruthy());
    fireEvent.press(getByTestId("restriction-record"));
    expect(getByTestId("restriction-record").props.accessibilityState.disabled).toBe(true);
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/service-attempts")).toBe(false);
  });

  it("rejects a retry time that has already passed", async () => {
    mockRooms = [dndRoom()];
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("restriction-record")).toBeTruthy());
    fireEvent.press(getByTestId("restriction-record"));
    fireEvent.press(getByTestId("restriction-option-return_later"));
    fireEvent.changeText(getByTestId("restriction-time-input"), "12:00 AM");
    fireEvent.press(getByTestId("restriction-time-confirm"));
    await waitFor(() => expect(getByText("rooms.dash.detail.restriction.timePast")).toBeTruthy());
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/service-attempts")).toBe(false);
  });

  it("notifies the supervisor once through the existing push route", async () => {
    mockRooms = [dndRoom()];
    mockApiPost.mockResolvedValue({ data: {} });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("restriction-notify")).toBeTruthy());
    fireEvent.press(getByTestId("restriction-notify"));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/notifications/push", expect.objectContaining({ target_role: "housekeeping_supervisor" })));
    await waitFor(() => expect(getByTestId("restriction-notify").props.accessibilityState.disabled).toBe(true));
    fireEvent.press(getByTestId("restriction-notify"));
    expect(mockApiPost.mock.calls.filter(([path]) => path === "/notifications/push")).toHaveLength(1);
  });

  it("keeps Do Not Service distinct from DND and bars Start", async () => {
    mockRooms = [dndRoom({ dnd_flag: false, dnd_attempt_count: 0, dnd_retry_at: null, do_not_service: true })];
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.detail.restriction.do_not_service")).toBeTruthy());
    expect(queryByText("rooms.dash.detail.restriction.dnd")).toBeNull();
    expect(queryByText("rooms.detail.primary.startCleaning")).toBeNull();
  });

  it("a future come-back-later bars Start; once the retry time passes the room is workable again", async () => {
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    mockRooms = [makeRoom({ status: "PICKUP", clean_type: "LIGHT", fo_status: "OCC", dnd_retry_at: future, dnd_attempt_count: 1 })];
    const first = renderScreen();
    await waitFor(() => expect(first.getByTestId("restriction-panel")).toBeTruthy());
    expect(first.getByText("rooms.dash.detail.restriction.come_back_later")).toBeTruthy();
    fireEvent.press(first.getByText("rooms.detail.primary.startCleaning"));
    expect(first.queryByTestId("knock-modal")).toBeNull();
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
    first.unmount();

    mockRooms = [makeRoom({ status: "PICKUP", clean_type: "LIGHT", fo_status: "OCC", dnd_retry_at: new Date(Date.now() - 600_000).toISOString(), dnd_attempt_count: 1 })];
    const second = renderScreen();
    await waitFor(() => expect(second.getByText("rooms.dash.detail.restriction.retryDue")).toBeTruthy());
    fireEvent.press(second.getByText("rooms.detail.primary.startCleaning"));
    // Occupied stayovers still go through the knock protocol — unchanged.
    await waitFor(() => expect(second.getByTestId("knock-modal")).toBeTruthy());
  });

  it("revalidates against the freshest list when Start is tapped (a DND that landed after the page opened)", async () => {
    const open = makeRoom({ status: "DIRTY", clean_type: "FULL", fo_status: "VAC", actual_checkout_at: "2026-10-08T08:00:00.000Z" });
    mockRooms = [open];
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("rooms.detail.primary.startCleaning")).toBeTruthy());
    mockRooms = [{ ...open, dnd_flag: true }]; // refresh landed in the store, screen state is stale
    fireEvent.press(getByText("rooms.detail.primary.startCleaning"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.blockedStart"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });

  const rushRoom = (neededBy: string) =>
    makeRoom({
      status: "DIRTY",
      clean_type: "DEP",
      fo_status: "VAC",
      actual_checkout_at: "2026-10-08T08:00:00.000Z",
      priority: 1,
      priority_reason: "vip",
      priority_needed_by: neededBy,
      priority_note: "Owner arriving - check amenities",
      checkin_time: "2099-01-01T21:00:00.000Z",
    });

  it("shows Rush with the deadline in hotel time, the reason and the supervisor note, apart from the guest arrival", async () => {
    mockRooms = [rushRoom("2099-01-01T18:00:00.000Z")]; // 12:00 PM CST in America/Chicago
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(getByText("Owner arriving - check amenities")).toBeTruthy();
    expect(plain(getByText(/detail\.rush\.deadline/).props.children as string)).toContain('"time":"12:00 PM"');
  });

  it("flags a passed Rush deadline as overdue instead of 'needed by'", async () => {
    mockRooms = [rushRoom("2026-01-01T18:00:00.000Z")];
    const { getByTestId, getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(plain(getByText(/rush\.overdue/).props.children as string)).toContain('"time":"12:00 PM"');
    expect(queryByText(/detail\.rush\.deadline/)).toBeNull();
  });

  it("handles a Rush with no deadline and no reason", async () => {
    mockRooms = [makeRoom({ status: "DIRTY", clean_type: "DEP", fo_status: "VAC", actual_checkout_at: "2026-10-08T08:00:00.000Z", priority: 2 })];
    const { getByTestId, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(queryByText(/detail\.rush\.deadline|rush\.overdue/)).toBeNull();
  });

  it("lists the inspector's corrections with notes and shows only server-confirmed fixes as fixed", async () => {
    mockRooms = [
      makeRoom({
        status: "DIRTY",
        clean_type: "FULL",
        fo_status: "VAC",
        actual_checkout_at: "2026-10-08T08:00:00.000Z",
        reclean_requested_at: "2026-10-08T15:00:00.000Z",
        reclean_corrections: ["Restock bathroom amenities", "Clean bathroom mirror"],
        reclean_details: {
          inspection_id: "insp-1",
          inspected_at: "2026-10-08T14:00:00.000Z", // 9:00 AM Chicago
          overall_result: "failed",
          notes: "Needs another pass",
          items: [
            { id: "ti-1", label: "Restock bathroom amenities", note: "Missing shampoo and conditioner" },
            { id: "ti-2", label: "Clean bathroom mirror", note: "Visible streaks remain" },
          ],
        },
      }),
    ];
    seedSession(
      [
        item("c1", "Restock bathroom amenities", true, true, "Corrections"),
        item("c2", "Clean bathroom mirror", true, false, "Corrections"),
      ],
      { cleanType: "FULL" },
    );
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("reclean-panel")).toBeTruthy());
    expect(getByText("Missing shampoo and conditioner")).toBeTruthy();
    expect(getByText("Visible streaks remain")).toBeTruthy();
    expect(getByText("Needs another pass")).toBeTruthy();
    expect(getByTestId("correction-Restock bathroom amenities").props.accessibilityLabel).toContain("rooms.dash.detail.reclean.fixed");
    expect(getByTestId("correction-Clean bathroom mirror").props.accessibilityLabel).toContain("rooms.dash.detail.reclean.toFix");
  });

  it("offers Review / Start Reclean for a reclean that is safe to enter", async () => {
    mockRooms = [
      makeRoom({
        status: "DIRTY",
        clean_type: "FULL",
        fo_status: "VAC",
        actual_checkout_at: "2026-10-08T08:00:00.000Z",
        reclean_requested_at: "2026-10-08T15:00:00.000Z",
        reclean_corrections: ["Clean bathroom mirror"],
        reclean_details: { inspection_id: "i", inspected_at: null, overall_result: "failed", notes: null, items: [{ id: null, label: "Clean bathroom mirror", note: null }] },
      }),
    ];
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.detail.reclean.start")).toBeTruthy());
  });

  it("explains missing correction details instead of showing an empty list", async () => {
    mockRooms = [makeRoom({ status: "DIRTY", fo_status: "VAC", actual_checkout_at: "2026-10-08T08:00:00.000Z", reclean_requested_at: "2026-10-08T15:00:00.000Z" })];
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.detail.reclean.unavailable")).toBeTruthy());
  });
});
