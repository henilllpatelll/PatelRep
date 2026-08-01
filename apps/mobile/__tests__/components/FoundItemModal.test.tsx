import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockToastError = jest.fn();

jest.mock("@/lib/api/lostFound", () => ({
  createLostFoundItem: jest.fn(),
  uploadLostFoundPhoto: jest.fn(),
}));

jest.mock("@/lib/theme/useToast", () => ({
  useToast: () => ({ error: mockToastError }),
}));

jest.mock("@/stores/appStore", () => ({
  useAppStore: jest.fn(() => ({ isOnline: true })),
}));

import { createLostFoundItem } from "@/lib/api/lostFound";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";

const mockCreateLostFoundItem = createLostFoundItem as jest.Mock;

const defaultProps = {
  visible: true,
  roomId: "room-1",
  roomNumber: "204",
  onClose: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateLostFoundItem.mockRejectedValue(new Error("Network unavailable"));
});

function renderModal(onClose = jest.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <FoundItemModal {...defaultProps} onClose={onClose} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("FoundItemModal", () => {
  it("shows a toast error and keeps the modal open when submission fails", async () => {
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.changeText(
      screen.getByPlaceholderText("Describe the item (e.g. wallet, phone charger, jacket)..."),
      "Reading glasses",
    );
    fireEvent.press(screen.getByLabelText("Report Found Item"));

    await waitFor(() => expect(mockCreateLostFoundItem).toHaveBeenCalledWith({
      description: "Reading glasses",
      room_id: "room-1",
      location_found: "Room 204",
      photo_url: undefined,
    }));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Could not submit found item. Try again."),
    );

    expect(onClose).not.toHaveBeenCalled();
  });
});
