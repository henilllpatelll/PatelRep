import React from "react";
import { FlatList } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockRouterPush = jest.fn();
const mockSetMyRooms = jest.fn();
const mockT = (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key);
let mockLanguage = "en";

const mockHydrate = jest.fn().mockResolvedValue(undefined);
const mockRestoreActive = jest.fn().mockResolvedValue("none");
let mockSessionState: { scope: string | null; sessions: Record<string, unknown> } = {
  scope: "hotel-1:user-1",
  sessions: {},
};

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "101",
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: "2026-10-08T12:00:00.000Z",
    clean_type: "DEP",
    clean_type_label: "Departure",
    assignment_date: "2026-10-08",
    room_type_code: "KS",
    room_type_name: "King Suite",
    rooms: { room_types: { name: "King Suite", code: "KS" } },
    ...overrides,
  };
}

let mockRooms: Room[] = [];

const mockStore: {
  isOnline: boolean;
  myRooms: Room[];
  setMyRooms: jest.Mock;
  user: { id: string; tenant_id: string } | null;
  pendingActions: unknown[];
  hotelTimezone: string | null;
  setHotelTimezone: jest.Mock;
} = {
  isOnline: true,
  myRooms: mockRooms,
  setMyRooms: mockSetMyRooms,
  user: { id: "user-1", tenant_id: "hotel-1" },
  pendingActions: [],
  hotelTimezone: "America/Chicago",
  setHotelTimezone: jest.fn(),
};

jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockRouterPush(...args) } }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: mockLanguage, resolvedLanguage: mockLanguage } }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/offline/db", () => ({
  getRoomsByDate: jest.fn().mockResolvedValue([]),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/utils/date", () => ({ localDate: () => "2026-10-08" }));
jest.mock("@/stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector?: (state: typeof mockStore) => unknown) => (selector ? selector(mockStore) : mockStore),
    { getState: () => mockStore },
  ),
}));
jest.mock("@/stores/cleanSessionStore", () => ({
  useCleanSessionStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockSessionState),
    { getState: () => ({ hydrate: mockHydrate, restoreActive: mockRestoreActive }) },
  ),
}));

import { api } from "@/lib/api/client";
import { getRoomsByDate } from "@/lib/offline/db";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { setLastTab } from "@/lib/housekeeping/myRoomsDashboard";
import MyRoomsScreen from "@/app/(app)/my-rooms";

const mockApiGet = api.get as jest.Mock;
const mockGetCached = getRoomsByDate as jest.Mock;

function renderScreen() {
  return render(
    <ThemeProvider>
      <MyRoomsScreen />
    </ThemeProvider>,
  );
}

