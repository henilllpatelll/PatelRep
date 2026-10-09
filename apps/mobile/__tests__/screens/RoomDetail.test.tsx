import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Room } from "@/stores/appStore";
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
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
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
jest.mock("@/components/housekeeping/ReportIssueModal", () => ({ visible }: { visible: boolean }) => {
  const { Text } = require("react-native");
  return visible ? <Text testID="issue-modal">issue</Text> : null;
});
jest.mock("@/components/housekeeping/FoundItemModal", () => ({ visible }: { visible: boolean }) => {
  const { Text } = require("react-native");
  return visible ? <Text testID="found-modal">found</Text> : null;
});
jest.mock("@/components/housekeeping/SupplyRequestModal", () => ({ visible }: { visible: boolean }) => {
  const { Text } = require("react-native");
  return visible ? <Text testID="supply-modal">supply</Text> : null;
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

import { router as mockRouter } from "expo-router";
import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import type { ChecklistItem, LocalCleanSession } from "@/lib/housekeeping/cleanSession";

function item(id: string, label: string, required: boolean, checked = false, section = "General"): ChecklistItem {
  return { item_id: id, section, label, is_required: required, checked, checked_at: checked ? "2026-10-08T10:00:00Z" : null };
}

function seedSession(checklist: ChecklistItem[], overrides: Partial<LocalCleanSession> = {}, scope = "hotel-1:user-1"): void {
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
  useCleanSessionStore.setState({ scope, sessions: { "room-1": record } });
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
const mockApiPatch = api.patch as jest.Mock;
const apiError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
const sessionPath = "/clean-sessions/sess-1/complete";
const plain = (text: string) => text.replace(/\u202f/g, " ");


/**
 * A request the test resolves by hand. Every one is settled in afterEach: the clean-session
 * store serializes its network work app-wide, so one request left hanging by a failed test
 * would otherwise block every test after it.
 */
const openRequests: Array<(value: unknown) => void> = [];
function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise((res) => {
    resolve = res;
  });
  openRequests.push(resolve);
  return { promise, resolve };
}

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

/** A vacant, checked-out departure: safe to enter with a plain Start. */
const vacantDeparture = (overrides: Partial<Room> = {}) =>
  makeRoom({
    status: "DIRTY",
    clean_type: "DEP",
    clean_type_label: "Departure",
    fo_status: "VAC",
    actual_checkout_at: "2026-10-08T08:00:00.000Z",
    ...overrides,
  });

/** A stayover: a guest may be inside, so entry goes through the knock protocol. */
const stayover = (overrides: Partial<Room> = {}) =>
  makeRoom({ status: "PICKUP", clean_type: "FULL", clean_type_label: "Full", fo_status: "OCC", ...overrides });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockIsOnline = true;
  mockRooms = [makeRoom()];
  useCleanSessionStore.getState().reset();
  mockApiGet.mockResolvedValue({ data: [] });
  mockApiPatch.mockResolvedValue({ data: {} });
  mockApiPost.mockResolvedValue({ data: { ...mockRooms[0], status: "IN_PROGRESS" } });
});

afterEach(async () => {
  jest.useRealTimers();
  await act(async () => {
    for (const settle of openRequests.splice(0)) settle({ data: {} });
  });
});

/* ─── A / header ──────────────────────────────────────────────────────────── */

describe("Room Detail — layout and before-cleaning (state A)", () => {
  it("leads with the room number, clean type · room type code · floor and the status", async () => {
    mockRooms = [vacantDeparture()];
    const { getByText, getByTestId, queryByText } = renderScreen();

    await waitFor(() => expect(getByTestId("room-detail-header")).toBeTruthy());
    expect(getByText("101")).toBeTruthy();
    // Room type shows as its code, never the long name, in the header.
    expect(getByText(/KS/)).toBeTruthy();
    expect(queryByText(/King Suite/)).toBeNull();
    expect(getByText(/rooms\.card\.cleanType\.DEP/)).toBeTruthy();
    expect(getByText("rooms.detail.status.DIRTY")).toBeTruthy();
  });

  it("shows only the pre-entry facts and a Room Information link — no reservation panel, no AI card", async () => {
    mockRooms = [vacantDeparture({ guest_name: "Taylor Guest", checkout_time: "2026-10-08T11:00:00.000Z" })];
    const { getByTestId, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByTestId("before-cleaning-view")).toBeTruthy());
    expect(getByTestId("entry-check-checkout")).toBeTruthy();
    expect(getByTestId("entry-check-dnd")).toBeTruthy();
    expect(getByText("rooms.work.roomInfo.open")).toBeTruthy();
    expect(queryByText("rooms.detail.reservationTiming")).toBeNull();
    expect(queryByText("Taylor Guest")).toBeNull();
    expect(queryByText("ai.insight.title")).toBeNull();
    expect(queryByText("ai.askAboutRoom")).toBeNull();
  });

  it("moves reservation detail into Room Information and never shows the guest's name", async () => {
    mockRooms = [
      vacantDeparture({
        guest_name: "Taylor Guest",
        checkout_time: "2026-10-08T11:00:00.000Z",
        checkin_time: "2026-10-08T21:00:00.000Z",
        predicted_ready_at: "2026-10-08T17:15:00.000Z",
      }),
    ];
    const { getByTestId, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByTestId("open-room-info")).toBeTruthy());
    fireEvent.press(getByTestId("open-room-info"));

    expect(getByTestId("room-info-sheet")).toBeTruthy();
    expect(getByText("rooms.work.roomInfo.scheduledCheckout")).toBeTruthy();
    expect(getByText("rooms.work.roomInfo.confirmedCheckout")).toBeTruthy();
    expect(getByText("rooms.work.roomInfo.nextArrival")).toBeTruthy();
    expect(getByText("rooms.work.roomInfo.predictedReady")).toBeTruthy();
    expect(getByText(/King Suite/)).toBeTruthy();
    expect(queryByText("Taylor Guest")).toBeNull();
  });

  it("puts the room's last action in Room Information", async () => {
    mockRooms = [vacantDeparture()];
    const { getByTestId, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/rooms/room-1/history?limit=1"));
    expect(queryByText("Current Status")).toBeNull();
    fireEvent.press(getByTestId("open-room-info"));
    await waitFor(() => expect(getByText(/rooms\.detail\.lastAction\.at/)).toBeTruthy());
  });

  it("offers a plain Start only for a vacant, verified room, and the reporting entry point beside it", async () => {
    mockRooms = [vacantDeparture()];
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    expect(getByText("rooms.work.actions.start")).toBeTruthy();
    expect(getByText("rooms.work.actions.cantEnter")).toBeTruthy();
    expect(getByTestId("sticky-more")).toBeTruthy();
  });

  it("surfaces one informational warning (open work order) without blocking Start", async () => {
    mockRooms = [vacantDeparture({ clean_type: "LIGHT", clean_type_label: "Light", actual_checkout_at: null, open_work_order_id: "wo-1", open_work_order_title: "Leaky tap", open_work_order_number: "12" })];
    const { getByTestId, getAllByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("room-status-notice")).toBeTruthy());
    expect(getAllByTestId("room-status-notice")).toHaveLength(1);
    expect(getByTestId("sticky-start").props.accessibilityState.disabled).toBe(false);
  });

  it("explains why Start is off while another room is already in progress", async () => {
    mockRooms = [vacantDeparture(), makeRoom({ id: "room-2", room_number: "102", status: "IN_PROGRESS" })];
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    expect(getByTestId("sticky-start").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("sticky-disabled-reason").props.children).toBe("rooms.work.disabled.otherRoom");
  });
});

