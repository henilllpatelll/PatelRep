import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/workOrders", () => ({
  createWorkOrderDetailed: jest.fn(),
  uploadWorkOrderPhoto: jest.fn(),
  listAssetRepairs: jest.fn(),
}));
jest.mock("@/lib/api/engineeringRooms", () => ({
  fetchRoomBoard: jest.fn(),
  getActiveRoomPeriod: jest.fn(),
  listAvailabilityReasons: jest.fn(),
  listRoomAssets: jest.fn(),
  listRoomRepairHistory: jest.fn(),
}));
jest.mock("@/lib/offline/db", () => ({ enqueueAction: jest.fn() }));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn(),
  prepareForUpload: jest.fn(async (uri: string) => `${uri}?small`),
}));
jest.mock("@/lib/housekeeping/photoAsset", () => ({ discardLocalPhoto: jest.fn() }));
let mockOnline = true;
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", role: mockRole, tenant_id: "h1" } })),
  };
});

import { router } from "expo-router";
import { createWorkOrderDetailed, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { fetchRoomBoard, getActiveRoomPeriod, listAvailabilityReasons } from "@/lib/api/engineeringRooms";
import { enqueueAction } from "@/lib/offline/db";
import { pickPhoto } from "@/lib/housekeeping/photo";
import ReportIssueScreen from "@/app/(app)/work-orders/new";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const create = createWorkOrderDetailed as jest.Mock;
const upload = uploadWorkOrderPhoto as jest.Mock;
const enqueue = enqueueAction as jest.Mock;
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const refusal = (status: number, message = "Refused") => Object.assign(new Error(message), { status });
const created = (over: Record<string, unknown> = {}) => ({ id: "wo-1", workOrderNumber: "1042", status: "open", title: "Sink leaking", priority: "normal", replayed: false, roomMarkedOutOfOrder: false, ...over });
const sent = (n = 0) => create.mock.calls[n][0] as Record<string, unknown>;

const renderScreen = () =>
  render(
    <ThemeProvider>
      <ReportIssueScreen />
    </ThemeProvider>,
  );

const ROOM_PARAMS = { roomId: "r-312", roomNumber: "312", floor: "3", from: "room" };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockParams = {};
  mockOnline = true;
  mockRole = "engineer";
  create.mockResolvedValue(created());
  upload.mockResolvedValue({});
  enqueue.mockResolvedValue(undefined);
  (getActiveRoomPeriod as jest.Mock).mockResolvedValue(null);
  (listAvailabilityReasons as jest.Mock).mockResolvedValue([
    { id: "1", code: "PLUMBING", label: "Plumbing" },
    { id: "2", code: "HVAC", label: "HVAC" },
  ]);
  (fetchRoomBoard as jest.Mock).mockResolvedValue({
    rows: [
      { id: "r-101", room_number: "101", floor: 1, building: null, availability: null },
      { id: "r-205", room_number: "205", floor: 2, building: null, availability: "out_of_order" },
    ],
    total: 2,
    hasMore: false,
    counts: null,
    floors: [],
    buildings: [],
  });
});

async function ready(screen: ReturnType<typeof renderScreen>) {
  await screen.findByTestId("report-title");
  await act(async () => undefined);
}

