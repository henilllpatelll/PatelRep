import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ woId: "wo-1" }),
  router: { back: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: jest.fn().mockReturnValue({
        upload: jest.fn(),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: "" } }),
      }),
    },
  },
}));
jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  MediaTypeOptions: { Images: "Images" },
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

import { api } from "@/lib/api/client";
import WorkOrderDetailScreen from "@/app/(app)/work-orders/[woId]";

const mockApiGet = api.get as jest.Mock;
const mockApiPost = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue({
    id: "wo-1",
    title: "Fix AC",
    status: "in_progress",
    priority: "urgent",
    photos: [],
  });
  mockApiPost.mockResolvedValue({});
});

describe("WorkOrderDetailScreen", () => {
  it("renders completion notes TextInput when status is in_progress", async () => {
    const { getByTestId } = render(<WorkOrderDetailScreen />);
    await waitFor(() => expect(getByTestId("completion-notes")).toBeTruthy());
  });

  it("sends completion_notes in api.post payload when Mark Complete is pressed", async () => {
    const { getByTestId, getByText } = render(<WorkOrderDetailScreen />);

    await waitFor(() => expect(getByTestId("completion-notes")).toBeTruthy());

    fireEvent.changeText(getByTestId("completion-notes"), "Fixed it");
    fireEvent.press(getByText("workOrders.complete"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith(
        "/work-orders/wo-1/complete",
        { completion_notes: "Fixed it", photo_urls: [] }
      )
    );
  });
});