function liveSession(roomId: string) {
  return {
    roomId,
    sessionId: `s-${roomId}`,
    cleanType: "DEP",
    startedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    entryAcknowledged: true,
    checklist: [
      { item_id: "a", section: "Bed", label: "Strip", is_required: true, checked: true, checked_at: null },
      { item_id: "b", section: "Bed", label: "Make", is_required: true, checked: true, checked_at: null },
      { item_id: "c", section: "Bath", label: "Scrub", is_required: true, checked: false, checked_at: null },
    ],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

const META = { timezone: "America/Chicago", shift_date: "2026-10-08" };

function setRooms(rooms: Room[]) {
  mockRooms = rooms;
  mockStore.myRooms = rooms;
  mockApiGet.mockResolvedValue({ data: rooms, meta: META });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockStore.isOnline = true;
  mockStore.pendingActions = [];
  mockStore.user = { id: "user-1", tenant_id: "hotel-1" };
  mockStore.hotelTimezone = "America/Chicago";
  mockSessionState = { scope: "hotel-1:user-1", sessions: {} };
  mockGetCached.mockResolvedValue([]);
  mockRestoreActive.mockResolvedValue("none");
  setLastTab("route");
  setRooms([
    makeRoom({ id: "r101", room_number: "101", sequence_order: 2 }),
    makeRoom({ id: "r102", room_number: "102", status: "IN_PROGRESS" }),
    makeRoom({ id: "r103", room_number: "103", dnd_flag: true, dnd_retry_at: "2026-10-08T18:30:00.000Z", dnd_attempt_count: 1 }),
    makeRoom({ id: "r104", room_number: "104", status: "CLEAN" }),
    makeRoom({ id: "r105", room_number: "105", status: "INSPECTED" }),
    makeRoom({ id: "r106", room_number: "106", status: "OUT_OF_SERVICE" }),
    makeRoom({ id: "r107", room_number: "107", sequence_order: 1, priority: 1, priority_needed_by: "2026-10-08T19:00:00.000Z" }),
  ]);
  mockSessionState.sessions = { r102: liveSession("r102") };
});

describe("My Rooms dashboard", () => {
  it("opens on Route with the pinned current room, ordered Up Next and Needs Attention", async () => {
    const { hotelDateKey } = jest.requireActual("@/lib/housekeeping/hotelTime");
    const { getByTestId, getByText, queryByTestId } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith(`/housekeeping/my-rooms?date=${hotelDateKey(new Date(), "America/Chicago")}`));

    expect(getByTestId("my-rooms-tab-route").props.accessibilityState.selected).toBe(true);
    expect(getByText("rooms.dash.route.currentTitle")).toBeTruthy();
    expect(getByText("rooms.dash.route.upNextTitle")).toBeTruthy();
    expect(getByText("rooms.dash.route.attentionTitle")).toBeTruthy();
    expect(getByTestId("current-room-102")).toBeTruthy();
    expect(getByTestId("room-card-107")).toBeTruthy();
    expect(getByTestId("room-card-103")).toBeTruthy();
    // The current room is not duplicated as a queue card, and DND is not in Up Next's work.
    expect(queryByTestId("room-card-102")).toBeNull();
    expect(getByText(/rooms\.dash\.current\.title .*"room":"102"/)).toBeTruthy();
    expect(getByText(/rooms\.dash\.current\.checklist .*"done":2,"total":3/)).toBeTruthy();
    expect(getByText(/rooms\.dash\.current\.elapsed .*"minutes":18/)).toBeTruthy();
  });

  it("shows supervisor order in Up Next (sequence 1 before sequence 2) with stop numbers", async () => {
    const { getAllByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    const order = getAllByTestId(/^room-card-/).map((node) => node.props.testID);
    expect(order.indexOf("room-card-107")).toBeLessThan(order.indexOf("room-card-101"));
    expect(order.indexOf("room-card-101")).toBeLessThan(order.indexOf("room-card-103")); // attention last
  });

  it("summarises progress with the shared counts (unavailable excluded from the total)", async () => {
    const { getByLabelText, getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    // 7 assigned − 1 out of service = 6 serviceable; CLEAN + INSPECTED = 2 completed.
    expect(getByText(/rooms\.dash\.progressOf .*"completed":2,"total":6/)).toBeTruthy();
    expect(getByLabelText(/rooms\.dash\.progressA11y .*"percent":33/)).toBeTruthy();
    expect(getByLabelText(/rooms\.dash\.chips\.attention 1/)).toBeTruthy();
    expect(getByLabelText(/rooms\.dash\.chips\.unavailable 1/)).toBeTruthy();
  });

  it("formats the shift date from the server's assignment date in the active language", async () => {
    mockLanguage = "es";
    const expected = new Date(2026, 9, 8, 12).toLocaleDateString("es-US", { weekday: "long", month: "long", day: "numeric" });
    const { getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(getByText(expected)).toBeTruthy();
  });

  it("opens the right room from the current card, a queue card, a floor row and a done row", async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());

    fireEvent.press(getByTestId("current-room-102"));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/(app)/my-rooms/r102");
    fireEvent.press(getByTestId("room-card-107"));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/(app)/my-rooms/r107");

    fireEvent.press(getByTestId("my-rooms-tab-floors"));
    fireEvent.press(getByTestId("room-row-101"));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/(app)/my-rooms/r101");

    fireEvent.press(getByTestId("my-rooms-tab-done"));
    fireEvent.press(getByTestId("room-row-104"));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/(app)/my-rooms/r104");
  });

  it("Done separates awaiting inspection, ready and unavailable — and leaves in-progress/attention out", async () => {
    const { getByTestId, getByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    fireEvent.press(getByTestId("my-rooms-tab-done"));

    expect(getByText("rooms.dash.done.awaitingTitle")).toBeTruthy();
    expect(getByText("rooms.dash.done.readyTitle")).toBeTruthy();
    expect(getByText("rooms.dash.done.unavailableTitle")).toBeTruthy();
    expect(getByTestId("room-row-104")).toBeTruthy();
    expect(getByTestId("room-row-105")).toBeTruthy();
    expect(getByTestId("room-row-106")).toBeTruthy();
    expect(queryByTestId("room-row-102")).toBeNull();
    expect(queryByTestId("room-row-103")).toBeNull();
  });

  it("Floors groups by floor (no building data) and searches by room number", async () => {
    setRooms([
      makeRoom({ id: "a", room_number: "101", floor: 1 }),
      makeRoom({ id: "b", room_number: "102", floor: 1, status: "CLEAN" }),
      makeRoom({ id: "c", room_number: "201", floor: 2 }),
      makeRoom({ id: "d", room_number: "202", floor: 2 }),
    ]);
    const { getByTestId, getByText, queryByTestId, queryByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    fireEvent.press(getByTestId("my-rooms-tab-floors"));

    expect(queryByText("rooms.dash.floors.noBuilding")).toBeNull();
    expect(getByText(/rooms\.sections\.floor .*"floor":1/)).toBeTruthy();
    expect(getByText(/rooms\.dash\.floors\.count .*"completed":1,"total":2/)).toBeTruthy();

    fireEvent.changeText(getByTestId("my-rooms-search"), "202");
    expect(getByTestId("room-row-202")).toBeTruthy();
    expect(queryByTestId("room-row-101")).toBeNull();
    expect(queryByTestId("room-row-201")).toBeNull();

    fireEvent.changeText(getByTestId("my-rooms-search"), "999");
    expect(getByText(/rooms\.dash\.floors\.noMatches .*"query":"999"/)).toBeTruthy();
  });

  it("Floors shows real building names when the API provides them", async () => {
    setRooms([
      makeRoom({ id: "a", room_number: "101", floor: 1, building: "East Wing" }),
      makeRoom({ id: "b", room_number: "301", floor: 3, building: "Tower" }),
    ]);
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    fireEvent.press(getByTestId("my-rooms-tab-floors"));
    expect(getByText("East Wing")).toBeTruthy();
    expect(getByText("Tower")).toBeTruthy();
  });

  it("collapses and expands a floor", async () => {
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    fireEvent.press(getByTestId("my-rooms-tab-floors"));
    expect(getByTestId("room-row-101")).toBeTruthy();
    fireEvent.press(getByTestId("floor-\u0000none|1"));
    expect(queryByTestId("room-row-101")).toBeNull();
    fireEvent.press(getByTestId("floor-\u0000none|1"));
    expect(getByTestId("room-row-101")).toBeTruthy();
  });

  it("remembers the selected tab for the session", async () => {
    const first = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    fireEvent.press(first.getByTestId("my-rooms-tab-done"));
    first.unmount();

    const second = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    expect(second.getByTestId("my-rooms-tab-done").props.accessibilityState.selected).toBe(true);
  });

  it("gives queue cards a screen-reader label with rush, type and access state", async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    const label: string = getByTestId("room-card-107").props.accessibilityLabel;
    expect(label).toContain("rooms.dash.card.rushA11y");
    expect(label).toContain("rooms.dash.card.open");
    expect(label).toContain("rooms.dash.access.checkoutVerified");
    expect(getByTestId("room-card-107").props.accessibilityRole).toBe("button");
  });
});

describe("current room recovery", () => {
  it("shows a recovery card — not a fake session — when the list says in progress but no session exists", async () => {
    mockSessionState = { scope: "hotel-1:user-1", sessions: {} };
    const { getByTestId, queryByTestId, getByLabelText } = renderScreen();
    await waitFor(() => expect(mockRestoreActive).toHaveBeenCalled());

    expect(getByTestId("current-recovery-102")).toBeTruthy();
    expect(queryByTestId("current-room-102")).toBeNull();

    mockRestoreActive.mockClear();
    await act(async () => {
      fireEvent.press(getByLabelText("rooms.dash.current.recoveryRetry"));
    });
    expect(mockRestoreActive).toHaveBeenCalledTimes(1);
  });

  it("does not look for a session when nothing is in progress", async () => {
    setRooms([makeRoom({ id: "a", room_number: "101" })]);
    renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(mockRestoreActive).not.toHaveBeenCalled();
  });

  it("ignores session records that belong to another signed-in user", async () => {
    mockSessionState = { scope: "hotel-1:someone-else", sessions: { r102: liveSession("r102") } };
    const { queryByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(queryByTestId("current-room-102")).toBeNull();
    expect(queryByTestId("current-recovery-102")).toBeTruthy();
  });

  it("restores the current room from a persisted offline-start session whose list status is stale", async () => {
    setRooms([makeRoom({ id: "a", room_number: "101", status: "DIRTY" })]);
    mockSessionState = { scope: "hotel-1:user-1", sessions: { a: { ...liveSession("a"), startConfirmed: false } } };
    const { getByTestId, queryByTestId, getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(getByTestId("current-room-101")).toBeTruthy();
    expect(queryByTestId("room-card-101")).toBeNull();
    expect(getByText("rooms.dash.current.starting")).toBeTruthy();
    expect(getByText(/rooms\.dash\.sync\.pending .*"count":1/)).toBeTruthy();
  });
});

describe("data states", () => {
  it("shows an error with retry — not an empty success — when the first fetch fails", async () => {
    setRooms([]);
    mockApiGet.mockRejectedValue(new Error("Network request failed"));
    const { findByText, queryByText, getByText } = renderScreen();

    expect(await findByText(/rooms\.dash\.state\.errorTitle/)).toBeTruthy();
    expect(queryByText("rooms.noRooms")).toBeNull();
    expect(queryByText("rooms.dash.route.emptyTitle")).toBeNull();

    mockApiGet.mockResolvedValue({ data: [], meta: META });
    mockApiGet.mockClear();
    fireEvent.press(getByText("rooms.dash.state.retry"));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));
  });

  it("shows 'no rooms assigned' only after a successful empty response", async () => {
    setRooms([]);
    const { findByText } = renderScreen();
    expect(await findByText("rooms.noRooms")).toBeTruthy();
  });

  it("falls back to the cache on a failed fetch and says the data may be stale", async () => {
    mockStore.myRooms = [];
    mockApiGet.mockRejectedValue(new Error("boom"));
    mockGetCached.mockResolvedValue([makeRoom({ id: "cached", room_number: "301" })]);
    renderScreen();
    await waitFor(() => expect(mockSetMyRooms).toHaveBeenCalledWith([expect.objectContaining({ id: "cached" })]));
  });

  it("keeps showing rooms and flags the failed refresh when a poll fails", async () => {
    mockApiGet.mockRejectedValue(new Error("boom"));
    const { findByText, getByTestId } = renderScreen();
    expect(await findByText("rooms.dash.sync.refreshFailed")).toBeTruthy();
    expect(getByTestId("room-card-107")).toBeTruthy();
  });

  it("works offline from saved rooms without calling the API", async () => {
    mockStore.isOnline = false;
    const { findByText, getByTestId } = renderScreen();
    expect(await findByText("common.offline")).toBeTruthy();
    expect(getByTestId("room-card-107")).toBeTruthy();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("does not claim 'no rooms assigned' when offline with nothing saved", async () => {
    mockStore.isOnline = false;
    setRooms([]);
    mockApiGet.mockClear();
    const { findByText, queryByText } = renderScreen();
    expect(await findByText("rooms.dash.state.offlineEmpty")).toBeTruthy();
    expect(queryByText("rooms.noRooms")).toBeNull();
  });

  it("surfaces pending synchronization from queued actions", async () => {
    mockStore.pendingActions = [{ id: "1" }, { id: "2" }];
    const { findByText } = renderScreen();
    expect(await findByText(/rooms\.dash\.sync\.pending .*"count":2/)).toBeTruthy();
  });

  it("reloads on pull-to-refresh", async () => {
    const { UNSAFE_getByType } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));
    const list = UNSAFE_getByType(FlatList);
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it("tells the attendant when everything is done", async () => {
    setRooms([makeRoom({ id: "a", room_number: "101", status: "CLEAN" }), makeRoom({ id: "b", room_number: "102", status: "OOO" })]);
    const { findByText } = renderScreen();
    expect(await findByText("rooms.dash.route.emptyTitle")).toBeTruthy();
  });
});

describe("large assignment lists", () => {
  it("renders a long assignment through the virtualized list without losing counts", async () => {
    const many: Room[] = [];
    for (let floor = 1; floor <= 12; floor += 1) {
      for (let n = 1; n <= 25; n += 1) {
        many.push(makeRoom({ id: `r${floor}-${n}`, room_number: `${floor}${String(n).padStart(2, "0")}`, floor, status: n % 5 === 0 ? "CLEAN" : "DIRTY" }));
      }
    }
    setRooms(many);
    const { findByText } = renderScreen();
    expect(await findByText(/rooms\.dash\.progressOf .*"completed":60,"total":300/)).toBeTruthy();
  });
});


describe("Phase 3 on the dashboard", () => {
  const plain = (text: string) => text.replace(/\u202f/g, " ");
  const stay = { clean_type: "LIGHT", clean_type_label: "Light", status: "PICKUP" as const, fo_status: "OCC" as const, actual_checkout_at: null };

  function textOf(node: { props: { children?: unknown } }): string {
    return plain([node.props.children].flat().join(""));
  }

  it("shows Rush with the deadline in hotel time and the reason, only for a real priority", async () => {
    setRooms([
      makeRoom({ id: "rush", room_number: "224", priority: 1, priority_reason: "vip", priority_needed_by: "2099-01-01T18:00:00.000Z" }),
      makeRoom({ id: "plain", room_number: "226", priority: 5 }),
    ]);
    const { getByTestId, getByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());

    expect(getByTestId("room-card-224")).toBeTruthy();
    expect(getByText("rooms.dash.card.rush")).toBeTruthy();
    expect(plain(getByText(/card\.neededBy/).props.children as string)).toContain('"time":"12:00 PM"');
    expect(getByText(/rush\.reasons\.vip/)).toBeTruthy();
    // The ordinary room has no rush marker of its own.
    expect(queryByTestId("room-card-226")).toBeTruthy();
  });

  it("flags a passed deadline as overdue", async () => {
    setRooms([makeRoom({ id: "late", room_number: "224", priority: 1, priority_needed_by: "2026-01-01T18:00:00.000Z" })]);
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(plain(getByText(/rush\.overdue/).props.children as string)).toContain('"time":"12:00 PM"');
    expect(queryByText(/card\.neededBy/)).toBeNull();
  });

  it("a revoked priority drops the Rush marker on the next refresh", async () => {
    setRooms([makeRoom({ id: "r", room_number: "224", priority: 1 })]);
    const { getByText, queryByText, UNSAFE_getByType } = renderScreen();
    await waitFor(() => expect(getByText("rooms.dash.card.rush")).toBeTruthy());

    mockStore.myRooms = [makeRoom({ id: "r", room_number: "224", priority: 5 })];
    mockApiGet.mockResolvedValue({ data: mockStore.myRooms, meta: META });
    await act(async () => {
      await UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(queryByText("rooms.dash.card.rush")).toBeNull());
  });

  it("Rush never lifts a DND room out of Needs Attention; the Rush stays visible as secondary", async () => {
    setRooms([
      makeRoom({ id: "dnd", room_number: "314", ...stay, dnd_flag: true, priority: 1, priority_needed_by: "2099-01-01T18:00:00.000Z" }),
      makeRoom({ id: "ok", room_number: "316" }),
    ]);
    const { getAllByTestId, getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());

    const order = getAllByTestId(/^room-card-/).map((node) => node.props.testID);
    expect(order).toEqual(["room-card-316", "room-card-314"]); // workable first, restricted room under Needs Attention
    expect(getByText("rooms.dash.attention.dnd.title")).toBeTruthy();
    expect(getByText("rooms.dash.card.rush")).toBeTruthy();
    expect(getByTestId("room-card-314").props.accessibilityLabel).toContain("rooms.dash.attention.dnd.title");
  });

  it("shows the persisted DND attempt history and retry on the card", async () => {
    setRooms([
      makeRoom({
        id: "dnd",
        room_number: "314",
        ...stay,
        dnd_flag: true,
        dnd_attempt_count: 2,
        dnd_last_attempt_at: "2026-10-08T16:25:00.000Z",
        dnd_retry_at: "2026-10-08T18:30:00.000Z",
      }),
    ]);
    const { getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(plain(getByText(/attention\.lastAttempt/).props.children as string)).toContain('"time":"11:25 AM"');
    expect(getByText(/attention\.attempts/).props.children).toContain('"count":2');
    expect(plain(getByText(/attention\.retryAt/).props.children as string)).toContain('"time":"1:30 PM"');
  });

  it("keeps Do Not Service and Service Declined apart from DND", async () => {
    setRooms([
      makeRoom({ id: "a", room_number: "301", ...stay, do_not_service: true }),
      makeRoom({ id: "b", room_number: "302", ...stay, do_not_service: true, service_declined_reason: "privacy_request" }),
      makeRoom({ id: "c", room_number: "303", ...stay, dnd_flag: true }),
    ]);
    const { getAllByText, getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(getByText("rooms.dash.attention.do_not_service.title")).toBeTruthy();
    expect(getByText("rooms.dash.attention.service_declined.title")).toBeTruthy();
    expect(getAllByText("rooms.dash.attention.dnd.title")).toHaveLength(1);
  });

  it("a reclean that is safe to enter is actionable in Up Next with its corrections discoverable", async () => {
    setRooms([
      makeRoom({
        id: "rc",
        room_number: "319",
        status: "DIRTY",
        clean_type: "FULL",
        clean_type_label: "Full",
        reclean_requested_at: "2026-10-08T15:00:00.000Z",
        reclean_corrections: ["Restock", "Mirror"],
      }),
      makeRoom({ id: "n", room_number: "320", sequence_order: undefined }),
    ]);
    const { getByTestId, getByText, queryByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(getByTestId("room-card-319").props.accessibilityLabel).toContain("rooms.dash.card.recleanCorrections");
    expect(getByText("rooms.dash.attention.reclean.title")).toBeTruthy();
    expect(getByText(/card\.recleanCorrections/).props.children).toContain('"count":2');
    expect(getByText("rooms.dash.detail.reclean.start")).toBeTruthy();
    expect(queryByText("rooms.dash.route.attentionTitle")).toBeNull();
  });

  it("a failed inspection leaves Done and counts as remaining work; a resubmitted reclean waits in Awaiting inspection", async () => {
    setRooms([
      makeRoom({ id: "failed", room_number: "401", status: "DIRTY", reclean_requested_at: "2026-10-08T15:00:00.000Z", reclean_corrections: ["Mirror"] }),
      makeRoom({ id: "resub", room_number: "402", status: "CLEAN", reclean_requested_at: "2026-10-08T15:00:00.000Z" }),
      makeRoom({ id: "pass", room_number: "403", status: "INSPECTED" }),
    ]);
    const { getByTestId, queryByTestId, getByText } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    // INSPECTED and the resubmitted (CLEAN) reclean are completed; the failed-inspection room is remaining work.
    expect(getByText(/rooms\.dash\.progressOf .*"completed":2,"total":3/)).toBeTruthy();
    fireEvent.press(getByTestId("my-rooms-tab-done"));
    expect(queryByTestId("room-row-401")).toBeNull();
    expect(getByTestId("room-row-402")).toBeTruthy();
    expect(getByTestId("room-row-403")).toBeTruthy();
  });

  it("Floors shows one dominant state per row", async () => {
    setRooms([
      makeRoom({ id: "a", room_number: "218", status: "IN_PROGRESS" }),
      makeRoom({ id: "b", room_number: "224", priority: 1 }),
      makeRoom({ id: "c", room_number: "226" }),
      makeRoom({ id: "d", room_number: "314", ...stay, dnd_flag: true }),
      makeRoom({ id: "e", room_number: "319", status: "DIRTY", reclean_requested_at: "2026-10-08T15:00:00.000Z", reclean_corrections: ["Mirror"] }),
      makeRoom({ id: "f", room_number: "309", status: "OUT_OF_SERVICE" }),
      makeRoom({ id: "g", room_number: "330", ...stay, dnd_retry_at: "2099-01-01T18:30:00.000Z", dnd_attempt_count: 1 }),
    ]);
    mockSessionState = { scope: "hotel-1:user-1", sessions: {} };
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    fireEvent.press(getByTestId("my-rooms-tab-floors"));
    const label = (room: string) => getByTestId(`room-row-${room}`).props.accessibilityLabel as string;
    expect(label("224")).toContain("rooms.dash.card.rushA11y");
    expect(label("314")).toContain("rooms.dash.attention.dnd.title");
    expect(label("309")).toContain("rooms.card.status.OUT_OF_SERVICE");
    expect(label("319")).toContain("rooms.dash.card.recleanCorrections");
  });

  it("requests the hotel's calendar day, stores the timezone from the response, and prunes the cache to that date", async () => {
    const { hotelDateKey } = jest.requireActual("@/lib/housekeeping/hotelTime");
    mockStore.hotelTimezone = "Pacific/Auckland";
    setRooms([makeRoom({ id: "a", room_number: "101" })]);
    mockApiGet.mockResolvedValue({ data: mockRooms, meta: { timezone: "America/New_York", shift_date: "2026-10-08" } });
    renderScreen();
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    expect(mockApiGet).toHaveBeenCalledWith(`/housekeeping/my-rooms?date=${hotelDateKey(new Date(), "Pacific/Auckland")}`);
    await waitFor(() => expect(mockStore.setHotelTimezone).toHaveBeenCalledWith("America/New_York"));
    const { upsertRooms } = jest.requireMock("@/lib/offline/db");
    await waitFor(() => expect(upsertRooms).toHaveBeenCalledWith(expect.any(Array), { replaceDate: "2026-10-08" }));
  });

  it("does not claim a restricted room is workable when a refresh clears DND (authoritative refresh wins)", async () => {
    setRooms([makeRoom({ id: "d", room_number: "314", ...stay, dnd_flag: true })]);
    const { getByTestId, queryByText, UNSAFE_getByType } = renderScreen();
    await waitFor(() => expect(queryByText("rooms.dash.route.attentionTitle")).toBeTruthy());

    mockStore.myRooms = [makeRoom({ id: "d", room_number: "314", ...stay, dnd_flag: false })];
    mockApiGet.mockResolvedValue({ data: mockStore.myRooms, meta: META });
    await act(async () => {
      await UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(queryByText("rooms.dash.route.attentionTitle")).toBeNull());
    expect(getByTestId("room-card-314")).toBeTruthy();
  });
});