describe("a routine report", () => {
  it("takes a room, a title and one tap: the safe defaults go to the server with a request key", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    expect(screen.getByTestId("report-location")).toHaveTextContent(has("report.location.roomLabel:room=312"));
    fireEvent.changeText(screen.getByTestId("report-title"), "Bathroom sink leaking");
    fireEvent.press(screen.getByTestId("report-submit"));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ title: "Bathroom sink leaking", room_id: "r-312", category: "general", priority: "normal", source: "self", client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(sent()).not.toHaveProperty("room_unavailability");
    expect(sent()).not.toHaveProperty("assigned_to");
  });

  it("confirms from the server's answer with its work order number, and opens that work order", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Bathroom sink leaking");
    fireEvent.press(screen.getByTestId("report-submit"));

    const done = await screen.findByTestId("report-created");
    expect(done).toHaveTextContent(has("report.success.title"));
    expect(done).toHaveTextContent(has("WO-1042"));
    expect(done).toHaveTextContent(has("Bathroom sink leaking"));
    expect(done).toHaveTextContent(has("workOrders.status.open"));
    fireEvent.press(screen.getByTestId("report-view"));
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "wo-1" } });
  });

  it("goes back to where the person came from", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "x");
    fireEvent.press(screen.getByTestId("report-submit"));
    fireEvent.press(await screen.findByTestId("report-back"));
    expect(screen.getByTestId("report-back")).toHaveTextContent("report.success.backRoom");
    expect(router.back).toHaveBeenCalled();
  });

  it("asks for what is missing and sends nothing", async () => {
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByText("report.errors.location_required")).toBeTruthy();
    expect(screen.getByText("report.errors.title_required")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("two taps send one request", async () => {
    mockParams = ROOM_PARAMS;
    let resolveIt!: (v: unknown) => void;
    create.mockReturnValue(new Promise((res) => (resolveIt = res)));
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => resolveIt(created()));
  });
});

describe("choosing where, what and how urgent", () => {
  it("finds a guest room on the server and files the report against its canonical id", async () => {
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-location"));
    fireEvent.changeText(await screen.findByTestId("report-location-search"), "205");
    await waitFor(() => expect((fetchRoomBoard as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ q: "205" }));
    fireEvent.press(await screen.findByTestId("report-location-room-205"));
    fireEvent.changeText(screen.getByTestId("report-title"), "Door sticks");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ room_id: "r-205", title: "Door sticks" });
    expect(sent()).not.toHaveProperty("location_text");
  });

  it("takes a place that isn't a guest room as text", async () => {
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-location"));
    fireEvent.press(await screen.findByTestId("report-location-tab-other"));
    fireEvent.press(screen.getByTestId("report-location-suggestion-pool"));
    fireEvent.press(screen.getByTestId("report-location-use-text"));
    fireEvent.changeText(screen.getByTestId("report-title"), "Gate latch broken");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ location_text: "report.location.suggestions.pool" });
    expect(sent()).not.toHaveProperty("room_id");
  });

  it("offers every category in a readable list (not a row of chips) and sends the chosen value", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-category"));
    for (const key of ["hvac", "plumbing", "electrical", "doors_locks", "appliance", "furniture", "structural", "painting", "safety", "general"]) {
      expect(await screen.findByTestId(`report-category-sheet-${key}`)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId("report-category-sheet-plumbing"));
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ category: "plumbing" });
  });

  it("shows all four priorities with their meaning, and Normal is the default", async () => {
    const screen = renderScreen();
    await ready(screen);
    for (const p of ["emergency", "urgent", "normal", "low"]) expect(screen.getByTestId(`report-priority-${p}`)).toBeTruthy();
    expect(screen.getByTestId("report-priority-normal").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("report-priority-urgent").props.accessibilityLabel).toMatch(/report.priority.hints.urgent/);
  });

  it("Emergency needs a deliberate confirmation and never takes the room down by itself", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Water everywhere");
    fireEvent.press(screen.getByTestId("report-priority-emergency"));
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByText("report.errors.emergency_unconfirmed")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("report-emergency-confirm"));
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ priority: "emergency" });
    expect(sent()).not.toHaveProperty("room_unavailability");
  });

  it("switching away from Emergency drops its confirmation", async () => {
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-priority-emergency"));
    fireEvent.press(screen.getByTestId("report-emergency-confirm"));
    fireEvent.press(screen.getByTestId("report-priority-urgent"));
    expect(screen.queryByTestId("report-emergency-confirm")).toBeNull();
    fireEvent.press(screen.getByTestId("report-priority-emergency"));
    expect(screen.getByTestId("report-emergency-confirm").props.accessibilityState).toMatchObject({ checked: false });
  });
});

