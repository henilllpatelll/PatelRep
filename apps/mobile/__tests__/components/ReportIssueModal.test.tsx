import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

// Mock dependencies
jest.mock("@/lib/api/client", () => ({
  api: { post: jest.fn().mockResolvedValue({ data: {} }) },
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
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

// Import after mocks
// eslint-disable-next-line import/first
import { api } from "@/lib/api/client";
// eslint-disable-next-line import/first
import { enqueueAction } from "@/lib/offline/db";
// eslint-disable-next-line import/first
import { useAppStore } from "@/stores/appStore";
// eslint-disable-next-line import/first
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";

const mockApiPost = api.post as jest.Mock;
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

    const { getByPlaceholderText } = render(
      <ReportIssueModal {...defaultProps} />
    );

    expect(getByPlaceholderText(/Describe what you found/i)).toBeTruthy();
  });

  it("calls POST /work-orders with room_id, title, description, category, priority when online", async () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: true })
    );
    mockApiPost.mockResolvedValue({ data: { id: "wo-new" } });

    const { getByPlaceholderText, getByText } = render(
      <ReportIssueModal {...defaultProps} />
    );

    fireEvent.changeText(getByPlaceholderText(/Toilet not flushing/i), "Broken AC");
    fireEvent.press(getByText("Select a category"));
    fireEvent.press(getByText("General"));
    fireEvent.changeText(getByPlaceholderText(/Describe what you found/i), "AC unit is broken");

    fireEvent.press(getByText("Submit to Engineering"));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/work-orders",
        expect.objectContaining({
          room_id: "room-123",
          title: "Broken AC",
          description: "AC unit is broken",
          category: "general",
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

    const { getByPlaceholderText, getByText } = render(
      <ReportIssueModal {...defaultProps} />
    );

    fireEvent.changeText(getByPlaceholderText(/Toilet not flushing/i), "Clogged toilet");
    fireEvent.press(getByText("Select a category"));
    fireEvent.press(getByText("General"));
    fireEvent.changeText(getByPlaceholderText(/Describe what you found/i), "Toilet is clogged");

    fireEvent.press(getByText("Submit to Engineering"));

    await waitFor(() => {
      expect(mockEnqueueAction).toHaveBeenCalledWith(
        "work_order",
        "create",
        expect.objectContaining({
          room_id: "room-123",
          title: "Clogged toilet",
          description: "Toilet is clogged",
          category: "general",
          priority: "normal",
        })
      );
    });

    expect(mockApiPost).not.toHaveBeenCalled();
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
