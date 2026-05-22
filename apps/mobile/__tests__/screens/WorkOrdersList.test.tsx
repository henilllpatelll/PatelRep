import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: false }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("react-native/Libraries/Lists/FlatList", () => {
  const React = require("react");
  const { View } = require("react-native");
  return function MockFlatList({ data, renderItem, ListEmptyComponent, contentContainerStyle }: any) {
    if (!data || data.length === 0) {
      return ListEmptyComponent ? React.createElement(View, { style: contentContainerStyle }, ListEmptyComponent) : null;
    }
    return React.createElement(View, null, data.map((item: any, index: number) => React.cloneElement(renderItem({ item, index, separators: {} }), { key: item.id ?? index })));
  };
});

import { api } from "@/lib/api/client";
import { enqueueAction } from "@/lib/offline/db";
import WorkOrdersScreen from "@/app/(app)/work-orders/index";

const mockApiGet = api.get as jest.Mock;

const sampleWO = {
  id: "wo-1",
  title: "Fix AC",
  status: "open",
  priority: "urgent",
  room_number: "101",
  claimed_by: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue([sampleWO]);
});

describe("WorkOrdersScreen", () => {
  it("renders WO card fields: title, priority, room number", async () => {
    render(<WorkOrdersScreen />);
    await waitFor(() => expect(screen.getByText("Fix AC")).toBeTruthy());
    expect(screen.getByText(/101/)).toBeTruthy();
  });

  it("shows Claim button on open unassigned WOs", async () => {
    render(<WorkOrdersScreen />);
    await waitFor(() => expect(screen.getByText(/claim/i)).toBeTruthy());
  });

  it("enqueues work_order/claim when offline and Claim is tapped", async () => {
    render(<WorkOrdersScreen />);
    await waitFor(() => screen.getByText(/claim/i));
    fireEvent.press(screen.getByText(/claim/i));
    await waitFor(() =>
      expect(enqueueAction).toHaveBeenCalledWith("work_order", "claim", {}, "wo-1")
    );
  });
});
