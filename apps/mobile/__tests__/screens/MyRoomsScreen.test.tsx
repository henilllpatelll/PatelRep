import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockRouterPush = jest.fn();
const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();
const mockT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && key === "rooms.sections.floor") return `Floor ${opts.floor}`;
  if (key === "rooms.sections.building.A") return "Building A";
  if (key === "rooms.sections.building.B") return "Building B";
  if (key === "rooms.sections.building.unknown") return "Other";
  return key;
};
let mockLanguage = "en";

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
    room_type_code: "KS",
    room_type_name: "King Suite",
    rooms: { room_types: { name: "King Suite", code: "KS" } },
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
  useTranslation: () => ({ t: mockT, i18n: { language: mockLanguage, resolvedLanguage: mockLanguage } }),
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
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import MyRoomsScreen from "@/app/(app)/my-rooms";

const mockApiGet = api.get as jest.Mock;

function renderScreen() {
  return render(
    <ThemeProvider>
      <MyRoomsScreen />
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
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
  it("formats the header date using the active language", async () => {
    mockLanguage = "es";
    const expectedSpanishDate = new Date().toLocaleDateString("es-US", { weekday: "long", month: "long", day: "numeric" });
    const expectedEnglishDate = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));
    expect(getByText(expectedSpanishDate)).toBeTruthy();
    expect(queryByText(expectedEnglishDate)).toBeNull();
  });

  it("renders building-grouped sections for remaining rooms", async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    expect(getByText("rooms.title")).toBeTruthy();
    expect(getByText("1/6")).toBeTruthy();
    expect(getByText("17%")).toBeTruthy();
    // All test rooms are 101–108 (suffix 01–08 = Building A, Floor 1)
    expect(getByText("Building A")).toBeTruthy();
    expect(getByText("Floor 1")).toBeTruthy();
  });

  it("renders translated departure, full, and light clean-type labels", async () => {
    const { getAllByLabelText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    expect(getAllByLabelText("rooms.card.cleanTypeAccessibility").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the room type code on room cards instead of the room type name", async () => {
    mockRooms = [
      makeRoom({
        id: "code-room",
        room_number: "201",
        room_type_code: "KS",
        room_type_name: "King Suite",
        rooms: { room_types: { name: "King Suite" } },
      }),
    ];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    expect(getByText("KS")).toBeTruthy();
    expect(queryByText("King Suite")).toBeNull();
  });

  it("matches web clean-type labels for inspected full and light rooms", async () => {
    mockRooms = [
      makeRoom({ id: "full-ready", room_number: "201", status: "INSPECTED", clean_type: "FULL", clean_type_label: "Full" }),
      makeRoom({ id: "light-ready", room_number: "202", status: "INSPECTED", clean_type: "LIGHT", clean_type_label: "Light" }),
    ];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    fireEvent.press(getByText(/rooms\.doneTab/));
    expect(getByText("rooms.card.cleanType.FULL_DONE")).toBeTruthy();
    expect(getByText("rooms.card.cleanType.LIGHT_DONE")).toBeTruthy();
    expect(queryByText("Full")).toBeNull();
    expect(queryByText("Light")).toBeNull();
  });

  it("DND rooms appear in their building/floor group (dimmed) with no Start action", async () => {
    mockRooms = [mockRooms[1]]; // room 102, dnd_flag: true
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, getAllByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Building A")).toBeTruthy());
    expect(getByText("Floor 1")).toBeTruthy();
    expect(getByText("102")).toBeTruthy();
    expect(getAllByText("rooms.card.badges.dnd").length).toBeGreaterThanOrEqual(1);
    // Exception rooms have no action label
    expect(queryByText("rooms.card.action.start")).toBeNull();
    expect(queryByText("rooms.card.action.review")).toBeNull();
  });

  it("cleanable departure rooms appear in their building/floor group with a Start action", async () => {
    mockRooms = [mockRooms[0]]; // room 101, checked out
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("Building A")).toBeTruthy());
    expect(getByText("Floor 1")).toBeTruthy();
    expect(getByText("101")).toBeTruthy();
    expect(getByText("rooms.card.action.start")).toBeTruthy();
  });

  it("Done tab shows submitted, ready, and blocked rooms only", async () => {
    mockRooms = [
      ...mockRooms,
      makeRoom({ id: "submitted", room_number: "107", status: "CLEAN" }),
      makeRoom({ id: "blocked", room_number: "108", status: "OUT_OF_SERVICE" }),
    ];
    mockStore.myRooms = mockRooms;
    mockApiGet.mockResolvedValue({ data: mockRooms });

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("Building A")).toBeTruthy());
    expect(queryByText("rooms.sections.submitted")).toBeNull();

    fireEvent.press(getByText(/rooms\.doneTab/));

    expect(getByText("rooms.sections.submitted")).toBeTruthy();
    expect(getByText("rooms.sections.ready")).toBeTruthy();
    expect(getByText("rooms.sections.blocked")).toBeTruthy();
    expect(getByText("107")).toBeTruthy();
    expect(getByText("104")).toBeTruthy();
    expect(getByText("108")).toBeTruthy();
    expect(queryByText("101")).toBeNull();
    expect(queryByText("103")).toBeNull();
  });
});
