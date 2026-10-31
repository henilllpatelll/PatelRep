import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/engineeringRooms", () => ({ fetchRoomBoard: jest.fn() }));
let mockOnline = true;
let mockHotel = "h1";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", role: "engineer", tenant_id: mockHotel } })),
  };
});

import { router } from "expo-router";
import { fetchRoomBoard } from "@/lib/api/engineeringRooms";
import { EngineeringRoomBoard } from "@/components/engineering/rooms/EngineeringRoomBoard";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetRoomBoardCache } from "@/lib/engineering/useRoomBoard";
import type { RoomBoardPage, RoomBoardRow } from "@/lib/engineering/roomModel";

const fetchBoard = fetchRoomBoard as jest.Mock;
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const room = (n: string, floor: number, over: Partial<RoomBoardRow> = {}): RoomBoardRow => ({
  id: `r-${n}`,
  room_number: n,
  floor,
  building: null,
  room_type: null,
  occupancy: "unknown",
  housekeeping_status: null,
  availability: null,
  unavailability: null,
  active_repair_count: 0,
  others_active_count: 0,
  top_priority: null,
  top_repair: null,
  last_activity_at: null,
  status_updated_at: null,
  ...over,
});

const page = (rows: RoomBoardRow[], over: Partial<RoomBoardPage> = {}): RoomBoardPage => ({
  rows,
  total: rows.length,
  hasMore: false,
  counts: { total: 40, active_repairs: 3, unavailable: 2, occupied: 11 },
  floors: [3, 4],
  buildings: [],
  ...over,
});

const ROOMS = [
  room("312", 3, { occupancy: "occupied", active_repair_count: 1, top_priority: "urgent", top_repair: { id: "wo-1042", work_order_number: "1042", title: "AC not cooling", priority: "urgent", status: "in_progress" } }),
  room("315", 3, { occupancy: "unknown" }),
  room("318", 3, { occupancy: "vacant", availability: "out_of_service", unavailability: { id: "p2", type: "OUT_OF_SERVICE", expected_return_at: "2030-01-01T10:00:00Z", is_past_eta: false } }),
  room("415", 4, { occupancy: "vacant", availability: "out_of_order", unavailability: { id: "p1", type: "OUT_OF_ORDER", expected_return_at: "2020-01-01T10:00:00Z", is_past_eta: true } }),
  room("416", 4, { availability: "unrecorded_down" }),
];

const lastParams = () => fetchBoard.mock.calls.at(-1)?.[0] as Record<string, unknown>;

const renderBoard = () =>
  render(
    <ThemeProvider>
      <EngineeringRoomBoard />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockHotel = "h1";
  resetRoomBoardCache();
  fetchBoard.mockResolvedValue(page(ROOMS));
});

