import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";

const mockParams: { roomId?: string } = { roomId: "r-312" };
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
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/lib/api/engineeringRooms", () => ({
  fetchRoomRow: jest.fn(),
  getActiveRoomPeriod: jest.fn(),
  listRoomActiveRepairs: jest.fn(),
  listRoomAssets: jest.fn(),
  listRoomPeriods: jest.fn(),
  listRoomRepairHistory: jest.fn(),
  listAvailabilityReasons: jest.fn(),
  createRoomUnavailability: jest.fn(),
  updateExpectedReturn: jest.fn(),
  releaseRoomUnavailability: jest.fn(),
}));
let mockOnline = true;
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", role: mockRole, tenant_id: "h1" } })),
  };
});

import { router } from "expo-router";
import { api } from "@/lib/api/client";
import * as roomsApi from "@/lib/api/engineeringRooms";
import EngineeringRoomDetailScreen from "@/app/(app)/room-status/[roomId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import { resetRoomBoardCache, takeRoomBoardStale } from "@/lib/engineering/useRoomBoard";
import type { RoomBoardRow } from "@/lib/engineering/roomModel";

const rooms = roomsApi as unknown as Record<string, jest.Mock>;
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const apiError = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });

const REASONS = [
  { id: "1", code: "PLUMBING", label: "Plumbing" },
  { id: "2", code: "HVAC", label: "HVAC" },
];
const FUTURE = new Date(Date.now() + 6 * 3_600_000).toISOString();

const ROW: RoomBoardRow = {
  id: "r-312",
  room_number: "312",
  floor: 3,
  building: "A",
  room_type: { name: "King", code: "K" },
  occupancy: "occupied",
  housekeeping_status: "DIRTY",
  availability: null,
  unavailability: null,
  active_repair_count: 1,
  others_active_count: 0,
  top_priority: "urgent",
  top_repair: { id: "wo-1042", work_order_number: "1042", title: "AC not cooling", priority: "urgent", status: "in_progress" },
  last_activity_at: "2026-10-31T10:00:00Z",
  status_updated_at: null,
};
const PERIOD = {
  id: "p-1",
  type: "OUT_OF_ORDER" as const,
  status: "ACTIVE" as const,
  reason_code: "PLUMBING",
  reason_label: "Plumbing",
  started_at: "2026-10-30T10:00:00Z",
  expected_return_at: FUTURE,
  primary_work_order_id: "wo-1045",
  work_orders: { id: "wo-1045", work_order_number: "1045", title: "Plumbing leak", status: "completed", priority: "urgent" },
};
const DOWN_ROW: RoomBoardRow = { ...ROW, availability: "out_of_order", unavailability: { id: "p-1", type: "OUT_OF_ORDER", expected_return_at: FUTURE } };
const REPAIR = { id: "wo-1042", title: "AC not cooling", status: "in_progress", priority: "urgent", work_order_number: "1042", created_at: "2026-10-31T08:00:00Z" };
const ASSET = { id: "a1", name: "PTAC Unit", asset_tag: "AC-312", asset_categories: { name: "HVAC" }, service_status: "operational", active_work_order_count: 1 };

function serve(over: Record<string, unknown> = {}) {
  rooms.fetchRoomRow.mockResolvedValue("row" in over ? over.row : ROW);
  rooms.getActiveRoomPeriod.mockResolvedValue("period" in over ? over.period : null);
  rooms.listRoomActiveRepairs.mockResolvedValue("repairs" in over ? over.repairs : [REPAIR]);
  rooms.listRoomAssets.mockResolvedValue("assets" in over ? over.assets : { assets: [ASSET], truncated: false });
  rooms.listRoomPeriods.mockResolvedValue("periods" in over ? over.periods : []);
  rooms.listRoomRepairHistory.mockResolvedValue("history" in over ? over.history : { orders: [], hasMore: false });
  rooms.listAvailabilityReasons.mockResolvedValue(REASONS);
}

