import React from "react";
import { Alert, Modal } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
let mockOnline = true;

jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn() } };
});
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ isOnline: mockOnline }),
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key) }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { api } from "@/lib/api/client";
import { parseSupplyDescription } from "@/lib/housekeeping/supplyRequest";
import SupplyRequestModal from "@/components/housekeeping/SupplyRequestModal";

const mockPost = api.post as jest.Mock;
const mockGet = api.get as jest.Mock;

function renderModal(onClose = jest.fn()) {
  const utils = render(
    <ThemeProvider>
      <SupplyRequestModal visible roomId="room-218" roomNumber="218" onClose={onClose} />
    </ThemeProvider>,
  );
  return { ...utils, onClose };
}

const plus = (utils: ReturnType<typeof renderModal>, item: string, times = 1) => {
  for (let i = 0; i < times; i += 1) fireEvent.press(utils.getByLabelText(`supplies.increase {"item":"supplies.items.${item}"}`));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockPost.mockResolvedValue({ data: {} });
  mockGet.mockResolvedValue({ data: [] });
});

describe("SupplyRequestModal", () => {
  it("starts every quantity at zero with nothing to send", () => {
    const utils = renderModal();
    expect(utils.getByTestId("supplies-total").props.children).toContain("supplies.total");
    expect(utils.getByTestId("supplies-total").props.children).toContain('"count":0');
    expect(utils.getByTestId("supplies-send").props.accessibilityState.disabled).toBe(true);
  });

  it("steps quantities up, never below zero, and never above the maximum", () => {
    const utils = renderModal();
    const minus = utils.getByLabelText('supplies.decrease {"item":"supplies.items.towels"}');
    expect(minus.props.accessibilityState.disabled).toBe(true);

    plus(utils, "towels", 25);
    const up = utils.getByLabelText('supplies.increase {"item":"supplies.items.towels"}');
    expect(up.props.accessibilityState.disabled).toBe(true);
    expect(utils.getByTestId("supplies-total").props.children).toContain('"count":20');
  });

  it("sends one housekeeping task with a readable summary and a machine-readable line", async () => {
    const utils = renderModal();
    plus(utils, "towels", 3);
    plus(utils, "amenities", 2);
    fireEvent.press(utils.getByTestId("supplies-send"));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe("/tasks");
    expect(body).toMatchObject({ task_type: "housekeeping", room_id: "room-218", priority: "normal", title: "Supply request — Room 218" });
    expect(body.description).toContain("3 × Bath towels, 2 × Amenities kit");
    expect(parseSupplyDescription(body.description)?.items).toEqual({ towels: 3, amenities: 2 });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining("supplies.sent")));
    expect(utils.onClose).toHaveBeenCalled();
  });

  it("accepts a free-text request on its own", async () => {
    const utils = renderModal();
    fireEvent.changeText(utils.getByTestId("supplies-note"), "Folding cot");
    fireEvent.press(utils.getByTestId("supplies-send"));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(parseSupplyDescription(mockPost.mock.calls[0][1].description)).toMatchObject({ items: {}, note: "Folding cot" });
  });

  it("does not claim success on failure and keeps every selection", async () => {
    mockPost.mockRejectedValue(Object.assign(new Error("bad"), { status: 422, name: "ApiError" }));
    const utils = renderModal();
    plus(utils, "towels", 2);
    fireEvent.press(utils.getByTestId("supplies-send"));

    await waitFor(() => expect(utils.getByTestId("supplies-failure")).toBeTruthy());
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(utils.onClose).not.toHaveBeenCalled();
    expect(utils.getByTestId("supplies-total").props.children).toContain('"count":2');
  });

  it("after a lost answer, a retry sends the same request id and does not create a second task", async () => {
    mockPost.mockRejectedValueOnce(new Error("Request timed out. Please try again."));
    const utils = renderModal();
    plus(utils, "towels", 1);
    fireEvent.press(utils.getByTestId("supplies-send"));
    await waitFor(() => expect(utils.getByTestId("supplies-failure")).toBeTruthy());
    const firstDescription = mockPost.mock.calls[0][1].description as string;

    // The first request actually landed.
    mockGet.mockResolvedValue({ data: [{ description: firstDescription }] });
    fireEvent.press(utils.getByTestId("supplies-send"));
    await waitFor(() => expect(utils.onClose).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("does not send twice on a double tap", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const utils = renderModal();
    plus(utils, "towels", 1);
    fireEvent.press(utils.getByTestId("supplies-send"));
    fireEvent.press(utils.getByTestId("supplies-send"));
    await act(async () => {
      release({ data: {} });
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("is online only and says so", () => {
    mockOnline = false;
    const utils = renderModal();
    plus(utils, "towels", 1);
    expect(utils.getByTestId("supplies-offline")).toBeTruthy();
    expect(utils.getByTestId("supplies-send").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(utils.getByTestId("supplies-send"));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("asks before discarding, on the Android back button too", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const utils = renderModal();
    plus(utils, "towels", 1);
    act(() => {
      utils.UNSAFE_getByType(Modal).props.onRequestClose();
    });
    expect(alertSpy).toHaveBeenCalledWith("rooms.work.sheets.discard.title", "rooms.work.sheets.discard.message", expect.any(Array));
    expect(utils.onClose).not.toHaveBeenCalled();

    // Choosing Discard closes and the next open starts empty.
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    act(() => buttons.find((button) => button.text === "rooms.work.sheets.discard.discard")?.onPress?.());
    expect(utils.onClose).toHaveBeenCalled();
    expect(utils.getByTestId("supplies-total").props.children).toContain('"count":0');
    alertSpy.mockRestore();
  });

  it("labels each quantity control for a screen reader", () => {
    const utils = renderModal();
    expect(utils.getByLabelText('supplies.increase {"item":"supplies.items.towels"}').props.accessibilityRole).toBe("button");
    expect(utils.getAllByRole("adjustable").length).toBe(5);
  });
});