/* ─── Start Cleaning / session lifecycle ───────────────────────────────────── */

describe("Room Detail — start cleaning", () => {
  it("starts through the clean-session API and never the legacy status endpoint", async () => {
    mockRooms = [vacantDeparture({ clean_type: "FULL" })];
    mockApiPost.mockImplementation((path: string) =>
      path === "/clean-sessions" ? Promise.resolve({ data: serverSession() }) : Promise.resolve({ data: {} }),
    );

    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-start"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/clean-sessions", expect.objectContaining({ room_id: "room-1", entry_acknowledged: false })),
    );
    await waitFor(() => expect(mockSetMyRooms).toHaveBeenCalledWith([expect.objectContaining({ id: "room-1", status: "IN_PROGRESS" })]));
    expect(mockApiPatch.mock.calls.filter(([path]) => String(path).includes("/status"))).toEqual([]);
    expect(useCleanSessionStore.getState().sessions["room-1"].checklist.map((i) => i.label)).toEqual(["Change linens", "Empty trash"]);
  });

  it("a double tap starts one session, not two", async () => {
    mockRooms = [vacantDeparture({ clean_type: "FULL" })];
    const start = deferred();
    mockApiPost.mockImplementation((path: string) => (path === "/clean-sessions" ? start.promise : Promise.resolve({ data: {} })));

    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-start"));
    fireEvent.press(getByTestId("sticky-start"));
    fireEvent.press(getByTestId("sticky-start"));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/clean-sessions", expect.anything()));
    await act(async () => {
      start.resolve({ data: serverSession() });
    });

    expect(mockApiPost.mock.calls.filter(([path]) => path === "/clean-sessions")).toHaveLength(1);
  });

  it("leaves the room alone and says why when the server refuses the start (DND set since the page opened)", async () => {
    mockRooms = [vacantDeparture({ clean_type: "FULL" })];
    mockApiPost.mockImplementation((path: string) =>
      path === "/clean-sessions" ? Promise.reject(apiError(409, "DND_ACTIVE", "Do Not Disturb is active")) : Promise.resolve({ data: {} }),
    );

    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-start"));

    await waitFor(() => expect(mockRefreshRooms).toHaveBeenCalled());
    expect(mockToast.error).toHaveBeenCalledWith("Do Not Disturb is active");
    expect(mockSetMyRooms).not.toHaveBeenCalled();
    expect(useCleanSessionStore.getState().sessions["room-1"]).toBeUndefined();
  });

  it("revalidates against the freshest list when Start is tapped (a DND that landed after the page opened)", async () => {
    const open = vacantDeparture({ clean_type: "FULL" });
    mockRooms = [open];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    mockRooms = [{ ...open, dnd_flag: true }]; // refresh landed in the store, screen state is stale
    fireEvent.press(getByTestId("sticky-start"));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.blockedStart"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });

  it("opens the knock protocol when the server says a guest may now be inside", async () => {
    mockRooms = [vacantDeparture({ clean_type: "FULL" })];
    mockApiPost.mockImplementation((path: string, body?: { entry_acknowledged?: boolean }) =>
      path === "/clean-sessions"
        ? body?.entry_acknowledged
          ? Promise.resolve({ data: serverSession() })
          : Promise.reject(apiError(409, "ENTRY_PROTOCOL_REQUIRED", "Knock and announce before entering"))
        : Promise.resolve({ data: {} }),
    );

    const { getByTestId, findByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-start")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-start"));

    expect(await findByTestId("knock-modal")).toBeTruthy();
    expect(useCleanSessionStore.getState().sessions["room-1"]).toBeUndefined();
  });
});

/* ─── Knock protocol ───────────────────────────────────────────────────────── */