const renderScreen = () =>
  render(
    <ThemeProvider>
      <EngineeringRoomDetailScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.roomId = "r-312";
  mockOnline = true;
  mockRole = "engineer";
  resetAsyncResourceCache();
  resetRoomBoardCache();
  takeRoomBoardStale();
  serve();
});

describe("Room Detail", () => {
  it("shows the room, and keeps occupancy, housekeeping, out-of-order record and repairs as separate facts", async () => {
    const screen = renderScreen();
    expect(await screen.findByTestId("room-detail-number")).toHaveTextContent("312");
    const overview = screen.getByTestId("room-overview");
    expect(overview).toHaveTextContent(has("engRooms.detail.occupancy"));
    expect(overview).toHaveTextContent(has("engRooms.occupancy.occupied"));
    expect(overview).toHaveTextContent(has("roomStatus.statusLabels.DIRTY"));
    expect(overview).toHaveTextContent(has("engRooms.detail.noDownRecord"));
    expect(overview).toHaveTextContent(has("engRooms.detail.separateNote"));
    expect(screen.queryByText(/sellable|available for sale/i)).toBeNull();
  });

  it("an occupied room can have an active repair without being out of order", async () => {
    const screen = renderScreen();
    await screen.findByTestId("room-repairs");
    expect(screen.queryByTestId("room-availability-badge")).toBeNull();
    expect(screen.getByTestId("room-availability")).toHaveTextContent(has("engRooms.detail.noDownBody"));
  });

  it("lists active repairs and opens the repair workspace for the tapped one", async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("room-repair-wo-1042"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "wo-1042" } });
  });

  it("opens the report form for this room with its id and number", async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("room-quick-report"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/new", params: { roomId: "r-312", roomNumber: "312", floor: "3" } });
  });

  it("lists the equipment registered to the room and opens it; a room with none says so rather than inventing any", async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("room-asset-a1"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a1" } });

    resetAsyncResourceCache();
    serve({ assets: { assets: [], truncated: false } });
    const empty = renderScreen();
    expect(await empty.findByText("engRooms.detail.noEquipment")).toBeTruthy();
  });

  it("pages the repair history from the server and shows finished repairs, without mixing in the availability record", async () => {
    rooms.listRoomRepairHistory.mockImplementation(async (_id: string, pageNo: number) =>
      pageNo === 1
        ? { orders: [{ id: "h1", title: "Capacitor replaced", status: "completed", updated_at: "2026-08-12T10:00:00Z" }], hasMore: true }
        : { orders: [{ id: "h2", title: "Outlet repaired", status: "completed", updated_at: "2026-05-03T10:00:00Z" }], hasMore: false },
    );
    const screen = renderScreen();
    expect(await screen.findByTestId("room-history-h1")).toHaveTextContent(has("Capacitor replaced"));
    fireEvent.press(screen.getByTestId("room-history-more"));
    expect(await screen.findByTestId("room-history-h2")).toBeTruthy();
    expect(rooms.listRoomRepairHistory).toHaveBeenLastCalledWith("r-312", 2);
    expect(screen.queryByTestId("room-history-more")).toBeNull();
    fireEvent.press(screen.getByTestId("room-history-h2"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "h2" } });
  });

  it("shows past out-of-order periods from the server as their own list", async () => {
    serve({ periods: [{ id: "old", type: "OUT_OF_SERVICE", status: "RELEASED", reason_label: "HVAC", started_at: "2026-09-01T10:00:00Z", actual_return_at: "2026-09-02T10:00:00Z" }, PERIOD] });
    const screen = renderScreen();
    const past = await screen.findByTestId("room-period-old");
    expect(past).toHaveTextContent(has("engRooms.down.types.OUT_OF_SERVICE"));
    expect(screen.queryByTestId("room-period-p-1")).toBeNull();
  });
});