describe("Engineering Rooms board", () => {
  it("lists rooms grouped by floor, with occupancy, availability and repairs as separate facts", async () => {
    const screen = renderBoard();
    expect(await screen.findByTestId("room-card-312")).toBeTruthy();
    expect(screen.getByText("engRooms.floorHeader:floor=3")).toBeTruthy();
    expect(screen.getByText("engRooms.floorHeader:floor=4")).toBeTruthy();

    const occupiedWithRepair = screen.getByTestId("room-card-312");
    expect(occupiedWithRepair).toHaveTextContent(has("engRooms.occupancy.occupied"));
    expect(occupiedWithRepair).toHaveTextContent(has("AC not cooling"));
    expect(occupiedWithRepair).toHaveTextContent(has("WO-1042"));
    expect(occupiedWithRepair).not.toHaveTextContent(has("engRooms.availability"));

    expect(screen.getByTestId("room-card-318")).toHaveTextContent(has("engRooms.availability.out_of_service"));
    expect(screen.getByTestId("room-card-415")).toHaveTextContent(has("engRooms.availability.out_of_order"));
    expect(screen.getByTestId("room-card-415")).toHaveTextContent(has("engRooms.returnOverdue"));
    expect(screen.getByTestId("room-card-416")).toHaveTextContent(has("engRooms.availability.unrecorded_down"));
  });

  it("shows missing occupancy as unknown, never as vacant, and never calls any room available for sale", async () => {
    const screen = renderBoard();
    const unknown = await screen.findByTestId("room-card-315");
    expect(unknown).toHaveTextContent(has("engRooms.occupancy.unknown"));
    expect(unknown).not.toHaveTextContent(has("engRooms.occupancy.vacant"));
    expect(unknown).toHaveTextContent(has("engRooms.noActiveRepair"));
    expect(screen.queryByText(/sell|sellable|available for sale/i)).toBeNull();
  });

  it("opens Room Detail for the tapped room, and the report form from the header", async () => {
    const screen = renderBoard();
    fireEvent.press(await screen.findByTestId("room-card-312"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/room-status/[roomId]", params: { roomId: "r-312" } });
    fireEvent.press(screen.getByTestId("room-report-issue"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/work-orders/new");
  });

  it("searches the server (the whole hotel), not just the rooms already loaded", async () => {
    const screen = renderBoard();
    await screen.findByTestId("room-card-312");
    fireEvent.changeText(screen.getByTestId("room-search"), " 1312 ");
    await waitFor(() => expect(lastParams()).toMatchObject({ q: "1312" }), { timeout: 6000 });
    fetchBoard.mockClear();
    fireEvent.press(screen.getByTestId("room-search-clear"));
    await waitFor(() => expect(lastParams().q).toBeUndefined(), { timeout: 6000 });
  });

  it("the quick chips show whole-hotel counts and apply real server filters", async () => {
    const screen = renderBoard();
    await screen.findByTestId("room-card-312");
    expect(screen.getByTestId("room-quick-active")).toHaveProp("accessibilityLabel", "engRooms.quick.active, 3");
    expect(screen.getByTestId("room-quick-unavailable")).toHaveProp("accessibilityLabel", "engRooms.quick.unavailable, 2");
    expect(screen.getByTestId("room-quick-occupied")).toHaveProp("accessibilityLabel", "engRooms.quick.occupied, 11");

    fireEvent.press(screen.getByTestId("room-quick-active"));
    await waitFor(() => expect(lastParams()).toMatchObject({ maintenance: "active" }));
    fireEvent.press(screen.getByTestId("room-quick-unavailable"));
    await waitFor(() => expect(lastParams()).toMatchObject({ maintenance: "unavailable" }));
    expect(lastParams().occupancy).toBeUndefined();
    fireEvent.press(screen.getByTestId("room-quick-occupied"));
    await waitFor(() => expect(lastParams()).toMatchObject({ occupancy: "occupied" }));
    expect(lastParams().maintenance).toBeUndefined();
    fireEvent.press(screen.getByTestId("room-quick-all"));
    await waitFor(() => expect(lastParams().occupancy).toBeUndefined());
  });

  it("combines sheet filters (OOS + floor + priority + unknown occupancy + sort) into one request and shows how many are on", async () => {
    const screen = renderBoard();
    await screen.findByTestId("room-card-312");
    fireEvent.press(screen.getByTestId("room-filter-open"));
    fireEvent.press(await screen.findByTestId("room-filter-maintenance-oos"));
    fireEvent.press(screen.getByTestId("room-filter-occupancy-unknown"));
    fireEvent.press(screen.getByTestId("room-filter-floor-3"));
    fireEvent.press(screen.getByTestId("room-filter-priority-urgent"));
    fireEvent.press(screen.getByTestId("room-filter-sort-urgency"));
    fireEvent.press(screen.getByTestId("room-filter-apply"));
    await waitFor(() => expect(lastParams()).toMatchObject({ maintenance: "oos", occupancy: "unknown", floor: 3, priority: "urgent", sort_by: "urgency" }));
    expect(screen.getByTestId("room-filter-open")).toHaveProp("accessibilityLabel", "engRooms.filter.openActive:count=4");
  });

  it("Reset clears the draft in the sheet and Show rooms applies it", async () => {
    const screen = renderBoard();
    await screen.findByTestId("room-card-312");
    fireEvent.press(screen.getByTestId("room-quick-active"));
    await waitFor(() => expect(lastParams()).toMatchObject({ maintenance: "active" }));
    fireEvent.press(screen.getByTestId("room-filter-open"));
    fireEvent.press(await screen.findByTestId("room-filter-reset"));
    fireEvent.press(screen.getByTestId("room-filter-apply"));
    await waitFor(() => expect(lastParams().maintenance).toBeUndefined());
  });

  it("offers the building filter only when the hotel has more than one building", async () => {
    fetchBoard.mockResolvedValue(page(ROOMS, { buildings: ["A", "B"] }));
    const screen = renderBoard();
    await screen.findByTestId("room-card-312");
    fireEvent.press(screen.getByTestId("room-filter-open"));
    expect(await screen.findByTestId("room-filter-building-B")).toBeTruthy();
  });

  it("loads the next page when the list reaches its end, without repeating a room", async () => {
    fetchBoard.mockImplementation(async (_p: unknown, pageNo: number) =>
      pageNo === 1 ? page([room("101", 1), room("102", 1)], { hasMore: true, total: 3 }) : page([room("102", 1), room("103", 1)], { hasMore: false, total: 3 }),
    );
    const screen = renderBoard();
    await screen.findByTestId("room-card-101");
    await act(async () => void fireEvent(screen.getByTestId("room-list"), "endReached"));
    await screen.findByTestId("room-card-103");
    expect(screen.getAllByTestId("room-card-102")).toHaveLength(1);
    expect(fetchBoard).toHaveBeenCalledTimes(2);
  });
});

describe("when the board can't be shown", () => {
  it("a failed load is an error with Retry, never 'no rooms', and Retry loads the rooms", async () => {
    fetchBoard.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    const screen = renderBoard();
    expect(await screen.findByText("engineeringState.loadFailed")).toBeTruthy();
    expect(screen.queryByText("engRooms.empty")).toBeNull();
    expect(screen.queryByText("engRooms.noMatches")).toBeNull();
    fireEvent.press(screen.getByText("common.retry"));
    expect(await screen.findByTestId("room-card-312")).toBeTruthy();
  });

  it("says so when the role is not allowed, instead of an empty hotel", async () => {
    fetchBoard.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const screen = renderBoard();
    expect(await screen.findByText("engineeringState.forbidden")).toBeTruthy();
    expect(screen.queryByText("engRooms.empty")).toBeNull();
  });

  it("keeps the rooms on screen with a notice when a refresh fails", async () => {
    const screen = renderBoard();
    await screen.findByTestId("room-card-312");
    fetchBoard.mockRejectedValue(new Error("Network request failed"));
    fireEvent.press(screen.getByTestId("room-quick-all"));
    await act(async () => void screen.getByTestId("room-list").props.refreshControl.props.onRefresh());
    await screen.findByTestId("room-stale");
    expect(screen.getByTestId("room-card-312")).toBeTruthy();
  });

  it("distinguishes a hotel with no rooms from a search with no matches", async () => {
    fetchBoard.mockResolvedValue(page([], { counts: { total: 0, active_repairs: 0, unavailable: 0, occupied: 0 } }));
    const empty = renderBoard();
    expect(await empty.findByText("engRooms.empty")).toBeTruthy();
    empty.unmount();

    resetRoomBoardCache();
    const searching = renderBoard();
    await searching.findByText("engRooms.empty");
    fireEvent.changeText(searching.getByTestId("room-search"), "9999");
    // The search is debounced; give a loaded CI runner room to finish it.
    expect(await searching.findByText("engRooms.noMatches", {}, { timeout: 6000 })).toBeTruthy();
    expect(await searching.findByTestId("room-clear-filters", {}, { timeout: 6000 })).toBeTruthy();
  });

  it("with no connection and nothing cached, offers Retry instead of an empty list", async () => {
    mockOnline = false;
    fetchBoard.mockRejectedValue(new Error("Network request failed"));
    const screen = renderBoard();
    expect(await screen.findByText("engineeringState.offline")).toBeTruthy();
  });
});

describe("switching hotels", () => {
  it("never shows the previous hotel's rooms to the next one", async () => {
    const first = renderBoard();
    await first.findByTestId("room-card-312");
    first.unmount();
    mockHotel = "h2";
    fetchBoard.mockResolvedValue(page([room("901", 9)]));
    const second = renderBoard();
    expect(second.queryByTestId("room-card-312")).toBeNull();
    expect(await second.findByTestId("room-card-901")).toBeTruthy();
    expect(second.queryByTestId("room-card-312")).toBeNull();
  });
});
