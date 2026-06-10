import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

// Mock dependencies
jest.mock("@/lib/api/client", () => ({
  api: { post: jest.fn().mockResolvedValue({ data: {} }) },
}));
jest.mock("@/lib/api/workOrders", () => ({
  createWorkOrder: jest.fn().mockResolvedValue({ data: { id: "wo-new" } }),
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn(),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: jest.fn(),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Import after mocks
// eslint-disable-next-line import/first
import { api } from "@/lib/api/client";
// eslint-disable-next-line import/first
import { createWorkOrder } from "@/lib/api/workOrders";
// eslint-disable-next-line import/first
import { enqueueAction } from "@/lib/offline/db";
// eslint-disable-next-line import/first
import { useAppStore } from "@/stores/appStore";
// eslint-disable-next-line import/first
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";

const mockApiPost = api.post as jest.Mock;
const mockCreateWorkOrder = createWorkOrder as jest.Mock;
const mockEnqueueAction = enqueueAction as jest.Mock;
const mockUseAppStore = useAppStore as unknown as jest.Mock;

const defaultProps = {
  visible: true,
  roomId: "room-123",
  roomNumber: "101",
  onClose: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ReportIssueModal", () => {
  it("renders with a TextInput for description when visible=true", () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: true })
    );

    const { getByTestId } = render(
      <ReportIssueModal {...defaultProps} />
    );

    expect(getByTestId("description-input")).toBeTruthy();
  });

  it("calls POST /work-orders with room_id, title, description, category, priority when online", async () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: true })
    );
    mockCreateWorkOrder.mockResolvedValue({ data: { id: "wo-new" } });

    const { getByTestId } = render(
      <ReportIssueModal {...defaultProps} />
    );

    fireEvent.changeText(getByTestId("title-input"), "A/C not cooling");
    fireEvent.press(getByTestId("category-select"));
    fireEvent.press(getByTestId("category-option-hvac"));
    fireEvent.changeText(getByTestId("description-input"), "AC unit is broken");

    fireEvent.press(getByTestId("submit-button"));

    await waitFor(() => {
      expect(mockCreateWorkOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          room_id: "room-123",
          title: "A/C not cooling",
          description: "AC unit is broken",
          category: "hvac",
          priority: "normal",
        })
      );
    });

    expect(mockEnqueueAction).not.toHaveBeenCalled();
  });

  it("enqueues via enqueueAction when offline instead of calling api.post", async () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: false })
    );

    const { getByTestId } = render(
      <ReportIssueModal {...defaultProps} />
    );

    fireEvent.changeText(getByTestId("title-input"), "Toilet clogged");
    fireEvent.press(getByTestId("category-select"));
    fireEvent.press(getByTestId("category-option-plumbing"));
    fireEvent.changeText(getByTestId("description-input"), "Toilet is clogged");

    fireEvent.press(getByTestId("submit-button"));

    await waitFor(() => {
      expect(mockEnqueueAction).toHaveBeenCalledWith(
        "work_order",
        "create",
        expect.objectContaining({
          room_id: "room-123",
          title: "Toilet clogged",
          description: "Toilet is clogged",
          category: "plumbing",
          priority: "normal",
        })
      );
    });

    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockCreateWorkOrder).not.toHaveBeenCalled();
  });

  it("calls onClose when user taps Cancel", () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: true })
    );
    const onClose = jest.fn();

    const { getByText, getByTestId } = render(
      <ReportIssueModal {...defaultProps} onClose={onClose} />
    );

    const cancelButton =
      (() => {
        try {
          return getByText(/cancel/i);
        } catch {
          return getByTestId("cancel-button");
        }
      })();
    fireEvent.press(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });
});
