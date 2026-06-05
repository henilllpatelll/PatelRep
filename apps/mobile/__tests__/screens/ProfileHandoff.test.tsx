import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/i18n", () => ({
  language: "en",
  changeLanguage: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { signOut: jest.fn() },
    from: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn() }),
    }),
  },
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: { name: "Lone Star Inn" } }),
  },
}));

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    user: {
      id: "user-1",
      full_name: "Maria Vega",
      role: "housekeeper",
      tenant_id: "hotel-1",
    },
  }),
}));

import ProfileScreen from "@/app/(app)/profile";

describe("ProfileScreen handoff", () => {
  it("renders identity, month stats, settings rows, and sign out", () => {
    const { getByText } = render(<ProfileScreen />);

    expect(getByText("Maria Vega")).toBeTruthy();
    expect(getByText(/Housekeeper/)).toBeTruthy();
    expect(getByText("128")).toBeTruthy();
    expect(getByText("rooms this month")).toBeTruthy();
    expect(getByText("My schedule")).toBeTruthy();
    expect(getByText("Language")).toBeTruthy();
    expect(getByText("Sign out")).toBeTruthy();
  });
});