describe("Room Detail — knock protocol", () => {
  const tickAll = (getByTestId: (id: string) => unknown) => {
    for (const n of [1, 2, 3, 4, 5]) fireEvent.press(getByTestId(`knock-step-${n}`) as never);
  };

  it("an occupied stayover is entered only through the protocol — never a bare Start", async () => {
    mockRooms = [stayover()];
    const { getByTestId, queryByTestId, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(getByText("rooms.work.actions.beginEntry")).toBeTruthy();
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });

  it("starts with nothing pre-ticked and cannot be confirmed until all five steps are acknowledged", async () => {
    mockRooms = [stayover()];
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-begin_entry"));

    for (const n of [1, 2, 3, 4, 5]) {
      expect(getByTestId(`knock-step-${n}`).props.accessibilityRole).toBe("checkbox");
      expect(getByTestId(`knock-step-${n}`).props.accessibilityState.checked).toBe(false);
    }
    expect(getByTestId("knock-confirm").props.accessibilityState.disabled).toBe(true);
    expect(getByText("rooms.work.knock.finishSteps")).toBeTruthy();

    // Repeated tapping on the disabled confirm never starts anything.
    fireEvent.press(getByTestId("knock-confirm"));
    fireEvent.press(getByTestId("knock-confirm"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);

    for (const n of [1, 2, 3, 4]) fireEvent.press(getByTestId(`knock-step-${n}`));
    expect(getByTestId("knock-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("knock-step-5"));
    expect(getByTestId("knock-confirm").props.accessibilityState.disabled).toBe(false);
  });

  it("an acknowledged protocol re-reads the server, then starts with entry_acknowledged", async () => {
    mockRooms = [stayover()];
    mockApiPost.mockImplementation((path: string) =>
      path === "/clean-sessions" ? Promise.resolve({ data: serverSession() }) : Promise.resolve({ data: {} }),
    );
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-begin_entry"));
    tickAll(getByTestId);
    fireEvent.press(getByTestId("knock-confirm"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/clean-sessions", expect.objectContaining({ room_id: "room-1", entry_acknowledged: true })),
    );
    expect(mockRefreshRooms).toHaveBeenCalled(); // restrictions revalidated before the start
    await waitFor(() => expect(queryByTestId("knock-modal")).toBeNull());
  });

  it("a DND that lands while the protocol is open stops the start after confirmation", async () => {
    const guestRoom = stayover();
    mockRooms = [guestRoom];
    mockRefreshRooms.mockImplementationOnce(async () => {
      mockRooms = [{ ...guestRoom, dnd_flag: true }];
    });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-begin_entry"));
    tickAll(getByTestId);
    fireEvent.press(getByTestId("knock-confirm"));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.blockedStart"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });

  it("never approves entry while a restriction is active — it shows a stop notice instead", async () => {
    const guestRoom = stayover();
    mockRooms = [guestRoom];
    const { getByTestId, rerender, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-begin_entry"));
    expect(queryByTestId("knock-restricted")).toBeNull();

    mockRooms = [{ ...guestRoom, dnd_flag: true }];
    rerender(withProviders());

    await waitFor(() => expect(getByTestId("knock-restricted")).toBeTruthy());
    tickAll(getByTestId);
    expect(getByTestId("knock-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("knock-confirm"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });

  it("a restricted room cannot even begin the protocol from the screen", async () => {
    mockRooms = [stayover({ dnd_flag: true })];
    const { queryByTestId, getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("needs-attention-view")).toBeTruthy());
    expect(queryByTestId("sticky-begin_entry")).toBeNull();
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(queryByTestId("knock-modal")).toBeNull();
  });

  it("Cancel leaves without starting, and ticks do not carry over to the next opening", async () => {
    mockRooms = [stayover()];
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-begin_entry"));
    tickAll(getByTestId);
    fireEvent.press(getByTestId("knock-cancel"));
    expect(queryByTestId("knock-modal")).toBeNull();
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);

    fireEvent.press(getByTestId("sticky-begin_entry"));
    expect(getByTestId("knock-step-1").props.accessibilityState.checked).toBe(false);
    expect(getByTestId("knock-confirm").props.accessibilityState.disabled).toBe(true);
  });

  it("'Can't enter' hands off to the reporting options (guest inside, return later, locked door, declined) and starts nothing", async () => {
    jest.useFakeTimers();
    mockRooms = [stayover({ latest_note: null })];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-begin_entry")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-begin_entry"));
    fireEvent.press(getByTestId("knock-cant-enter"));
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(getByTestId("report-more-sheet")).toBeTruthy();
    expect(getByTestId("more-blocker-guest_inside")).toBeTruthy();
    expect(getByTestId("more-blocker-come_back_later")).toBeTruthy();
    expect(getByTestId("more-blocker-declined_service")).toBeTruthy();
    expect(getByTestId("more-blocker-dnd_sign")).toBeTruthy();
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
  });
});

/* ─── Active cleaning ──────────────────────────────────────────────────────── */

describe("Room Detail — active cleaning (state B)", () => {
  const FIXED_NOW = new Date("2026-10-08T10:00:00.000Z");

  it("renders the server-snapshotted checklist grouped by section, first unfinished section open, original order kept", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL", clean_type_label: "Full" })];
    seedSession([
      item("a", "Change linens", true, false, "Bedroom"),
      item("b", "Clean bathroom", true, false, "Bathroom"),
      item("c", "Empty trash", false, false, "Bedroom"),
    ]);

    const { getByText, getByTestId, queryByText } = renderScreen();

    await waitFor(() => expect(getByTestId("active-cleaning-view")).toBeTruthy());
    expect(getByText("rooms.detail.cleaningChecklist")).toBeTruthy();
    expect(getByText("Bedroom")).toBeTruthy();
    expect(getByText("Bathroom")).toBeTruthy();
    expect(getByText("Change linens")).toBeTruthy();
    expect(getByText("Empty trash")).toBeTruthy();
    expect(queryByText("Clean bathroom")).toBeNull(); // collapsed until opened
    expect(getByTestId("checklist-count").props.children.join("")).toBe("0 / 3");

    fireEvent.press(getByTestId("checklist-toggle-Bathroom"));
    expect(getByText("Clean bathroom")).toBeTruthy();
    fireEvent.press(getByTestId("checklist-toggle-Bedroom"));
    expect(queryByText("Change linens")).toBeNull();
    expect(getByTestId("checklist-toggle-Bedroom").props.accessibilityState.expanded).toBe(false);
  });

  it("offers the pre-existing-damage photo only until the first step is ticked", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "DEP", actual_checkout_at: "2026-10-08T08:00:00.000Z", fo_status: "VAC" })];
    seedSession([item("a", "Strip beds", true), item("b", "Vacuum", false)], { cleanType: "DEP" });
    mockApiGet.mockImplementation((path: string) =>
      path.startsWith("/clean-sessions/") ? Promise.resolve({ data: serverSession({ clean_type: "DEP", checklist: [item("a", "Strip beds", true), item("b", "Vacuum", false)] }) }) : Promise.resolve({ data: [] }),
    );
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("damage-banner")).toBeTruthy());
    fireEvent.press(getByTestId("checklist-item-id:a"));
    await waitFor(() => expect(queryByTestId("damage-banner")).toBeNull());
  });

  it("shows CLEAN in the header as soon as the server confirms the completion, matching the body", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, true)], { completionConfirmed: true, durationSeconds: 600 });
    const { getByTestId, getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("submitted-room-view")).toBeTruthy());
    expect(getByText("rooms.detail.status.CLEAN")).toBeTruthy();
    expect(queryByText("rooms.detail.status.IN_PROGRESS")).toBeNull();
  });

  it("marks required items and distinguishes them from optional ones", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true), item("b", "Empty trash", false)]);
    const { getByTestId, getAllByText, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("cleaning-checklist")).toBeTruthy());
    expect(getAllByText("rooms.detail.session.required").length).toBeGreaterThan(0);
    expect(getByText("rooms.work.checklist.optional")).toBeTruthy();
    expect(getByTestId("checklist-item-id:a").props.accessibilityLabel).toContain("rooms.detail.session.required");
    expect(getByTestId("checklist-item-id:b").props.accessibilityLabel).toContain("rooms.work.checklist.optional");
    expect(getByTestId("checklist-item-id:a").props.accessibilityRole).toBe("checkbox");
  });

  it("persists each tick through the session client and shows it as saving until the server confirms", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true), item("b", "Empty trash", false)]);
    const patch = deferred();
    mockApiPatch.mockImplementation(() => patch.promise);
    mockApiGet.mockImplementation((path: string) =>
      path.startsWith("/clean-sessions/") ? Promise.resolve({ data: serverSession() }) : Promise.resolve({ data: [] }),
    );

    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("checklist-item-id:a")).toBeTruthy());
    fireEvent.press(getByTestId("checklist-item-id:a"));

    await waitFor(() => expect(getByTestId("pending-id:a")).toBeTruthy());
    expect(getByTestId("checklist-item-id:a").props.accessibilityState.checked).toBe(true);
    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledWith("/clean-sessions/sess-1", { checklist: [expect.objectContaining({ item_id: "a", checked: true })] }));

    await act(async () => {
      patch.resolve({ data: serverSession({ checklist: [item("a", "Change linens", true, true), item("b", "Empty trash", false)] }) });
    });
    await waitFor(() => expect(queryByTestId("pending-id:a")).toBeNull());
    expect(getByTestId("checklist-item-id:a").props.accessibilityState.checked).toBe(true);
  });

  it("rapid edits keep the newest state of every item", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true), item("b", "Empty trash", false)]);
    // The server applies exactly what it is sent, like the real PATCH endpoint.
    let serverChecklist = [item("a", "Change linens", true), item("b", "Empty trash", false)];
    mockApiPatch.mockImplementation(async (_path: string, body: { checklist: ChecklistItem[] }) => {
      serverChecklist = serverChecklist.map((entry) => body.checklist.find((sent) => sent.item_id === entry.item_id) ?? entry);
      return { data: serverSession({ checklist: serverChecklist }) };
    });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("checklist-item-id:a")).toBeTruthy());

    fireEvent.press(getByTestId("checklist-item-id:a")); // on
    fireEvent.press(getByTestId("checklist-item-id:a")); // off
    fireEvent.press(getByTestId("checklist-item-id:a")); // on again
    fireEvent.press(getByTestId("checklist-item-id:b"));

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalled());
    await waitFor(() => expect(Object.keys(useCleanSessionStore.getState().sessions["room-1"].pendingItems)).toHaveLength(0));
    const checklist = useCleanSessionStore.getState().sessions["room-1"].checklist;
    expect(checklist.find((i) => i.item_id === "a")?.checked).toBe(true);
    expect(checklist.find((i) => i.item_id === "b")?.checked).toBe(true);
  });

  it("computes the timer from the session's start time and keeps counting across re-renders", async () => {
    jest.useFakeTimers({ now: FIXED_NOW });
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true)], { startedAt: new Date(FIXED_NOW.getTime() - (18 * 60 + 24) * 1000).toISOString(), baseCleanMinutes: 30 });

    const { getByTestId, rerender } = renderScreen();
    await waitFor(() => expect(getByTestId("timer-elapsed")).toBeTruthy());
    expect(getByTestId("timer-elapsed").props.children).toBe("18:24");
    expect(getByTestId("timer-standard").props.children).toBe("rooms.work.timer.standardValue");

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(getByTestId("timer-elapsed").props.children).toBe("18:27");

    // A remount (navigating away and back) does not reset it: the start time is the source.
    rerender(withProviders());
    expect(getByTestId("timer-elapsed").props.children).toBe("18:27");
  });

  it("hides the standard time when none is configured and shows no number for an unusable start", async () => {
    jest.useFakeTimers({ now: FIXED_NOW });
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true)], { startedAt: "2026-09-01T00:00:00.000Z", baseCleanMinutes: null });

    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("timer-elapsed")).toBeTruthy());
    expect(getByTestId("timer-elapsed").props.children).toBe("—");
    expect(queryByTestId("timer-standard")).toBeNull();
  });

  it("restores an in-progress clean after a restart: checklist, ticks and timer come back from the server session", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/clean-sessions/active") {
        return Promise.resolve({
          data: serverSession({ base_clean_minutes: 30, checklist: [item("a", "Change linens", true, true), item("b", "Empty trash", false)] }),
        });
      }
      return Promise.resolve({ data: [] });
    });
    useCleanSessionStore.setState({ scope: "hotel-1:user-1", sessions: {} });

    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("checklist-item-id:a")).toBeTruthy());
    expect(getByTestId("checklist-item-id:a").props.accessibilityState.checked).toBe(true);
    expect(getByTestId("checklist-item-id:b").props.accessibilityState.checked).toBe(false);
    expect(useCleanSessionStore.getState().sessions["room-1"].baseCleanMinutes).toBe(30);
  });

  it("IN_PROGRESS with no checklist on this device says it is loading and cannot be finished", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    mockApiGet.mockRejectedValue(new Error("network"));
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("active-cleaning-view")).toBeTruthy());
    expect(getByText("rooms.detail.session.loadingChecklist")).toBeTruthy();
    expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("sticky-disabled-reason").props.children).toBe("rooms.work.disabled.loadingChecklist");
  });

  it("never surfaces another user's (or hotel's) session for this room", async () => {
    mockRooms = [vacantDeparture({ clean_type: "FULL" })];
    seedSession([item("a", "Someone else's item", true)], {}, "hotel-2:user-9");

    const { getByTestId, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("before-cleaning-view")).toBeTruthy());
    expect(queryByText("Someone else's item")).toBeNull();
    expect(getByTestId("sticky-start")).toBeTruthy();
  });
});

