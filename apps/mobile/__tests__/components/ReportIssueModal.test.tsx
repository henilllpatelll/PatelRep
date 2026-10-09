import React from "react";
import { Alert } from "react-native";
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
jest.mock("@/lib/api/workOrders", () => ({
  createWorkOrder: jest.fn(),
  uploadWorkOrderPhoto: jest.fn(),
}));
jest.mock("@/lib/offline/db", () => ({ enqueueAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn(),
  prepareForUpload: jest.fn(async (uri: string) => `resized:${uri}`),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ isOnline: mockOnline, user: { id: "user-1" } }),
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { api } from "@/lib/api/client";
import { createWorkOrder, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { enqueueAction } from "@/lib/offline/db";
import { pickPhoto } from "@/lib/housekeeping/photo";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";

const mockCreate = createWorkOrder as jest.Mock;
const mockUpload = uploadWorkOrderPhoto as jest.Mock;
const mockEnqueue = enqueueAction as jest.Mock;
const mockPick = pickPhoto as jest.Mock;
const mockGet = api.get as jest.Mock;

function renderModal(onClose = jest.fn()) {
  const utils = render(
    <ThemeProvider>
      <ReportIssueModal visible roomId="room-123" roomNumber="101" onClose={onClose} />
    </ThemeProvider>,
  );
  return { ...utils, onClose };
}

function fill(utils: ReturnType<typeof renderModal>, title = "A/C not cooling", category = "hvac") {
  fireEvent.changeText(utils.getByTestId("title-input"), title);
  fireEvent.press(utils.getByTestId(`category-option-${category}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockCreate.mockResolvedValue("wo-new");
  mockUpload.mockResolvedValue({});
  mockGet.mockResolvedValue({ data: [] });
});

describe("ReportIssueModal (maintenance / damage)", () => {
  it("requires a title and a category and says so next to the fields", () => {
    const utils = renderModal();
    fireEvent.press(utils.getByTestId("issue-submit"));

    expect(utils.getByTestId("issue-error-title")).toBeTruthy();
    expect(utils.getByTestId("issue-error-category")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("offers only the priorities a housekeeper may set (no emergency)", () => {
    const utils = renderModal();
    expect(utils.getByTestId("priority-low")).toBeTruthy();
    expect(utils.getByTestId("priority-normal")).toBeTruthy();
    expect(utils.getByTestId("priority-urgent")).toBeTruthy();
    expect(utils.queryByTestId("priority-emergency")).toBeNull();
  });

  it("creates the work order with room, title, details, category and priority, then reports it as submitted", async () => {
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("priority-urgent"));
    fireEvent.changeText(utils.getByTestId("issue-details"), "Unit is warm");
    fireEvent.press(utils.getByTestId("issue-submit"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        room_id: "room-123",
        title: "A/C not cooling",
        description: "Unit is warm",
        category: "hvac",
        priority: "urgent",
        client_request_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("reportIssue.submittedOnline"));
    expect(utils.onClose).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("never lets the payload mark the room out of order", async () => {
    const utils = renderModal();
    fill(utils, "Broken door");
    fireEvent.press(utils.getByTestId("issue-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("mark_room_out_of_order");
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("room_unavailability");
  });

  it("queues through the existing work-order queue when offline and calls it 'saved', not 'submitted'", async () => {
    mockOnline = false;
    const utils = renderModal();
    fill(utils, "Toilet clogged", "plumbing");
    fireEvent.press(utils.getByTestId("issue-submit"));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith("work_order", "create", expect.objectContaining({ room_id: "room-123", title: "Toilet clogged", category: "plumbing" })),
    );
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith("reportIssue.savedOffline");
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("does not silently drop a photo offline: submit is blocked with an explanation", async () => {
    mockPick.mockResolvedValue({ ok: true, uri: "file:///p.jpg" });
    const utils = renderModal();
    fill(utils);
    mockOnline = true;
    fireEvent.press(utils.getByTestId("issue-photo-gallery"));
    await waitFor(() => expect(utils.getByTestId("issue-photo-preview")).toBeTruthy());

    mockOnline = false;
    utils.rerender(
      <ThemeProvider>
        <ReportIssueModal visible roomId="room-123" roomNumber="101" onClose={utils.onClose} />
      </ThemeProvider>,
    );
    expect(utils.getByTestId("issue-offline-photo")).toBeTruthy();
    expect(utils.getByTestId("issue-submit").props.accessibilityState.disabled).toBe(true);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("uploads the resized photo to the NEW work order", async () => {
    mockPick.mockResolvedValue({ ok: true, uri: "file:///p.jpg" });
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-photo-camera"));
    await waitFor(() => expect(utils.getByTestId("issue-photo-preview")).toBeTruthy());
    fireEvent.press(utils.getByTestId("issue-submit"));

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith("wo-new", "resized:file:///p.jpg"));
    await waitFor(() => expect(utils.onClose).toHaveBeenCalled());
  });

  it("when only the photo fails, keeps the created work order and retries just the photo", async () => {
    mockPick.mockResolvedValue({ ok: true, uri: "file:///p.jpg" });
    mockUpload.mockRejectedValueOnce(new Error("Photo upload failed")).mockResolvedValueOnce({});
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-photo-gallery"));
    await waitFor(() => expect(utils.getByTestId("issue-photo-preview")).toBeTruthy());
    fireEvent.press(utils.getByTestId("issue-submit"));

    await waitFor(() => expect(utils.getByTestId("issue-photo-failed")).toBeTruthy());
    expect(utils.onClose).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();

    fireEvent.press(utils.getByTestId("issue-submit"));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(utils.onClose).toHaveBeenCalled());
  });

  it("can finish without the photo after it failed, still without a second work order", async () => {
    mockPick.mockResolvedValue({ ok: true, uri: "file:///p.jpg" });
    mockUpload.mockRejectedValue(new Error("Photo upload failed"));
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-photo-gallery"));
    await waitFor(() => expect(utils.getByTestId("issue-photo-preview")).toBeTruthy());
    fireEvent.press(utils.getByTestId("issue-submit"));
    await waitFor(() => expect(utils.getByTestId("issue-skip-photo")).toBeTruthy());

    fireEvent.press(utils.getByTestId("issue-skip-photo"));
    expect(utils.onClose).toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith("reportIssue.submittedNoPhoto");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft on a rejected create and shows the failure", async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error("Bad request"), { status: 422 }));
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-submit"));

    await waitFor(() => expect(utils.getByTestId("issue-failure")).toBeTruthy());
    expect(utils.getByTestId("title-input").props.value).toBe("A/C not cooling");
    expect(utils.onClose).not.toHaveBeenCalled();
  });

  it("after an answer-less failure, a retry first looks for the work order it may have made", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Request timed out. Please try again."));
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-submit"));
    await waitFor(() => expect(utils.getByTestId("issue-failure")).toBeTruthy());

    mockGet.mockResolvedValue({ data: [{ id: "wo-existing", title: "A/C not cooling", created_by: "user-1" }] });
    fireEvent.press(utils.getByTestId("issue-submit"));

    await waitFor(() => expect(utils.onClose).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("/work-orders?room_id=room-123"));
  });

  it("resends the SAME request id when the answer was lost and the earlier work order cannot be found", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Request timed out. Please try again."));
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-submit"));
    await waitFor(() => expect(utils.getByTestId("issue-failure")).toBeTruthy());

    fireEvent.press(utils.getByTestId("issue-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    const [first, second] = mockCreate.mock.calls.map((call) => call[0].client_request_id);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("uses a fresh request id for the next report once one has been submitted", async () => {
    const onClose = jest.fn();
    const first = renderModal(onClose);
    fill(first);
    fireEvent.press(first.getByTestId("issue-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    first.unmount();

    const second = renderModal();
    fill(second, "Lamp broken", "furniture");
    fireEvent.press(second.getByTestId("issue-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    const ids = mockCreate.mock.calls.map((call) => call[0].client_request_id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("asks before discarding a filled form, and closes straight away when nothing was entered", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const clean = renderModal();
    act(() => {
      fireEvent.press(clean.getAllByLabelText("common.close").slice(-1)[0]);
    });
    expect(clean.onClose).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    clean.unmount();

    const dirty = renderModal();
    dirty.getByTestId("title-input");
    fireEvent.changeText(dirty.getByTestId("title-input"), "Half typed");
    fireEvent.press(dirty.getAllByLabelText("common.close").slice(-1)[0]);
    expect(alertSpy).toHaveBeenCalledWith("rooms.work.sheets.discard.title", "rooms.work.sheets.discard.message", expect.any(Array));
    expect(dirty.onClose).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("does not submit twice on a double tap", async () => {
    let release: (id: string) => void = () => undefined;
    mockCreate.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));
    const utils = renderModal();
    fill(utils);
    fireEvent.press(utils.getByTestId("issue-submit"));
    fireEvent.press(utils.getByTestId("issue-submit"));
    await act(async () => {
      release("wo-new");
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