describe("started from equipment", () => {
  const ASSET_PARAMS = { from: "asset", assetId: "a1", assetName: "PTAC Unit", assetCategory: "HVAC", assetRoomId: "r-312", assetRoomNumber: "312", assetLocation: "Bedroom" };

  it("links the canonical equipment id, its room and its trade, and leaves the issue for the person to describe", async () => {
    mockParams = ASSET_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    expect(screen.getByTestId("report-title").props.value).toBe("");
    expect(screen.getByTestId("report-asset-note")).toHaveTextContent(has("report.fields.forEquipment:name=PTAC Unit"));
    fireEvent.changeText(screen.getByTestId("report-title"), "No cooling");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ asset_id: "a1", room_id: "r-312", category: "hvac", title: "No cooling" });
  });

  it("will not file the report if the location was changed to a room the equipment isn't in", async () => {
    mockParams = ASSET_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-location"));
    fireEvent.press(await screen.findByTestId("report-location-room-101"));
    fireEvent.changeText(screen.getByTestId("report-title"), "No cooling");
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByText("report.errors.asset_room_mismatch")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("carries a preventive-maintenance source from a PM defect", async () => {
    mockParams = { ...ASSET_PARAMS, source: "pm", title: "Filter clogged" };
    const screen = renderScreen();
    await ready(screen);
    expect(screen.getByTestId("report-title").props.value).toBe("Filter clogged");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ source: "pm", asset_id: "a1" });
  });
});

describe("when the report can't be sent", () => {
  it("keeps what was typed, says the answer is unknown, and a retry reuses the same key", async () => {
    mockParams = ROOM_PARAMS;
    create.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce(created({ replayed: true }));
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByTestId("report-failure")).toHaveTextContent("report.errors.ambiguous");
    expect(screen.getByTestId("report-title").props.value).toBe("Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    await screen.findByTestId("report-created");
    expect(sent(0).client_request_id).toBe(sent(1).client_request_id);
    expect(screen.getByTestId("report-created")).toHaveTextContent(has("report.success.replayedBody"));
  });

  it("shows the server's reason for a refusal and keeps the form", async () => {
    mockParams = ROOM_PARAMS;
    create.mockRejectedValue(refusal(422, "Room not found"));
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByTestId("report-failure")).toHaveTextContent("Room not found");
    expect(screen.queryByTestId("report-created")).toBeNull();
  });

  it("tells a role that isn't allowed so, in plain words", async () => {
    mockParams = ROOM_PARAMS;
    create.mockRejectedValue(refusal(403, "Forbidden"));
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByTestId("report-failure")).toHaveTextContent("report.errors.forbidden");
  });
});

describe("offline", () => {
  it("offers to save on this device, queues it, and says it has not been accepted yet", async () => {
    mockOnline = false;
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    expect(screen.getByTestId("report-offline")).toBeTruthy();
    expect(screen.getByTestId("report-submit")).toHaveTextContent("report.submitOffline");
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));

    const queued = await screen.findByTestId("report-queued");
    expect(queued).toHaveTextContent(has("report.success.queuedTitle"));
    expect(queued).toHaveTextContent(has("report.success.queuedBody"));
    expect(queued).toHaveTextContent(has("report.success.statusQueued"));
    expect(queued).not.toHaveTextContent(has("WO-"));
    expect(screen.queryByTestId("report-view")).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith("work_order", "create", expect.objectContaining({ title: "Leak", room_id: "r-312" }), expect.stringMatching(/^eng-report:/));
  });

  it("says plainly that photos are not saved offline, and how many were left out", async () => {
    mockOnline = false;
    mockParams = ROOM_PARAMS;
    (pickPhoto as jest.Mock).mockResolvedValue({ ok: true, uri: "file:///a.jpg" });
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-photo-camera"));
    expect(await screen.findByTestId("report-photo-offline")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByTestId("report-photos-dropped")).toHaveTextContent("report.success.photosNotSaved:count=1");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("photos", () => {
  it("previews, captions and removes before sending, then uploads to the new work order", async () => {
    mockParams = ROOM_PARAMS;
    (pickPhoto as jest.Mock).mockResolvedValueOnce({ ok: true, uri: "file:///a.jpg" }).mockResolvedValueOnce({ ok: true, uri: "file:///b.jpg" });
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-photo-camera"));
    fireEvent.press(await screen.findByTestId("report-photo-library"));
    await screen.findByTestId("report-photo-caption-1");
    fireEvent.changeText(screen.getByTestId("report-photo-caption-0"), "Under the sink");
    fireEvent.press(screen.getByTestId("report-photo-remove-1"));
    expect(screen.queryByTestId("report-photo-caption-1")).toBeNull();

    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    await screen.findByTestId("report-created");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("wo-1", "file:///a.jpg?small", expect.objectContaining({ caption: "Under the sink" }));
  });

  it("reports a partial success when a photo fails, and retries only the photo (no second work order)", async () => {
    mockParams = ROOM_PARAMS;
    (pickPhoto as jest.Mock).mockResolvedValue({ ok: true, uri: "file:///a.jpg" });
    upload.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-photo-camera"));
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));

    expect(await screen.findByTestId("report-photos-failed")).toHaveTextContent(has("report.success.photosFailed:count=1"));
    expect(screen.getByTestId("report-created")).toHaveTextContent(has("report.success.title"));
    fireEvent.press(screen.getByTestId("report-retry-photos"));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("report-photos-failed")).toBeNull());
    expect(upload).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("explains a denied camera permission instead of failing silently", async () => {
    (pickPhoto as jest.Mock).mockResolvedValue({ ok: false, reason: "permission_denied" });
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-photo-camera"));
    expect(await screen.findByText("workOrders.repair.evidence.pick.permission_denied")).toBeTruthy();
  });
});