/* ─── Completing ───────────────────────────────────────────────────────────── */

describe("Room Detail — completing", () => {
  function seedWorking(checked: boolean) {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, checked), item("b", "Empty trash", false)]);
    mockApiGet.mockImplementation((path: string) =>
      path.startsWith("/clean-sessions/")
        ? Promise.resolve({ data: serverSession({ checklist: [item("a", "Change linens", true, checked), item("b", "Empty trash", false)] }) })
        : Promise.resolve({ data: [] }),
    );
  }

  it("blocks finishing while required items are open, says how many, and opens nothing", async () => {
    seedWorking(false);
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-complete")).toBeTruthy());

    expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("sticky-disabled-reason").props.children).toBe("rooms.work.disabled.stepsRemaining");
    fireEvent.press(getByTestId("sticky-complete"));
    expect(queryByTestId("complete-sheet")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalledWith(sessionPath, expect.anything());
    expect(mockSetMyRooms).not.toHaveBeenCalled();
  });

  it("asks for confirmation first; 'Keep Cleaning' changes nothing", async () => {
    seedWorking(true);
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(getByTestId("sticky-complete"));

    expect(getByTestId("complete-sheet")).toBeTruthy();
    fireEvent.press(getByTestId("complete-keep"));
    expect(queryByTestId("complete-sheet")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalledWith(sessionPath, expect.anything());
  });

  it("completes through the session API and only then shows the room as submitted", async () => {
    seedWorking(true);
    const complete = deferred();
    mockApiPost.mockImplementation((path: string) => (path === sessionPath ? complete.promise : Promise.resolve({ data: {} })));

    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(getByTestId("sticky-complete"));
    fireEvent.press(getByTestId("complete-confirm"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(sessionPath, expect.objectContaining({ ended_at: expect.any(String) })));
    // The server has not answered: nothing may claim the room is clean or submitted.
    expect(mockSetMyRooms).not.toHaveBeenCalledWith([expect.objectContaining({ status: "CLEAN" })]);
    expect(queryByTestId("submitted-room-view")).toBeNull();

    await act(async () => {
      complete.resolve({ data: serverSession({ status: "completed", ended_at: "2026-10-08T10:20:00Z", duration_seconds: 1200 }) });
    });
    await waitFor(() => expect(mockSetMyRooms).toHaveBeenCalledWith([expect.objectContaining({ id: "room-1", status: "CLEAN" })]));
    expect(mockApiPatch.mock.calls.filter(([path]) => String(path).includes("/status"))).toEqual([]);
  });

  it("a double tap on Submit sends one completion", async () => {
    seedWorking(true);
    const complete = deferred();
    mockApiPost.mockImplementation((path: string) => (path === sessionPath ? complete.promise : Promise.resolve({ data: {} })));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(getByTestId("sticky-complete"));
    fireEvent.press(getByTestId("complete-confirm"));
    fireEvent.press(getByTestId("complete-confirm"));
    fireEvent.press(getByTestId("complete-confirm"));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(sessionPath, expect.anything()));
    await act(async () => {
      complete.resolve({ data: serverSession({ status: "completed", ended_at: "2026-10-08T10:20:00Z", duration_seconds: 1200 }) });
    });

    expect(mockApiPost.mock.calls.filter(([path]) => path === sessionPath)).toHaveLength(1);
  });

  it("keeps an offline completion visibly pending: In Progress, not submitted, and not pressable again", async () => {
    mockIsOnline = false;
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, true)]);

    const { getByTestId, queryByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-complete")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-complete"));
    fireEvent.press(getByTestId("complete-confirm"));

    await waitFor(() => expect(getByTestId("session-completing-banner")).toBeTruthy());
    expect(getByText("rooms.detail.session.completingTitle")).toBeTruthy();
    expect(queryByTestId("submitted-room-view")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockSetMyRooms).not.toHaveBeenCalledWith([expect.objectContaining({ status: "CLEAN" })]);
    expect(useCleanSessionStore.getState().sessions["room-1"].completionConfirmed).toBe(false);
    expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("sticky-disabled-reason").props.children).toBe("rooms.work.disabled.completionPending");
  });

  it("says plainly that it is working offline and how many changes are waiting", async () => {
    mockIsOnline = false;
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, true), item("b", "Empty trash", false, true)], {
      pendingItems: { "id:a": item("a", "Change linens", true, true), "id:b": item("b", "Empty trash", false, true) },
    });
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("session-offline-banner")).toBeTruthy());
    expect(getByText("rooms.work.offline.title")).toBeTruthy();
    expect(getByText("rooms.work.offline.pending")).toBeTruthy();
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
    expect(getByTestId("sticky-disabled-reason").props.children).toBe("rooms.work.disabled.conflict");
    expect(useCleanSessionStore.getState().sessions["room-1"].checklist[0].checked).toBe(true);
  });

  it("a server refusal on required items returns the room to active work with the reason", async () => {
    seedWorking(true);
    mockApiPost.mockImplementation((path: string) =>
      path === sessionPath
        ? Promise.reject(Object.assign(new Error("1 required item unfinished"), { status: 422, code: "REQUIRED_ITEMS_INCOMPLETE", detail: { missing: ["Change linens"] } }))
        : Promise.resolve({ data: {} }),
    );
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(getByTestId("sticky-complete"));
    fireEvent.press(getByTestId("complete-confirm"));

    await waitFor(() => expect(getByTestId("session-required-banner")).toBeTruthy());
    expect(queryByTestId("submitted-room-view")).toBeNull();
    expect(useCleanSessionStore.getState().sessions["room-1"].completionConfirmed).toBe(false);
  });
});

