import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const mockSetMyRooms = jest.fn();

const mockRooms = [
  {
    id: "room-108",
    room_number: "108",
    floor: 1,
    status: "IN_PROGRESS",
    risk_level: null,
    dnd_flag: false,
    guest_name: "Guest still in",
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
  },
  {
    id: "room-112",
    room_number: "112",
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
  },
  {
    id: "room-115",
    room_number: "115",
    floor: 1,
    status: "DIRTY",
    risk_level: "HIGH",
    dnd_flag: false,
    guest_name: "Mr. Bell",
    predicted_ready_at: null,
    vip_flag: true,
    checkin_time: "2026-05-26T15:00:00.000Z",
  },
  {
    id: "room-101",
    room_number: "101",
    floor: 1,
    status: "INSPECTED",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
  },
];

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "home.greeting") return `Morning, ${values?.name}.`;
      if (key === "home.shiftMeta") return "Tue · May 26 · Day shift";
      return key;
    },
  }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: mockRooms }),
  },
}));

jest.mock("@/lib/offline/db", () => ({
  getRooms: jest.fn().mockResolvedValue(mockRooms),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    user: { id: "user-1", full_name: "Maria Vega", role: "housekeeper" },
    isOnline: true,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
  }),
}));

import HousekeeperHomeScreen from "@/app/(app)/home";

describe("HousekeeperHomeScreen", () => {
  it("renders Variation A with the dark copilot plan, pace card, and up-next rooms", async () => {
    const { getByText } = render(<HousekeeperHomeScreen />);

    await waitFor(() => expect(getByText("Morning, Maria.")).toBeTruthy());

    expect(getByText("Your smart order")).toBeTruthy();
    expect(getByText("Start with 112")).toBeTruthy();
    expect(getByText("3 rooms left.")).toBeTruthy();
    expect(getByText("1")).toBeTruthy();
    expect(getByText("of 4")).toBeTruthy();
    expect(getByText("You're ahead by 3 min")).toBeTruthy();
    expect(getByText("Up next")).toBeTruthy();
    expect(getByText("112")).toBeTruthy();
    expect(getByText("115")).toBeTruthy();
    expect(getByText("VIP")).toBeTruthy();
  });
});