describe("rooms that can't be shown", () => {
  it("says the room wasn't found (another property's room, or one that no longer exists)", async () => {
    serve({ row: null });
    const screen = renderScreen();
    expect(await screen.findByText("engRooms.detail.notFound")).toBeTruthy();
    expect(screen.queryByTestId("room-overview")).toBeNull();
  });

  it("says the role is not allowed instead of an empty room", async () => {
    rooms.fetchRoomRow.mockRejectedValue(apiError(403, "Forbidden"));
    const screen = renderScreen();
    expect(await screen.findByText("engineeringState.forbidden")).toBeTruthy();
    expect(screen.queryByText("engRooms.detail.notFound")).toBeNull();
  });

  it("offers Retry after a failed load", async () => {
    rooms.fetchRoomRow.mockRejectedValueOnce(apiError(500));
    const screen = renderScreen();
    expect(await screen.findByText("engRooms.detail.loadFailed")).toBeTruthy();
    fireEvent.press(screen.getByText("common.retry"));
    expect(await screen.findByTestId("room-detail-number")).toBeTruthy();
  });

  it("one failing section doesn't blank the others", async () => {
    rooms.listRoomAssets.mockRejectedValue(apiError(500));
    const screen = renderScreen();
    expect(await screen.findByText("engRooms.detail.equipmentFailed")).toBeTruthy();
    expect(screen.getByTestId("room-repair-wo-1042")).toBeTruthy();
    expect(screen.getByTestId("room-overview")).toBeTruthy();
  });

  it("tells a line engineer how many repairs are held by colleagues without exposing them", async () => {
    serve({ row: { ...ROW, others_active_count: 2 } });
    const screen = renderScreen();
    expect(await screen.findByTestId("room-repairs")).toHaveTextContent(has("engRooms.withColleagues:count=2"));
  });
});

describe("who can change availability", () => {
  it("the chief engineer can look but not change", async () => {
    mockRole = "chief_engineer";
    serve({ row: DOWN_ROW, period: PERIOD });
    const screen = renderScreen();
    await screen.findByTestId("room-availability");
    expect(screen.queryByTestId("room-manage-availability")).toBeNull();
    expect(screen.queryByTestId("room-release")).toBeNull();
    expect(screen.queryByTestId("room-update-eta")).toBeNull();
    expect(screen.queryByTestId("room-quick-availability")).toBeNull();
    expect(screen.getByTestId("room-availability")).toHaveTextContent(has("engRooms.detail.readOnly"));
  });

  it("the engineer sees Manage Room Availability, and it opens a structured sheet instead of changing anything", async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("room-manage-availability"));
    expect(await screen.findByTestId("availability-sheet")).toBeTruthy();
    expect(rooms.createRoomUnavailability).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("is off while offline, with the reason, because it is never saved for later", async () => {
    mockOnline = false;
    const screen = renderScreen();
    const button = await screen.findByTestId("room-manage-availability");
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("room-availability")).toHaveTextContent(has("engRooms.manage.offline"));
  });
});

async function openManage(screen: ReturnType<typeof renderScreen>) {
  fireEvent.press(await screen.findByTestId("room-manage-availability"));
  await screen.findByTestId("availability-sheet");
  await screen.findByTestId("availability-reason-PLUMBING");
}

function fillValid(screen: ReturnType<typeof renderScreen>, type: "OUT_OF_ORDER" | "OUT_OF_SERVICE" = "OUT_OF_SERVICE") {
  fireEvent.press(screen.getByTestId(`availability-type-${type}`));
  fireEvent.press(screen.getByTestId("availability-reason-PLUMBING"));
  fireEvent.press(screen.getByTestId("availability-return-in_4h"));
}