/* ─── Linen exchange ───────────────────────────────────────────────────────── */

describe("Room Detail — linen exchange", () => {
  function seedDeparture(overrides: Partial<LocalCleanSession> = {}) {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "DEP", actual_checkout_at: "2026-10-08T08:00:00.000Z", fo_status: "VAC" })];
    const checklist = [item("a", "Strip beds", true, true)];
    seedSession(checklist, { cleanType: "DEP", ...overrides });
    mockApiGet.mockImplementation((path: string) =>
      path.startsWith("/clean-sessions/") ? Promise.resolve({ data: serverSession({ clean_type: "DEP", checklist }) }) : Promise.resolve({ data: [] }),
    );
  }

  it("is an optional row on departure cleans, not a forced form", async () => {
    seedDeparture();
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("linen-row")).toBeTruthy());
    expect(getByText("rooms.work.linen.notRecorded")).toBeTruthy();
    expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(false); // no linen needed to finish
  });

  it("is not shown on a stayover clean", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true)], { cleanType: "FULL" });
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("active-cleaning-view")).toBeTruthy());
    expect(queryByTestId("linen-row")).toBeNull();
  });

  it("saves integer counts on this session through the clean-session API and keeps them on reopening", async () => {
    seedDeparture();
    mockApiPatch.mockResolvedValue({ data: serverSession({ clean_type: "DEP", linen_counts: { dirty_out: 2, clean_in: 1 } }) });
    const { getByTestId, getByLabelText, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("linen-row")).toBeTruthy());

    fireEvent.press(getByTestId("linen-row"));
    fireEvent.press(getByLabelText("rooms.detail.linen.dirtyOut +"));
    fireEvent.press(getByLabelText("rooms.detail.linen.dirtyOut +"));
    fireEvent.press(getByLabelText("rooms.detail.linen.cleanIn +"));
    fireEvent.press(getByTestId("linen-save"));

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledWith("/clean-sessions/sess-1", { linen_counts: { dirty_out: 2, clean_in: 1 } }));
    await waitFor(() => expect(useCleanSessionStore.getState().sessions["room-1"].linen).toEqual({ dirtyOut: 2, cleanIn: 1, pending: false, failed: false }));
    expect(getByText("rooms.work.linen.summary")).toBeTruthy();

    fireEvent.press(getByTestId("linen-row"));
    expect(getByTestId("linen-count-rooms.detail.linen.dirtyOut").props.children).toBe(2);
    expect(getByTestId("linen-count-rooms.detail.linen.cleanIn").props.children).toBe(1);
  });

  it("never lets a count go below zero", async () => {
    seedDeparture();
    const { getByTestId, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByTestId("linen-row")).toBeTruthy());
    fireEvent.press(getByTestId("linen-row"));
    fireEvent.press(getByLabelText("rooms.detail.linen.dirtyOut −"));
    expect(getByTestId("linen-count-rooms.detail.linen.dirtyOut").props.children).toBe(0);
    expect(getByLabelText("rooms.detail.linen.dirtyOut −").props.accessibilityState.disabled).toBe(true);
  });

  it("offline: keeps the counts on this device as pending, labelled as not yet saved", async () => {
    mockIsOnline = false;
    seedDeparture();
    const { getByTestId, getByLabelText, getAllByText } = renderScreen();
    await waitFor(() => expect(getByTestId("linen-row")).toBeTruthy());
    fireEvent.press(getByTestId("linen-row"));
    fireEvent.press(getByLabelText("rooms.detail.linen.cleanIn +"));
    fireEvent.press(getByTestId("linen-save"));

    await waitFor(() => expect(useCleanSessionStore.getState().sessions["room-1"].linen?.pending).toBe(true));
    expect(mockApiPatch).not.toHaveBeenCalled();
    expect(getAllByText("rooms.work.linen.status.pending").length).toBeGreaterThan(0);
  });

  it("a refused linen save is flagged on the sheet, keeps the counts, and does not block completing the room", async () => {
    seedDeparture();
    mockApiPatch.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    mockApiPost.mockImplementation((path: string) =>
      path === sessionPath ? Promise.resolve({ data: serverSession({ status: "completed", duration_seconds: 900, ended_at: "2026-10-08T10:00:00Z" }) }) : Promise.resolve({ data: {} }),
    );
    const { getByTestId, getByLabelText, getAllByText } = renderScreen();
    await waitFor(() => expect(getByTestId("linen-row")).toBeTruthy());
    fireEvent.press(getByTestId("linen-row"));
    fireEvent.press(getByLabelText("rooms.detail.linen.dirtyOut +"));
    fireEvent.press(getByTestId("linen-save"));

    await waitFor(() => expect(useCleanSessionStore.getState().sessions["room-1"].linen?.failed).toBe(true));
    expect(useCleanSessionStore.getState().sessions["room-1"].linen?.dirtyOut).toBe(1);
    expect(getAllByText("rooms.work.linen.status.failed").length).toBeGreaterThan(0);

    fireEvent.press(getByTestId("sticky-complete"));
    fireEvent.press(getByTestId("complete-confirm"));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(sessionPath, expect.anything()));
  });
});

/* ─── Terminal states ──────────────────────────────────────────────────────── */

