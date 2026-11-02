import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn(),
  prepareForUpload: jest.fn().mockImplementation(async (uri: string) => `${uri}#small`),
}));

import { pickPhoto } from "@/lib/housekeeping/photo";
import { PmPhotoField } from "@/components/engineering/pm/PmPhotoField";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const pick = pickPhoto as jest.Mock;

function field(over: Partial<React.ComponentProps<typeof PmPhotoField>> = {}) {
  const props = { photos: [], uploading: false, online: true, onAdd: jest.fn().mockResolvedValue(undefined), onRemove: jest.fn(), testID: "photos", ...over };
  return { ...render(<ThemeProvider><PmPhotoField {...props} /></ThemeProvider>), props: props as typeof props & { onAdd: jest.Mock; onRemove: jest.Mock } };
}

beforeEach(() => {
  jest.clearAllMocks();
  pick.mockResolvedValue({ ok: true, uri: "file:///a.jpg" });
});

describe("PM photo evidence", () => {
  it("uploads a photo straight away and only the prepared copy is sent", async () => {
    const ui = field();
    await act(async () => {
      fireEvent.press(ui.getByTestId("photos-camera"));
    });
    await waitFor(() => expect(ui.props.onAdd).toHaveBeenCalledTimes(1));
    expect(ui.props.onAdd.mock.calls[0][0]).toBe("file:///a.jpg#small");
  });

  it("stays silent when the person cancels, and explains a denied camera permission", async () => {
    pick.mockResolvedValueOnce({ ok: false, reason: "cancelled" });
    const ui = field();
    await act(async () => {
      fireEvent.press(ui.getByTestId("photos-camera"));
    });
    expect(ui.props.onAdd).not.toHaveBeenCalled();
    expect(ui.queryByTestId("photos-error")).toBeNull();

    pick.mockResolvedValueOnce({ ok: false, reason: "permission_denied" });
    await act(async () => {
      fireEvent.press(ui.getByTestId("photos-camera"));
    });
    expect(ui.props.onAdd).not.toHaveBeenCalled();
    expect(ui.getByText("workOrders.repair.evidence.pick.permission_denied")).toBeTruthy();
  });

  it("keeps a failed photo for retry: the retry re-sends the same prepared photo without asking for it again", async () => {
    const onAdd = jest.fn().mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce(undefined);
    const ui = field({ onAdd });
    await act(async () => {
      fireEvent.press(ui.getByTestId("photos-camera"));
    });
    expect(await ui.findByTestId("photos-error")).toBeTruthy(); // nothing is shown as attached
    expect(pick).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(ui.getByTestId("photos-retry"));
    });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd.mock.calls[1][0]).toBe(onAdd.mock.calls[0][0]);
    await waitFor(() => expect(ui.queryByTestId("photos-error")).toBeNull());
  });

  it("marks every attached photo as uploaded, previews it, and removes only the one asked for", async () => {
    const ui = field({ photos: [{ id: "ev-1", uri: "file:///a.jpg" }, { id: "ev-2" }] });
    expect(ui.getByTestId("photos-preview-ev-1").props.accessibilityLabel).toBe("pm.photo.preview. pm.photo.uploaded");
    fireEvent.press(ui.getByTestId("photos-preview-ev-1"));
    expect(ui.getByTestId("photos-preview-close")).toBeTruthy();
    fireEvent.press(ui.getByTestId("photos-preview-close"));
    fireEvent.press(ui.getByTestId("photos-remove-ev-2"));
    expect(ui.props.onRemove).toHaveBeenCalledWith("ev-2");
  });

  it("works offline: photos are kept on the phone, and the field says so", () => {
    const ui = field({ online: false });
    expect(ui.getByTestId("photos-camera").props.accessibilityState.disabled).toBe(false);
    expect(ui.getByTestId("photos-offline-note")).toBeTruthy();
    expect(ui.getByText("pm.photo.offlineNote")).toBeTruthy();
  });

  it("marks a photo that is only on the phone in words, never as uploaded", () => {
    const ui = field({ photos: [{ id: "local:abc", uri: "file:///docs/a.jpg", local: { bytes: 10 } }, { id: "ev-1", uri: "file:///c/b.jpg" }] });
    expect(ui.getByTestId("photos-preview-local:abc").props.accessibilityLabel).toContain("pm.photo.savedOnPhone");
    expect(ui.getByTestId("photos-preview-ev-1").props.accessibilityLabel).toContain("pm.photo.uploaded");
    expect(ui.getByTestId("photos-preview-local:abc").props.accessibilityLabel).not.toContain("pm.photo.uploaded");
  });
});
