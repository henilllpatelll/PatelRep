import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockRouterPush = jest.fn();
const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();

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
    actual_checkout_at: null,
    clean_type: null,
    clean_type_label: null,
    rooms: { room_types: { name: "King" } },
    ...overrides,
  };
}

let mockRooms: Room[] = [];

const mockStore = {
  isOnline: true,
  myRooms: mockRooms,
  setMyRooms: mockSetMyRooms,
  enqueueAction: mockEnqueueAction,
};

jest.mock("expo-router", () => ({
  router: { push: mockRouterPush },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));
jest.mock("@/lib/offline/db", () => ({
  getRooms: jest.fn().mockResolvedValue([]),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/utils/date", () => ({
  localDate: () => "2026-06-09",
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: Object.assign(
    () => mockStore,
    {
      getState: () => ({
        myRooms: mockRooms,
        setMyRooms: mockSetMyRooms,
      }),
    },
  ),
}));

import { api } from "@/lib/api/client";
import MyRoomsScreen from "@/app/(app)/my-rooms";

const mockApiGet = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms = [
    makeRoom({
      id: "cleanable",
      room_number: "101",
      clean_type: "DEP",
      clean_type_label: "Departure",
      actual_checkout_at: "2026-06-09T10:00:00.000Z",
      checkin_time: "2026-06-09T16:00:00.000Z",
    }),
    makeRoom({
      id: "attention",
      room_number: "102",
      dnd_flag: true,
      clean_type: "DEP",
      clean_type_label: "Departure",
      actual_checkout_at: null,
    }),
    makeRoom({ id: "started", room_number: "103", status: "IN_PROGRESS" }),
    makeRoom({ id: "ready", room_number: "104", status: "INSPECTED" }),
    makeRoom({ id: "full", room_number: "105", status: "DIRTY", clean_type: "FULL", clean_type_label: "Full" }),
    makeRoom({ id: "light", room_number: "106", status: "PICKUP", clean_type: "LIGHT", clean_type_label: "Light" }),
  ];
  mockStore.myRooms = mockRooms;
  mockApiGet.mockResolvedValue({ data: mockRooms });
});

describe("MyRoomsScreen", () => {
  it("renders the shell header progress and smart-order queue by default", async () => {
    const { getAllByText, getByText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    expect(getByText("rooms.title")).toBeTruthy();
    expect(getByText("1/6")).toBeTruthy();
    expect(getByText("17%")).toBeTruthy();
    expect(getAllByText(/rooms\.remaining/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/rooms\.doneTab/).length).toBeGreaterThanOrEqual(1);
    expect(getByText("ai.smartOrder")).toBeTruthy();
    expect(getByText("NEEDS ATTENTION")).toBeTruthy();
  });

  it("renders departure, full, and light clean-type labels", async () => {
    const { getAllByLabelText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    expect(getAllByLabelText("Departure clean type").length).toBeGreaterThanOrEqual(1);
    expect(getAllByLabelText("Full clean type").length).toBeGreaterThanOrEqual(1);
    expect(getAllByLabelText("Light clean type").length).toBeGreaterThanOrEqual(1);
  });

  it("matches web clean-type labels for inspected full and light rooms", async () => {
    mockRooms = [
      makeRoom({ id: "full-ready", room_number: "201", status: "INSPECTED", clean_type: "FULL", clean_type_label: "Full" }),
      makeRoom({ id: "light-ready", room_number: "202", status: "INSPECTED", clean_type: "LIGHT", clean_type_label: "Light" }),
    ];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, queryByText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    // Inspected rooms live in the Done tab
    fireEvent.press(getByText(/rooms\.doneTab/));
    expect(getByText("Full Done")).toBeTruthy();
    expect(getByText("Light Done")).toBeTruthy();
    expect(queryByText("Full")).toBeNull();
    expect(queryByText("Light")).toBeNull();
  });

  it("shows DND departure rooms as Needs Attention with Review, not Start", async () => {
    mockRooms = [mockRooms[1]];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, queryByText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(getByText("NEEDS ATTENTION")).toBeTruthy());
    expect(getByText("102")).toBeTruthy();
    expect(getByText("DND")).toBeTruthy();
    expect(getByText("Review")).toBeTruthy();
    expect(queryByText("Start")).toBeNull();
  });

  it("puts checked-out departure rooms in the smart queue with a Start action", async () => {
    mockRooms = [mockRooms[0], mockRooms[1]];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(getByText("Start")).toBeTruthy());
    expect(getByText("101")).toBeTruthy();
    expect(getByText("NEEDS ATTENTION")).toBeTruthy();
    expect(getByText("102")).toBeTruthy();
  });

  it("Done tab shows submitted, ready, and blocked rooms only", async () => {
    mockRooms = [
      ...mockRooms,
      makeRoom({ id: "submitted", room_number: "107", status: "CLEAN" }),
      makeRoom({ id: "blocked", room_number: "108", status: "OUT_OF_SERVICE" }),
    ];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, queryByText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(getByText("ai.smartOrder")).toBeTruthy());
    expect(queryByText("SUBMITTED")).toBeNull();

    fireEvent.press(getByText(/rooms\.doneTab/));

    expect(getByText("SUBMITTED")).toBeTruthy();
    expect(getByText("READY")).toBeTruthy();
    expect(getByText("BLOCKED / OUT OF SERVICE")).toBeTruthy();
    expect(getByText("107")).toBeTruthy();
    expect(getByText("104")).toBeTruthy();
    expect(getByText("108")).toBeTruthy();
    // active queue rooms are not in the Done tab
    expect(queryByText("101")).toBeNull();
    expect(queryByText("103")).toBeNull();
  });
});