describe("Room Detail — submitted, ready and unavailable (states E, F, G)", () => {
  it("E: shows submitted only for a server-CLEAN room, awaiting inspection, with no Start and no Undo", async () => {
    mockRooms = [makeRoom({ status: "CLEAN", clean_type: "DEP", clean_type_label: "Departure" })];
    const { getByTestId, getByText, queryByTestId, queryByText } = renderScreen();

    await waitFor(() => expect(getByTestId("submitted-room-view")).toBeTruthy());
    expect(getByText("rooms.work.submitted.title")).toBeTruthy();
    expect(getByText("rooms.work.submitted.awaitingInspection")).toBeTruthy();
    expect(queryByText(/guest.?ready/i)).toBeNull();
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(queryByTestId("sticky-begin_entry")).toBeNull();
    expect(queryByText("rooms.detail.primary.undo")).toBeNull();
    expect(mockApiPost.mock.calls.some(([path]) => String(path).includes("/status/undo"))).toBe(false);
  });

  it("E: shows the confirmed duration and checklist summary from the server's record", async () => {
    mockRooms = [makeRoom({ status: "CLEAN", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, true), item("b", "Empty trash", false, true)], {
      completionConfirmed: true,
      durationSeconds: 1680,
      endedAt: "2026-10-08T10:00:00Z",
    });
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("submitted-duration")).toBeTruthy());
    expect(getByTestId("submitted-duration").props.accessibilityLabel).toContain("rooms.work.submitted.minutes");
    expect(getByTestId("submitted-checklist").props.accessibilityLabel).toContain("2 / 2");
  });

  it("E: Go to Next Room opens the next workable room by the route ordering (never a restricted one)", async () => {
    mockRooms = [
      makeRoom({ status: "CLEAN", clean_type: "FULL" }),
      vacantDeparture({ id: "room-2", room_number: "102", dnd_flag: true }),
      vacantDeparture({ id: "room-3", room_number: "103" }),
    ];
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("sticky-next_room")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-next_room"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/my-rooms/room-3");
  });

  it("E: with no workable room left it offers My Rooms instead", async () => {
    mockRooms = [makeRoom({ status: "CLEAN", clean_type: "FULL" }), vacantDeparture({ id: "room-2", room_number: "102", dnd_flag: true })];
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("sticky-back_to_route")).toBeTruthy());
    expect(queryByTestId("sticky-next_room")).toBeNull();
    fireEvent.press(getByTestId("sticky-back_to_route"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/my-rooms");
  });

  it("F: INSPECTED is read-only — no start, no complete, only navigation and the record", async () => {
    mockRooms = [makeRoom({ status: "INSPECTED", last_cleaned_at: "2026-10-08T15:00:00.000Z", last_inspected_at: "2026-10-08T16:00:00.000Z" })];
    const { getByTestId, getByText, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("ready-room-view")).toBeTruthy());
    expect(getByText("rooms.work.ready.title")).toBeTruthy();
    for (const id of ["sticky-start", "sticky-begin_entry", "sticky-complete", "sticky-resubmit", "sticky-more", "room-detail-more"]) {
      expect(queryByTestId(id)).toBeNull();
    }
    expect(getByTestId("sticky-view_record")).toBeTruthy();
    expect(getByTestId("sticky-back_to_route")).toBeTruthy();
  });

  it.each(["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"] as const)("G: %s is unavailable with the work order and no housekeeper override", async (status) => {
    mockRooms = [makeRoom({ status, dnd_flag: true, priority: 1, open_work_order_id: "wo-9", open_work_order_title: "AC repair", open_work_order_number: "9" })];
    const { getByTestId, getByText, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("unavailable-room-view")).toBeTruthy());
    expect(getByText("rooms.work.unavailable.body")).toBeTruthy();
    expect(getByText("AC repair #9")).toBeTruthy();
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(queryByTestId("sticky-begin_entry")).toBeNull();
    fireEvent.press(getByTestId("sticky-view_work_order"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/work-orders/wo-9");
  });
});

/* ─── Needs attention: DND, declined, come back later ──────────────────────── */

