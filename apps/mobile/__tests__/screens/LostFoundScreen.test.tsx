import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockToastError = jest.fn();

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/components/shared/mobileHandoff", () => {
  const React = require("react");
  const { Pressable, Text, View } = require("react-native");

  return {
    IconButton: () => null,
    Segmented: ({ items }: { items: Array<{ label: string; onPress?: () => void }> }) => (
      <View>
        {items.map((item) => (
          <Pressable key={item.label} onPress={item.onPress}>
            <Text>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

jest.mock("@/lib/api/lostFound", () => ({
  createLostFoundItem: jest.fn(),
  listItems: jest.fn(),
  listRooms: jest.fn(),
}));

jest.mock("@/lib/theme/useToast", () => ({
  useToast: () => ({ error: mockToastError }),
}));

import { createLostFoundItem, listItems, listRooms } from "@/lib/api/lostFound";
import LostFoundScreen from "@/app/(app)/lost-found/index";

const mockCreateLostFoundItem = createLostFoundItem as jest.Mock;
const mockListItems = listItems as jest.Mock;
const mockListRooms = listRooms as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockListItems.mockResolvedValue({ data: [] });
  mockListRooms.mockResolvedValue({ data: [] });
  mockCreateLostFoundItem.mockRejectedValue(new Error("Network unavailable"));
});

describe("LostFoundScreen", () => {
  it("shows toast feedback when logging a found item fails", async () => {
    render(<LostFoundScreen />);

    await waitFor(() => expect(mockListItems).toHaveBeenCalled());
    fireEvent.press(screen.getByText("Log a found item"));
    fireEvent.changeText(
      screen.getByPlaceholderText("e.g. iPhone charger, reading glasses..."),
      "Reading glasses",
    );
    fireEvent.press(screen.getByText("Log item"));

    await waitFor(() =>
      expect(mockCreateLostFoundItem).toHaveBeenCalledWith({
        description: "Reading glasses",
        location_found: undefined,
        room_id: undefined,
      }),
    );
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Could not log item. Try again."));
  });
});
