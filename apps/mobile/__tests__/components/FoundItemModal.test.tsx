import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
let mockOnline = true;

jest.mock("@/lib/api/lostFound", () => ({
  createLostFoundItem: jest.fn(),
  uploadLostFoundPhoto: jest.fn(),
}));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn(),
  prepareForUpload: jest.fn(async (uri: string) => `resized:${uri}`),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ isOnline: mockOnline }),
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { createLostFoundItem, uploadLostFoundPhoto } from "@/lib/api/lostFound";
import { pickPhoto } from "@/lib/housekeeping/photo";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";

const mockCreate = createLostFoundItem as jest.Mock;
const mockUpload = uploadLostFoundPhoto as jest.Mock;
const mockPick = pickPhoto as jest.Mock;

function renderModal(onClose = jest.fn()) {
  const utils = render(
    <ThemeProvider>
      <FoundItemModal visible roomId="room-1" roomNumber="204" onClose={onClose} />
    </ThemeProvider>,
  );
  return { ...utils, onClose };
}

async function addPhoto(utils: ReturnType<typeof renderModal>) {
  mockPick.mockResolvedValue({ ok: true, uri: "file:///item.jpg" });
  fireEvent.press(utils.getByTestId("found-photo-camera"));
  await waitFor(() => expect(utils.getByTestId("found-photo-preview")).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockCreate.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue("https://storage.test/lost-found-photos/h/1.jpg");
});

describe("FoundItemModal", () => {
  it("needs a description before it will submit", () => {
    const utils = renderModal();
    expect(utils.getByTestId("found-submit").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(utils.getByTestId("found-submit"));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows the handling reminder", () => {
    const { getByText } = renderModal();
    expect(getByText("foundItem.reminderTitle")).toBeTruthy();
    expect(getByText("foundItem.reminderBody")).toBeTruthy();
  });

  it("logs the item into Lost & Found against the room, then confirms", async () => {
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("found-description"), "Black phone charger beside bed");
    fireEvent.press(utils.getByTestId("found-submit"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        description: "Black phone charger beside bed",
        room_id: "room-1",
        location_found: "Room 204",
        photo_url: undefined,
      }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("foundItem.submitted"));
    expect(utils.onClose).toHaveBeenCalled();
  });

  it("uploads the resized photo first and attaches its URL", async () => {
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("found-description"), "Wallet");
    await addPhoto(utils);
    fireEvent.press(utils.getByTestId("found-submit"));

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith("resized:file:///item.jpg"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ photo_url: "https://storage.test/lost-found-photos/h/1.jpg" })));
  });

  it("never reports an item without its photo when the upload fails: nothing is created and the draft stays", async () => {
    mockUpload.mockRejectedValue(new Error("Photo upload failed (HTTP 500)"));
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("found-description"), "Wallet");
    await addPhoto(utils);
    fireEvent.press(utils.getByTestId("found-submit"));

    await waitFor(() => expect(utils.getByTestId("found-photo-error")).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(utils.onClose).not.toHaveBeenCalled();
    expect(utils.getByTestId("found-description").props.value).toBe("Wallet");
  });

  it("reuses an uploaded photo when only the create step fails, so a retry does not upload twice", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce(undefined);
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("found-description"), "Wallet");
    await addPhoto(utils);
    fireEvent.press(utils.getByTestId("found-submit"));
    await waitFor(() => expect(utils.getByTestId("found-error")).toBeTruthy());
    expect(utils.onClose).not.toHaveBeenCalled();

    fireEvent.press(utils.getByTestId("found-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    expect(mockUpload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(utils.onClose).toHaveBeenCalled());
  });

  it("is online only: offline it says so and sends nothing", () => {
    mockOnline = false;
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("found-description"), "Wallet");
    expect(utils.getByTestId("found-offline")).toBeTruthy();
    expect(utils.getByTestId("found-submit").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(utils.getByTestId("found-submit"));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lets the attendant remove or replace the photo", async () => {
    const utils = renderModal();
    await addPhoto(utils);
    fireEvent.press(utils.getByTestId("found-photo-remove"));
    expect(utils.queryByTestId("found-photo-preview")).toBeNull();
  });

  it("explains a denied camera and still offers the gallery", async () => {
    mockPick.mockResolvedValue({ ok: false, reason: "permission_denied" });
    const utils = renderModal();
    fireEvent.press(utils.getByTestId("found-photo-camera"));
    await waitFor(() => expect(utils.getByText("rooms.work.sheets.photo.cameraDenied")).toBeTruthy());
    expect(utils.getByTestId("found-photo-gallery").props.accessibilityState.disabled).toBeFalsy();
  });

  it("asks before throwing away a typed description", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("found-description"), "Wallet");
    fireEvent.press(utils.getAllByLabelText("common.close").slice(-1)[0]);
    expect(alertSpy).toHaveBeenCalled();
    expect(utils.onClose).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