describe("Manage Room Availability", () => {
  it("won't continue without a type, a reason and an expected return, and says which are missing", async () => {
    const screen = renderScreen();
    await openManage(screen);
    fireEvent.press(screen.getByTestId("availability-review"));
    for (const key of ["type_required", "reason_required", "return_required"]) expect(await screen.findByText(`engRooms.down.errors.${key}`)).toBeTruthy();
    expect(screen.queryByTestId("availability-confirm")).toBeNull();
    expect(rooms.createRoomUnavailability).not.toHaveBeenCalled();
  });

  it("an Out of Service request is reviewed first, then sent to the dedicated API with the hotel's reason, the mobile source and the chosen repair", async () => {
    rooms.createRoomUnavailability.mockImplementation(async (body: { type: string; reason_code: string; expected_return_at: string }) => ({
      period: { id: "p-new", type: body.type, reason_code: body.reason_code, expected_return_at: body.expected_return_at, status: "ACTIVE" },
      room_status: { status: "OOO" },
    }));
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen, "OUT_OF_SERVICE");
    fireEvent.press(screen.getByTestId("availability-repair-wo-1042"));
    fireEvent.changeText(screen.getByTestId("availability-details"), "  Valve stuck ");
    fireEvent.press(screen.getByTestId("availability-review"));

    const sheet = await screen.findByTestId("availability-confirm");
    expect(sheet).toBeTruthy();
    expect(screen.getByText("engRooms.manage.impactOos")).toBeTruthy();
    expect(within(screen.getByTestId("availability-sheet")).getByText("engRooms.pmsNote")).toBeTruthy();
    expect(rooms.createRoomUnavailability).not.toHaveBeenCalled();

    fireEvent.press(sheet);
    await waitFor(() => expect(rooms.createRoomUnavailability).toHaveBeenCalledTimes(1));
    expect(rooms.createRoomUnavailability).toHaveBeenCalledWith(
      expect.objectContaining({ room_id: "r-312", type: "OUT_OF_SERVICE", reason_code: "PLUMBING", reason_label: "Plumbing", details: "Valve stuck", primary_work_order_id: "wo-1042", source: "MOBILE" }),
    );
    expect(await screen.findByTestId("availability-result")).toHaveTextContent(has("engRooms.manage.doneTitle"));
    expect(screen.getByTestId("availability-result")).toHaveTextContent(has("engRooms.manage.doneBody:room=312,type=engRooms.down.types.OUT_OF_SERVICE"));
    expect(screen.getByTestId("availability-result")).toHaveTextContent(has("engRooms.manage.serverState"));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("an Out of Order request is sent as OUT_OF_ORDER, not interchangeably with out of service", async () => {
    rooms.createRoomUnavailability.mockImplementation(async (body: { type: string; reason_code: string; expected_return_at: string }) => ({
      period: { id: "p-new", type: body.type, reason_code: body.reason_code, expected_return_at: body.expected_return_at },
      room_status: { status: "OOO" },
    }));
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen, "OUT_OF_ORDER");
    fireEvent.press(screen.getByTestId("availability-review"));
    expect(await screen.findByText("engRooms.manage.impactOoo")).toBeTruthy();
    fireEvent.press(screen.getByTestId("availability-confirm"));
    await waitFor(() => expect(rooms.createRoomUnavailability).toHaveBeenCalledWith(expect.objectContaining({ type: "OUT_OF_ORDER" })));
  });

  it("refreshes the room and marks the board stale only after the server confirmed", async () => {
    rooms.createRoomUnavailability.mockImplementation(async (body: { type: string; reason_code: string; expected_return_at: string }) => ({
      period: { id: "p-new", type: body.type, reason_code: body.reason_code, expected_return_at: body.expected_return_at },
      room_status: { status: "OOO" },
    }));
    const screen = renderScreen();
    await openManage(screen);
    takeRoomBoardStale();
    const reads = rooms.fetchRoomRow.mock.calls.length;
    fillValid(screen);
    fireEvent.press(screen.getByTestId("availability-review"));
    fireEvent.press(await screen.findByTestId("availability-confirm"));
    await screen.findByTestId("availability-result");
    await waitFor(() => expect(rooms.fetchRoomRow.mock.calls.length).toBeGreaterThan(reads));
    expect(takeRoomBoardStale()).toBe(true);
  });

  it("does not report success when the room was already down: it says the request was not applied", async () => {
    rooms.createRoomUnavailability.mockResolvedValue({
      period: { id: "p-other", type: "OUT_OF_ORDER", reason_code: "HVAC", expected_return_at: "2030-01-01T10:00:00Z" },
      room_status: { status: "OOO" },
    });
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen, "OUT_OF_SERVICE");
    fireEvent.press(screen.getByTestId("availability-review"));
    fireEvent.press(await screen.findByTestId("availability-confirm"));
    const result = await screen.findByTestId("availability-result");
    expect(result).toHaveTextContent(has("engRooms.manage.alreadyTitle"));
    expect(result).not.toHaveTextContent(has("engRooms.manage.doneTitle"));
  });

  it("keeps the form and shows the server's reason when the request is refused, and allows another try", async () => {
    rooms.createRoomUnavailability.mockRejectedValueOnce(apiError(403, "Not allowed to change this room"));
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen);
    fireEvent.press(screen.getByTestId("availability-review"));
    fireEvent.press(await screen.findByTestId("availability-confirm"));
    expect(await screen.findByTestId("availability-error")).toHaveTextContent("Not allowed to change this room");
    expect(screen.queryByTestId("availability-result")).toBeNull();
    expect(screen.getByTestId("availability-confirm").props.accessibilityState).not.toMatchObject({ disabled: true });
    expect(rooms.getActiveRoomPeriod).toHaveBeenCalledTimes(1); // only the screen's own read: a refusal needs no reconciliation
  });

  it("after a lost answer, asks the room before saying anything: a matching record is confirmed, no record means nothing was saved", async () => {
    rooms.createRoomUnavailability.mockRejectedValue(new Error("Network request failed"));
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen);
    fireEvent.press(screen.getByTestId("availability-review"));
    rooms.getActiveRoomPeriod.mockResolvedValueOnce(null);
    fireEvent.press(await screen.findByTestId("availability-confirm"));
    expect(await screen.findByTestId("availability-error")).toHaveTextContent("engRooms.down.notRecorded");
    expect(screen.queryByTestId("availability-result")).toBeNull();

    const sent = rooms.createRoomUnavailability.mock.calls[0][0] as { type: string; reason_code: string; expected_return_at: string };
    rooms.getActiveRoomPeriod.mockResolvedValueOnce({ id: "p-saved", type: sent.type, reason_code: sent.reason_code, expected_return_at: sent.expected_return_at, status: "ACTIVE" });
    fireEvent.press(screen.getByTestId("availability-confirm"));
    expect(await screen.findByTestId("availability-result")).toHaveTextContent(has("engRooms.manage.doneTitle"));
  });

  it("two quick taps send one request", async () => {
    let resolveIt!: (v: unknown) => void;
    rooms.createRoomUnavailability.mockReturnValue(new Promise((res) => (resolveIt = res)));
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen);
    fireEvent.press(screen.getByTestId("availability-review"));
    const confirm = await screen.findByTestId("availability-confirm");
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    expect(rooms.createRoomUnavailability).toHaveBeenCalledTimes(1);
    await act(async () => {
      const body = rooms.createRoomUnavailability.mock.calls[0][0];
      resolveIt({ period: { id: "p", type: body.type, reason_code: body.reason_code, expected_return_at: body.expected_return_at }, room_status: { status: "OOO" } });
    });
  });

  it("an answer the app can't read is not treated as success", async () => {
    rooms.createRoomUnavailability.mockResolvedValue({});
    const screen = renderScreen();
    await openManage(screen);
    fillValid(screen);
    fireEvent.press(screen.getByTestId("availability-review"));
    fireEvent.press(await screen.findByTestId("availability-confirm"));
    await screen.findByTestId("availability-error");
    expect(screen.queryByTestId("availability-result")).toBeNull();
  });

  it("a record that has no matching reason in the hotel's list can't be submitted", async () => {
    rooms.listAvailabilityReasons.mockResolvedValue([]);
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("room-manage-availability"));
    await screen.findByTestId("availability-sheet");
    expect(await screen.findByText("engRooms.down.reasonsLoading")).toBeTruthy();
    fireEvent.press(screen.getByTestId("availability-review"));
    expect(rooms.createRoomUnavailability).not.toHaveBeenCalled();
  });
});