describe("More options", () => {
  it("is collapsed until asked for, so the routine report stays short", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    expect(screen.queryByTestId("report-more")).toBeNull();
    fireEvent.press(screen.getByTestId("report-more-toggle"));
    expect(screen.getByTestId("report-more")).toBeTruthy();
    expect(screen.getByTestId("report-source")).toBeTruthy();
  });

  it("lets an engineer assign the repair to themselves, and nobody else", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-more-toggle"));
    fireEvent(screen.getByTestId("report-assign-me"), "valueChange", true);
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ assigned_to: "u1" });
  });

  it("gives the chief engineer no self-assignment and no room-down option (the API refuses both)", async () => {
    mockRole = "chief_engineer";
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-more-toggle"));
    expect(screen.queryByTestId("report-assign-me")).toBeNull();
    expect(screen.queryByTestId("report-room-down")).toBeNull();
  });

  it("offers the room-down option only for a guest room and only while online", async () => {
    const guest = renderScreen();
    await ready(guest);
    fireEvent.press(guest.getByTestId("report-more-toggle"));
    expect(guest.queryByTestId("report-room-down")).toBeNull();
    guest.unmount();

    mockParams = ROOM_PARAMS;
    mockOnline = false;
    const offline = renderScreen();
    await ready(offline);
    fireEvent.press(offline.getByTestId("report-more-toggle"));
    expect(offline.queryByTestId("report-room-down")).toBeNull();
  });

  it("sets a repeat-failure link from an earlier repair", async () => {
    mockParams = ROOM_PARAMS;
    const { listRoomRepairHistory } = jest.requireMock("@/lib/api/engineeringRooms");
    listRoomRepairHistory.mockResolvedValue({ orders: [{ id: "wo-old", title: "Earlier leak", status: "completed", work_order_number: "900" }], hasMore: false });
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-more-toggle"));
    fireEvent.press(screen.getByTestId("report-repeat"));
    fireEvent.press(await screen.findByTestId("report-repeat-wo-old"));
    expect(await screen.findByTestId("report-repeat-chosen")).toHaveTextContent(has("Earlier leak"));
    fireEvent.changeText(screen.getByTestId("report-title"), "Leak again");
    fireEvent.press(screen.getByTestId("report-submit"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(sent()).toMatchObject({ repeat_of_work_order_id: "wo-old" });
  });
});