describe("Room Detail — needs attention (state C) and Phase 3 behavior", () => {
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
    const { getByText, queryByTestId, getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("restriction-panel")).toBeTruthy());
    expect(getByText("rooms.dash.detail.restriction.doNotEnter")).toBeTruthy();
    expect(getByText("rooms.dash.detail.restriction.dnd")).toBeTruthy();
    expect(plain(getByText(/restriction\.lastAttempt /).props.children as string)).toContain('"time":"11:25 AM"');
    expect(plain(getByText(/restriction\.retry /).props.children as string)).toContain('"time":"1:30 PM"');
    expect(getByText(/restriction\.attempts /).props.children).toContain('"count":1');
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(queryByTestId("sticky-begin_entry")).toBeNull();
  });

  it("offers Record Service Attempt and Back to Route in the sticky bar instead of duplicating them in the panel", async () => {
    mockRooms = [dndRoom()];
    const { getByTestId, queryByTestId, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("sticky-record_attempt")).toBeTruthy());
    expect(getByText("rooms.work.actions.recordAttempt")).toBeTruthy();
    expect(getByTestId("sticky-back_to_route")).toBeTruthy();
    expect(queryByTestId("restriction-record")).toBeNull();
    expect(queryByTestId("restriction-return")).toBeNull();
    fireEvent.press(getByTestId("sticky-back_to_route"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/my-rooms");
  });

  it("DND beats a Rush priority: the deadline is context only and there is still no way in", async () => {
    mockRooms = [dndRoom({ priority: 1, priority_reason: "vip", priority_needed_by: "2099-01-01T18:00:00.000Z", priority_note: "Owner arriving" })];
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(getByTestId("restriction-panel")).toBeTruthy();
    for (const id of ["sticky-start", "sticky-begin_entry"]) expect(queryByTestId(id)).toBeNull();
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

    await waitFor(() => expect(getByTestId("sticky-record_attempt")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-record_attempt"));
    fireEvent.press(getByTestId("restriction-option-dnd_no_response"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/service-attempts", expect.objectContaining({ result: "dnd_no_response" })));
    expect(mockSetMyRooms).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "room-1", dnd_attempt_count: 7 })]));
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

    await waitFor(() => expect(getByTestId("sticky-record_attempt")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-record_attempt"));
    fireEvent.press(getByTestId("restriction-option-guest_answered"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.failed"));

    fireEvent.press(getByTestId("restriction-option-guest_answered"));
    await waitFor(() => expect(mockApiPost.mock.calls.filter(([path]) => path === "/rooms/room-1/service-attempts")).toHaveLength(2));
    const [first, second] = mockApiPost.mock.calls.filter(([path]) => path === "/rooms/room-1/service-attempts").map(([, body]) => body as { attempted_at: string });
    expect(second.attempted_at).toBe(first.attempted_at);
  });

  it("refuses to record offline and never pretends it saved", async () => {
    mockIsOnline = false;
    mockRooms = [dndRoom()];
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-record_attempt")).toBeTruthy());
    expect(getByText("rooms.dash.detail.restriction.needsConnection")).toBeTruthy();
    fireEvent.press(getByTestId("sticky-record_attempt"));
    fireEvent.press(getByTestId("restriction-option-dnd_no_response"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/service-attempts")).toBe(false);
    expect(mockToast.info).toHaveBeenCalledWith("rooms.dash.detail.restriction.needsConnection");
  });

  it("rejects a retry time that has already passed", async () => {
    mockRooms = [dndRoom()];
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-record_attempt")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-record_attempt"));
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

  it("keeps Do Not Service distinct from DND and bars entry", async () => {
    mockRooms = [dndRoom({ dnd_flag: false, dnd_attempt_count: 0, dnd_retry_at: null, do_not_service: true })];
    const { getByText, queryByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.detail.restriction.do_not_service")).toBeTruthy());
    expect(queryByText("rooms.dash.detail.restriction.dnd")).toBeNull();
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(queryByTestId("sticky-begin_entry")).toBeNull();
  });

  it("a future come-back-later bars entry; once the retry time passes the room is workable again (still via the protocol for a stayover)", async () => {
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    mockRooms = [stayover({ clean_type: "LIGHT", dnd_retry_at: future, dnd_attempt_count: 1 })];
    const first = renderScreen();
    await waitFor(() => expect(first.getByTestId("restriction-panel")).toBeTruthy());
    expect(first.getByText("rooms.dash.detail.restriction.come_back_later")).toBeTruthy();
    expect(first.queryByTestId("sticky-begin_entry")).toBeNull();
    expect(first.queryByTestId("knock-modal")).toBeNull();
    expect(mockApiPost.mock.calls.some(([path]) => path === "/clean-sessions")).toBe(false);
    first.unmount();

    mockRooms = [stayover({ clean_type: "LIGHT", dnd_retry_at: new Date(Date.now() - 600_000).toISOString(), dnd_attempt_count: 1 })];
    const second = renderScreen();
    await waitFor(() => expect(second.getByText("rooms.dash.detail.restriction.retryDue")).toBeTruthy());
    fireEvent.press(second.getByTestId("sticky-begin_entry"));
    await waitFor(() => expect(second.getByTestId("knock-modal")).toBeTruthy());
  });

  it("C: an unverified departure checkout leads with the entry protocol and an access-issue report — never a bare Start", async () => {
    mockRooms = [makeRoom({ status: "OCCUPIED", clean_type: "DEP", clean_type_label: "Departure", fo_status: "OCC", actual_checkout_at: null, checkout_time: "2026-10-08T16:00:00.000Z" })];
    const { getByTestId, getByText, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId("access-notice")).toBeTruthy());
    expect(getByText("rooms.work.attention.checkoutUnverified.title")).toBeTruthy();
    expect(queryByTestId("sticky-start")).toBeNull();
    expect(getByTestId("sticky-begin_entry")).toBeTruthy();
    expect(getByText("rooms.work.actions.reportAccess")).toBeTruthy();
  });

  const rushRoom = (neededBy: string) =>
    vacantDeparture({
      priority: 1,
      priority_reason: "vip",
      priority_needed_by: neededBy,
      priority_note: "Owner arriving - check amenities",
      checkin_time: "2099-01-01T21:00:00.000Z",
    });

  it("shows Rush with the deadline in hotel time, the reason and the supervisor note, apart from the guest arrival", async () => {
    mockRooms = [rushRoom("2099-01-01T18:00:00.000Z")]; // 12:00 PM CST in America/Chicago
    const { getByTestId, getByText, getByLabelText } = renderScreen();
    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(getByText("Owner arriving - check amenities")).toBeTruthy();
    expect(plain(getByText(/detail\.rush\.deadline/).props.children as string)).toContain('"time":"12:00 PM"');
    expect(getByLabelText("rooms.dash.rush.title")).toBeTruthy(); // RUSH badge in the header
  });

  it("flags a passed Rush deadline as overdue instead of 'needed by'", async () => {
    mockRooms = [rushRoom("2026-01-01T18:00:00.000Z")];
    const { getByTestId, getByText, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(plain(getByText(/rush\.overdue/).props.children as string)).toContain('"time":"12:00 PM"');
    expect(queryByText(/detail\.rush\.deadline/)).toBeNull();
  });

  it("handles a Rush with no deadline and no reason", async () => {
    mockRooms = [vacantDeparture({ priority: 2 })];
    const { getByTestId, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("rush-panel")).toBeTruthy());
    expect(queryByText(/detail\.rush\.deadline|rush\.overdue/)).toBeNull();
  });
});

/* ─── Reclean (state D) ────────────────────────────────────────────────────── */

describe("Room Detail — reclean (state D)", () => {
  const recleanDetails = {
    inspection_id: "insp-1",
    inspected_at: "2026-10-08T14:00:00.000Z", // 9:00 AM Chicago
    overall_result: "failed",
    notes: "Needs another pass",
    items: [
      { id: "ti-1", label: "Restock bathroom amenities", note: "Missing shampoo and conditioner" },
      { id: "ti-2", label: "Clean bathroom mirror", note: "Visible streaks remain" },
    ],
  };
  const recleanRoom = (overrides: Partial<Room> = {}) =>
    vacantDeparture({
      clean_type: "FULL",
      reclean_requested_at: "2026-10-08T15:00:00.000Z",
      reclean_corrections: ["Restock bathroom amenities", "Clean bathroom mirror"],
      reclean_details: recleanDetails,
      ...overrides,
    });

  it("before starting, lists the inspector's corrections with notes and offers Start Corrections", async () => {
    mockRooms = [recleanRoom()];
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => expect(getByTestId("reclean-panel")).toBeTruthy());
    expect(getByText("Missing shampoo and conditioner")).toBeTruthy();
    expect(getByText("Visible streaks remain")).toBeTruthy();
    expect(getByText("Needs another pass")).toBeTruthy();
    expect(getByText("rooms.work.actions.startCorrections")).toBeTruthy();
  });

  it("explains missing correction details instead of showing an empty list", async () => {
    mockRooms = [vacantDeparture({ reclean_requested_at: "2026-10-08T15:00:00.000Z" })];
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.detail.reclean.unavailable")).toBeTruthy());
  });

  it("while working, shows the corrections as the checklist with the inspector's notes and only server-confirmed fixes ticked", async () => {
    mockRooms = [recleanRoom({ status: "IN_PROGRESS" })];
    seedSession(
      [item("c1", "Restock bathroom amenities", true, true, "Corrections"), item("c2", "Clean bathroom mirror", true, false, "Corrections")],
      { cleanType: "FULL" },
    );
    const { getByTestId, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByTestId("reclean-work-view")).toBeTruthy());
    expect(getByText("rooms.work.reclean.title")).toBeTruthy();
    expect(getByText("Missing shampoo and conditioner")).toBeTruthy();
    expect(getByTestId("checklist-item-id:c1").props.accessibilityState.checked).toBe(true);
    expect(getByTestId("checklist-item-id:c2").props.accessibilityState.checked).toBe(false);
    expect(queryByText("rooms.detail.cleaningChecklist")).toBeNull(); // not the full departure list
    expect(getByTestId("view-inspection")).toBeTruthy();
  });

  it("resubmits for inspection only when every correction is done, and never as a status shortcut", async () => {
    mockRooms = [recleanRoom({ status: "IN_PROGRESS" })];
    const corrections = [item("c1", "Restock bathroom amenities", true, true, "Corrections"), item("c2", "Clean bathroom mirror", true, false, "Corrections")];
    seedSession(corrections, { cleanType: "FULL" });
    mockApiGet.mockImplementation((path: string) =>
      path.startsWith("/clean-sessions/") ? Promise.resolve({ data: serverSession({ checklist: corrections }) }) : Promise.resolve({ data: [] }),
    );
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-resubmit")).toBeTruthy());

    expect(getByTestId("sticky-resubmit").props.accessibilityState.disabled).toBe(true);
    expect(getByText("rooms.work.actions.completeCorrections")).toBeTruthy();

    fireEvent.press(getByTestId("checklist-item-id:c2"));
    await waitFor(() => expect(getByTestId("sticky-resubmit").props.accessibilityState.disabled).toBe(false));
    expect(getByText("rooms.work.actions.resubmit")).toBeTruthy();
  });

  it("opens the inspection record from the reclean view", async () => {
    mockRooms = [recleanRoom({ status: "IN_PROGRESS" })];
    seedSession([item("c1", "Restock bathroom amenities", true, false, "Corrections")], { cleanType: "FULL" });
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("view-inspection")).toBeTruthy());
    fireEvent.press(getByTestId("view-inspection"));
    expect(getByTestId("room-info-sheet")).toBeTruthy();
    expect(getByText("rooms.work.roomInfo.sections.inspection")).toBeTruthy();
    expect(getByText("Needs another pass")).toBeTruthy();
  });
});

