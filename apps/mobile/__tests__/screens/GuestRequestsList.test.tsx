import React from "react";
import { render, waitFor, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    user: { tenant_id: "hotel-1" },
    setUnreadCount: jest.fn(),
  }),
}));

import { api } from "@/lib/api/client";
import GuestRequestsScreen from "@/app/(app)/guest-requests";

const mockApiGet = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue({
    data: [
      {
        id: "gr-1",
        room_number: "214",
        guest_name: "Ms. Bell",
        request_type: "Towels",
        description: "Needs extra towels",
        status: "escalated",
        priority: "urgent",
        assigned_to_name: null,
        created_at: new Date().toISOString(),
      },
    ],
  });
});

describe("GuestRequestsScreen", () => {
  it("shows AI triage context without changing request data", async () => {
    render(<GuestRequestsScreen />);

    await waitFor(() => expect(screen.getByText("Room 214")).toBeTruthy());

    expect(screen.getByText("AI triage")).toBeTruthy();
    expect(screen.getByText(/Escalated requests stay surfaced/)).toBeTruthy();
    expect(screen.getByText("Towels")).toBeTruthy();
    expect(screen.getByText("urgent")).toBeTruthy();
  });
});