describe("taking the room down together with the report", () => {
  async function chooseRoomDown(screen: ReturnType<typeof renderScreen>) {
    fireEvent.press(screen.getByTestId("report-more-toggle"));
    fireEvent(screen.getByTestId("report-room-down"), "valueChange", true);
    fireEvent.press(await screen.findByTestId("report-down-type-OUT_OF_ORDER"));
    fireEvent.press(await screen.findByTestId("report-down-reason-PLUMBING"));
    fireEvent.press(screen.getByTestId("report-down-return-in_4h"));
  }

  it("is a separate, reviewed step: nothing is sent until the impact is confirmed", async () => {
    mockParams = ROOM_PARAMS;
    (getActiveRoomPeriod as jest.Mock).mockResolvedValue({ id: "p1", status: "ACTIVE" });
    const screen = renderScreen();
    await ready(screen);
    await chooseRoomDown(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Burst pipe");
    expect(screen.getByTestId("report-submit")).toHaveTextContent("report.submitReview");
    fireEvent.press(screen.getByTestId("report-submit"));

    const confirm = await screen.findByTestId("report-review-confirm");
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("report-review-sheet")).toHaveTextContent(has("report.review.body:room=312,type=engRooms.down.types.OUT_OF_ORDER"));
    fireEvent.press(confirm);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sent().room_unavailability).toMatchObject({ room_id: "r-312", type: "OUT_OF_ORDER", reason_code: "PLUMBING", reason_label: "Plumbing", source: "MOBILE" });
    expect(await screen.findByTestId("report-room-down-result")).toHaveTextContent(has("report.success.roomDownConfirmed"));
  });

  it("does not claim the room is down when the room shows no record afterwards", async () => {
    mockParams = ROOM_PARAMS;
    (getActiveRoomPeriod as jest.Mock).mockResolvedValue(null);
    const screen = renderScreen();
    await ready(screen);
    await chooseRoomDown(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Burst pipe");
    fireEvent.press(screen.getByTestId("report-submit"));
    fireEvent.press(await screen.findByTestId("report-review-confirm"));
    expect(await screen.findByTestId("report-room-down-result")).toHaveTextContent(has("report.success.roomDownUnconfirmed"));
    expect(screen.getByTestId("report-room-down-result")).not.toHaveTextContent(has("roomDownConfirmed"));
  });

  it("an incomplete room-down request blocks the whole report with the missing fields named", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-more-toggle"));
    fireEvent(screen.getByTestId("report-room-down"), "valueChange", true);
    fireEvent.changeText(screen.getByTestId("report-title"), "Burst pipe");
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByText("engRooms.down.errors.type_required")).toBeTruthy();
    expect(screen.queryByTestId("report-review-confirm")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("leaving and drafts", () => {
  it("leaves at once when nothing was typed", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.press(screen.getByTestId("report-back-button"));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("report-discard-sheet")).toBeNull();
  });

  it("protects typed work: asks first, and 'keep editing' stays", async () => {
    mockParams = ROOM_PARAMS;
    const screen = renderScreen();
    await ready(screen);
    fireEvent.changeText(screen.getByTestId("report-title"), "Half typed");
    fireEvent.press(screen.getByTestId("report-back-button"));
    expect(await screen.findByTestId("report-discard-sheet")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("report-discard-keep"));
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByTestId("report-title").props.value).toBe("Half typed");
  });

  it("'discard' really clears the draft; 'leave and keep draft' keeps it for next time", async () => {
    const first = renderScreen();
    await ready(first);
    fireEvent.changeText(first.getByTestId("report-title"), "Keep me");
    fireEvent.press(first.getByTestId("report-back-button"));
    fireEvent.press(await first.findByTestId("report-discard-save"));
    expect(router.back).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await AsyncStorage.getItem("@patelrep/eng_report_draft:h1:u1")).not.toBeNull());
    first.unmount();

    const second = renderScreen();
    await ready(second);
    expect(await second.findByTestId("report-restored")).toBeTruthy();
    expect(second.getByTestId("report-title").props.value).toBe("Keep me");
    fireEvent.press(second.getByTestId("report-back-button"));
    fireEvent.press(await second.findByTestId("report-discard-discard"));
    await waitFor(async () => expect(await AsyncStorage.getItem("@patelrep/eng_report_draft:h1:u1")).toBeNull());
  });
});