/* ─── Report / More ────────────────────────────────────────────────────────── */

describe("Room Detail — Report / More keeps every reporting path reachable", () => {
  it("opens one sheet with note, work order, lost & found and supplies", async () => {
    mockRooms = [vacantDeparture()];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));

    expect(getByTestId("report-more-sheet")).toBeTruthy();
    for (const id of ["more-note", "more-issue", "more-found", "more-supplies"]) expect(getByTestId(id)).toBeTruthy();
  });

  it("is also available from the header", async () => {
    mockRooms = [vacantDeparture()];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("room-detail-more")).toBeTruthy());
    fireEvent.press(getByTestId("room-detail-more"));
    expect(getByTestId("report-more-sheet")).toBeTruthy();
  });

  it.each([
    ["more-issue", "issue-modal"],
    ["more-found", "found-modal"],
    ["more-supplies", "supply-modal"],
  ])("%s hands off to the existing %s", async (rowId, modalId) => {
    jest.useFakeTimers();
    mockRooms = [vacantDeparture()];
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));
    fireEvent.press(getByTestId(rowId));
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(getByTestId(modalId)).toBeTruthy();
    expect(queryByTestId("report-more-sheet")).toBeNull();
  });

  it("saves a note through the notes endpoint", async () => {
    mockRooms = [vacantDeparture()];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));
    fireEvent.press(getByTestId("more-note"));
    fireEvent.changeText(getByTestId("more-note-input"), "Extra towels requested");
    fireEvent.press(getByTestId("more-note-save"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "Extra towels requested" }));
    await waitFor(() => expect(getByTestId("report-saved")).toBeTruthy());
  });

  it("posts a quick-blocker note and never offers a local-only 'remove' that the server wouldn't honor", async () => {
    mockRooms = [stayover({ latest_note: null, latest_note_at: null })];
    const { getByTestId, queryByText } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));
    fireEvent.press(getByTestId("more-blocker-guest_inside"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "BLOCKER: Guest inside" }));
    expect(queryByText("rooms.detail.removeNote")).toBeNull();
  });

  it("records a come-back-later attempt on the server with a hotel-local retry instant, then writes the audit note", async () => {
    mockRooms = [stayover({ latest_note: null, latest_note_at: null })];
    mockApiPost.mockImplementation((path: string) =>
      path.endsWith("/service-attempts")
        ? Promise.resolve({ data: {}, replayed: false, room: { dnd_flag: false, dnd_attempt_count: 1, dnd_last_attempt_at: "x", dnd_retry_at: "y" } })
        : Promise.resolve({ data: {} }),
    );
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));
    fireEvent.press(getByTestId("more-blocker-come_back_later"));
    fireEvent.changeText(getByTestId("more-time-input"), "11:59 PM");
    fireEvent.press(getByTestId("more-time-submit"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "BLOCKER: Come back later — 11:59 PM" }));
    const attempt = mockApiPost.mock.calls.find(([path]) => path === "/rooms/room-1/service-attempts");
    expect(attempt?.[1]).toMatchObject({ result: "return_later" });
    // 11:59 PM hotel time (America/Chicago) is an absolute instant, not the device's 11:59 PM.
    const retry = new Date(attempt?.[1].return_at as string);
    const hotelClock = retry.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: false });
    expect(hotelClock.replace(/ /g, " ")).toMatch(/^(23:59|11:59)/);
    expect(mockSetMyRooms).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "room-1", dnd_attempt_count: 1 })]));
  });

  it("does not write a come-back-later note when the time is not a usable time", async () => {
    mockRooms = [stayover({ latest_note: null, latest_note_at: null })];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));
    fireEvent.press(getByTestId("more-blocker-come_back_later"));
    fireEvent.changeText(getByTestId("more-time-input"), "soonish");
    fireEvent.press(getByTestId("more-time-submit"));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("rooms.dash.detail.restriction.timeInvalid"));
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/service-attempts")).toBe(false);
    expect(mockApiPost.mock.calls.some(([path]) => path === "/rooms/room-1/notes")).toBe(false);
  });

  it("refuses to report offline instead of faking it", async () => {
    mockIsOnline = false;
    mockRooms = [stayover({ latest_note: null })];
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("sticky-more")).toBeTruthy());
    fireEvent.press(getByTestId("sticky-more"));
    fireEvent.press(getByTestId("more-blocker-guest_inside"));

    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith("rooms.detail.alerts.blockersNeedConnection"));
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

/* ─── Accessibility contracts ──────────────────────────────────────────────── */

describe("Room Detail — accessibility", () => {
  it("names the room, exposes the timer and progress bar, and explains disabled actions in text", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true), item("b", "Empty trash", false)]);
    const { getByLabelText, getByTestId, UNSAFE_getByProps } = renderScreen();

    await waitFor(() => expect(getByTestId("cleaning-timer")).toBeTruthy());
    expect(getByLabelText("rooms.work.roomA11y")).toBeTruthy();
    expect(UNSAFE_getByProps({ accessibilityRole: "progressbar" })).toBeTruthy();
    expect(UNSAFE_getByProps({ accessibilityRole: "timer" })).toBeTruthy();
    expect(getByTestId("sticky-complete").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("sticky-disabled-reason").props.accessibilityLiveRegion).toBe("polite");
  });

  it("gives every checklist row a checkbox role with its state, and a section header its expanded state", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, true, "Bedroom"), item("b", "Clean bathroom", true, false, "Bathroom")]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("checklist-item-id:b")).toBeTruthy());
    expect(getByTestId("checklist-toggle-Bedroom").props.accessibilityRole).toBe("button");
    expect(typeof getByTestId("checklist-toggle-Bedroom").props.accessibilityState.expanded).toBe("boolean");
    expect(getByTestId("checklist-item-id:b").props.accessibilityState).toMatchObject({ checked: false, disabled: false });
  });

  it("locks the checklist rows while the completion is waiting for the server", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL" })];
    seedSession([item("a", "Change linens", true, true)], { completeRequestedAt: "2026-10-08T10:00:00Z" });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("checklist-item-id:a")).toBeTruthy());
    expect(getByTestId("checklist-item-id:a").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("checklist-item-id:a"));
    expect(mockApiPatch).not.toHaveBeenCalled();
  });
});