describe("a room that is out of order", () => {
  it("shows the active record, the expected return as an estimate, and the PMS caveat", async () => {
    serve({ row: DOWN_ROW, period: PERIOD });
    const screen = renderScreen();
    const panel = await screen.findByTestId("room-availability");
    expect(within(panel).getByTestId("room-availability-badge")).toHaveTextContent(has("engRooms.availability.out_of_order"));
    expect(panel).toHaveTextContent(has("Plumbing"));
    expect(panel).toHaveTextContent(has("engRooms.down.estimateNote"));
    expect(panel).toHaveTextContent(has("engRooms.pmsNote"));
    expect(panel).not.toHaveTextContent(/synced|sent to the PMS|confirmed by the PMS/i);
  });

  it("a status that says down with no PatelRep record is shown honestly and offers to record it", async () => {
    serve({ row: { ...ROW, availability: "unrecorded_down" }, period: null });
    const screen = renderScreen();
    const panel = await screen.findByTestId("room-availability");
    expect(panel).toHaveTextContent(has("engRooms.detail.unrecorded"));
    expect(screen.getByTestId("room-record-down")).toBeTruthy();
  });
});

describe("Review Room Restoration", () => {
  async function openRelease(screen: ReturnType<typeof renderScreen>) {
    fireEvent.press(await screen.findByTestId("room-release"));
    await screen.findByTestId("release-sheet");
  }

  it("is blocked while the repair the room was taken down for is still open, however many boxes are ticked", async () => {
    serve({ row: DOWN_ROW, period: { ...PERIOD, work_orders: { ...PERIOD.work_orders, status: "in_progress" } } });
    const screen = renderScreen();
    await openRelease(screen);
    expect(screen.getByTestId("release-blocked")).toBeTruthy();
    fireEvent.press(screen.getByTestId("release-verify"));
    expect(screen.getByTestId("release-confirm").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("release-confirm"));
    expect(rooms.releaseRoomUnavailability).not.toHaveBeenCalled();
  });

  it("a completed repair doesn't release the room by itself: the person must confirm they checked it", async () => {
    serve({ row: DOWN_ROW, period: PERIOD });
    const screen = renderScreen();
    await openRelease(screen);
    expect(screen.queryByTestId("release-blocked")).toBeNull();
    expect(screen.getByTestId("release-confirm").props.accessibilityState).toMatchObject({ disabled: true });
    expect(rooms.releaseRoomUnavailability).not.toHaveBeenCalled();
  });

  it("releases through the dedicated endpoint, then reports the status the server set (Dirty), never clean or sellable, and never the PMS", async () => {
    rooms.releaseRoomUnavailability.mockResolvedValue({ period: { id: "p-1", status: "RELEASED" }, room_status: { status: "DIRTY" } });
    serve({ row: { ...DOWN_ROW, active_repair_count: 0 }, period: PERIOD, repairs: [] });
    const screen = renderScreen();
    await openRelease(screen);
    fireEvent.press(screen.getByTestId("release-verify"));
    fireEvent.changeText(screen.getByTestId("release-notes"), "  Replaced valve ");
    expect(screen.getByText("engRooms.release.impact")).toBeTruthy();
    fireEvent.press(screen.getByTestId("release-confirm"));

    await waitFor(() => expect(rooms.releaseRoomUnavailability).toHaveBeenCalledTimes(1));
    expect(rooms.releaseRoomUnavailability).toHaveBeenCalledWith("p-1", { release_notes: "Replaced valve", source: "MOBILE" });
    const result = await screen.findByTestId("release-result");
    expect(result).toHaveTextContent(has("engRooms.release.doneBody:status=roomStatus.statusLabels.DIRTY"));
    expect(result).not.toHaveTextContent(has("roomStatus.statusLabels.CLEAN"));
    expect(result).not.toHaveTextContent(has("roomStatus.statusLabels.INSPECTED"));
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("needs a second acknowledgement while other repairs, including a colleague's, are still open", async () => {
    serve({
      row: { ...DOWN_ROW, others_active_count: 1 },
      period: PERIOD,
      repairs: [REPAIR],
    });
    const screen = renderScreen();
    await openRelease(screen);
    fireEvent.press(screen.getByTestId("release-verify"));
    expect(screen.getByTestId("release-confirm").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("release-acknowledge"));
    expect(screen.getByTestId("release-confirm").props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it("shows the server's refusal and leaves the room as it was", async () => {
    rooms.releaseRoomUnavailability.mockRejectedValue(apiError(403, "Not allowed to return this room"));
    serve({ row: { ...DOWN_ROW, active_repair_count: 0 }, period: PERIOD, repairs: [] });
    rooms.getActiveRoomPeriod.mockResolvedValue(PERIOD);
    const screen = renderScreen();
    await openRelease(screen);
    fireEvent.press(screen.getByTestId("release-verify"));
    fireEvent.press(screen.getByTestId("release-confirm"));
    expect(await screen.findByTestId("release-error")).toHaveTextContent("Not allowed to return this room");
    expect(screen.queryByTestId("release-result")).toBeNull();
  });

  it("after a lost answer, a room that is no longer down is reported as already returned rather than as an error or a fresh success", async () => {
    rooms.releaseRoomUnavailability.mockRejectedValue(new Error("Network request failed"));
    serve({ row: { ...DOWN_ROW, active_repair_count: 0 }, period: PERIOD, repairs: [] });
    const screen = renderScreen();
    await openRelease(screen);
    fireEvent.press(screen.getByTestId("release-verify"));
    rooms.getActiveRoomPeriod.mockResolvedValue(null);
    fireEvent.press(screen.getByTestId("release-confirm"));
    expect(await screen.findByTestId("release-result")).toHaveTextContent(has("engRooms.release.alreadyTitle"));
  });

  it("is unavailable offline, with the reason", async () => {
    mockOnline = false;
    serve({ row: DOWN_ROW, period: PERIOD });
    const screen = renderScreen();
    const button = await screen.findByTestId("room-release");
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe("Update expected return", () => {
  async function openEta(screen: ReturnType<typeof renderScreen>) {
    fireEvent.press(await screen.findByTestId("room-update-eta"));
    await screen.findByTestId("availability-sheet");
  }

  it("moving the return later needs a reason; the server is only called once there is one", async () => {
    rooms.updateExpectedReturn.mockResolvedValue({ period: { id: "p-1" } });
    serve({ row: DOWN_ROW, period: PERIOD });
    const screen = renderScreen();
    await openEta(screen);
    fireEvent.press(screen.getByTestId("eta-return-in_1w"));
    fireEvent.press(screen.getByTestId("availability-eta-confirm"));
    expect(await screen.findByText("engRooms.eta.noteRequired")).toBeTruthy();
    expect(rooms.updateExpectedReturn).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId("eta-note"), "Waiting on parts");
    fireEvent.press(screen.getByTestId("availability-eta-confirm"));
    await waitFor(() => expect(rooms.updateExpectedReturn).toHaveBeenCalledTimes(1));
    expect(rooms.updateExpectedReturn.mock.calls[0][0]).toBe("p-1");
    expect(rooms.updateExpectedReturn.mock.calls[0][2]).toBe("Waiting on parts");
    expect(await screen.findByTestId("availability-result")).toHaveTextContent(has("engRooms.eta.done"));
  });
});
