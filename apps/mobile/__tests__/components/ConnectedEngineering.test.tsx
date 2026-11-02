import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));
jest.mock("@/lib/api/engineeringRooms", () => ({ fetchRoomRow: jest.fn() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

import { router } from "expo-router";
import * as roomsApi from "@/lib/api/engineeringRooms";
import { RoomImpactSheet } from "@/components/engineering/assets/RoomImpactSheet";
import { WorkOrderPmSource } from "@/components/engineering/workorder/WorkOrderPmSource";
import { AssetCard } from "@/components/engineering/assets/AssetCard";
import { AssetHistorySection } from "@/components/engineering/assets/AssetHistorySection";
import { AssetQuickActionsSheet } from "@/components/engineering/assets/AssetQuickActionsSheet";
import type { AssetEvent, AssetRow } from "@/lib/engineering/assetModel";
import { buildRoomImpact } from "@/lib/engineering/roomImpact";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";

const rooms = roomsApi as unknown as Record<string, jest.Mock>;
const push = router.push as jest.Mock;
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);

function wo(over: Partial<WorkOrder> = {}): WorkOrder {
  return { id: "wo1", title: "Coolant low", description: "Weeping at the gasket", status: "open", priority: "urgent", assets: { name: "Chiller" }, ...over } as WorkOrder;
}

beforeEach(() => jest.clearAllMocks());

describe("Work order PM source", () => {
  it("shows nothing for a repair with no PM source, even if its title looks like one", () => {
    const { queryByTestId } = wrap(<WorkOrderPmSource wo={wo({ title: "PM fail: Coolant" })} language="en" timezone="America/Chicago" />);
    expect(queryByTestId("wo-pm-source")).toBeNull();
  });

  it("shows the failed items and recorded defect, and opens the exact original inspection", () => {
    const source = { completion_id: "c1", schedule_id: "s1", schedule_name: "Quarterly check", completed_at: "2026-10-30T15:00:00Z", failed_items: [{ label: "Coolant level", note: "Low" }], evidence_count: 2 };
    const { getByText, getByTestId } = wrap(<WorkOrderPmSource wo={wo({ pm_source: source })} language="en" timezone="America/Chicago" />);
    expect(getByText("Quarterly check")).toBeTruthy();
    expect(getByText("Coolant level: Low")).toBeTruthy();
    expect(getByText("Weeping at the gasket")).toBeTruthy();
    fireEvent.press(getByTestId("wo-pm-source-open"));
    expect(push).toHaveBeenCalledWith("/(app)/pm-schedules/record/c1?scheduleId=s1");
  });

  it("when the lookup failed it says so and offers no link it cannot build", () => {
    const { getByTestId, queryByTestId } = wrap(<WorkOrderPmSource wo={wo({ pm_source: { completion_id: "c1", schedule_id: null, details_unavailable: true } })} language="en" timezone={null} />);
    expect(getByTestId("wo-pm-source-unavailable")).toBeTruthy();
    expect(queryByTestId("wo-pm-source-open")).toBeNull();
  });

  it("refuses to build a link from an unsafe id", () => {
    const { queryByTestId } = wrap(<WorkOrderPmSource wo={wo({ pm_source: { completion_id: "../x", schedule_id: "s1", failed_items: [] } })} language="en" timezone={null} />);
    expect(queryByTestId("wo-pm-source-open")).toBeNull();
  });
});

describe("Room impact", () => {
  const sheet = (impact: ReturnType<typeof buildRoomImpact>) =>
    wrap(<RoomImpactSheet visible impact={impact} assetName="Chiller" assetTag="CH-1" scope="t:u" language="en" timezone="America/Chicago" onClose={jest.fn()} />);

  it("model: keeps only active repairs and refuses a room link without a safe id or a number", () => {
    const done = wo({ id: "wo2", status: "completed" });
    const impact = buildRoomImpact({ roomId: "r1", roomNumber: " 214 ", locationText: null, serviceStatus: "operational", repairs: [wo(), done], activeDowntimeSince: null });
    expect(impact.hasRoom).toBe(true);
    expect(impact.roomNumber).toBe("214");
    expect(impact.activeRepairs.map((r) => r.id)).toEqual(["wo1"]);
    expect(buildRoomImpact({ roomId: "../r", roomNumber: "214", locationText: null, serviceStatus: "operational", repairs: [], activeDowntimeSince: null }).hasRoom).toBe(false);
    expect(buildRoomImpact({ roomId: "r1", roomNumber: null, locationText: "Roof", serviceStatus: "operational", repairs: [], activeDowntimeSince: null }).hasRoom).toBe(false);
  });

  it("shared-area equipment shows its location, reads no room and offers no Open room", () => {
    const { getByTestId, queryByTestId } = sheet(buildRoomImpact({ roomId: null, roomNumber: null, locationText: "Roof", serviceStatus: "operational", repairs: [], activeDowntimeSince: null }));
    expect(getByTestId("room-impact-shared")).toBeTruthy();
    expect(queryByTestId("room-impact-open-room")).toBeNull();
    expect(rooms.fetchRoomRow).not.toHaveBeenCalled();
  });

  it("shows the room's own recorded state, links the repair and the room, and offers no way to change availability", async () => {
    rooms.fetchRoomRow.mockResolvedValue({ id: "r1", room_number: "214", floor: 2, building: "A", occupancy: "vacant", availability: "out_of_order" });
    const { getByTestId, queryByText, findByTestId } = sheet(buildRoomImpact({ roomId: "r1", roomNumber: "214", locationText: null, serviceStatus: "out_of_service", repairs: [wo()], activeDowntimeSince: "2026-11-01T15:00:00Z" }));
    await findByTestId("room-impact-room-state");
    expect(rooms.fetchRoomRow).toHaveBeenCalledWith("r1", expect.anything());
    expect(getByTestId("room-impact-scope")).toBeTruthy();
    expect(queryByText("assets.roomImpact.changeStatus")).toBeNull();
    fireEvent.press(getByTestId("room-impact-wo-wo1"));
    expect(push).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "wo1" } });
    fireEvent.press(getByTestId("room-impact-open-room"));
    await waitFor(() => expect(push).toHaveBeenCalledWith({ pathname: "/(app)/room-status/[roomId]", params: { roomId: "r1" } }));
  });

  it("when the room cannot be read the sheet says so instead of guessing a status", async () => {
    rooms.fetchRoomRow.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    // A different room: the shared read cache keeps the last good answer per room, which is right for a failed refresh.
    const { findByTestId, queryByTestId } = sheet(buildRoomImpact({ roomId: "r9", roomNumber: "216", locationText: null, serviceStatus: "operational", repairs: [], activeDowntimeSince: null }));
    await findByTestId("room-impact-room-unread");
    expect(queryByTestId("room-impact-room-state")).toBeNull();
  });
});

describe("Work order PM source: the step this order was opened for", () => {
  const items = [{ label: "Coolant level", note: "Low" }, { label: "Belt tension", note: null }];
  const source = (over = {}) => ({ completion_id: "c1", schedule_id: "s1", schedule_name: "Quarterly check", failed_items: items, ...over });

  it("leads with the recorded step and lists only the OTHER failures", () => {
    const { getByTestId, getByText, queryByText } = wrap(
      <WorkOrderPmSource wo={wo({ pm_source: source({ this_item: { label: "Coolant level", note: "Low" } }) })} language="en" timezone={null} />,
    );
    expect(getByText("workOrders.pmSource.thisItem")).toBeTruthy();
    expect(getByTestId("wo-pm-source-this-item").props.children).toBe("Coolant level: Low");
    expect(getByText("workOrders.pmSource.alsoFailed:count=1")).toBeTruthy();
    expect(getByText("Belt tension")).toBeTruthy();
    expect(queryByText("workOrders.pmSource.failed:count=2")).toBeNull();
  });

  it("an older order with no recorded step claims none: every failed item is listed as before", () => {
    const { queryByTestId, getByText, queryByText } = wrap(<WorkOrderPmSource wo={wo({ pm_source: source() })} language="en" timezone={null} />);
    expect(queryByTestId("wo-pm-source-this-item")).toBeNull();
    expect(queryByText("workOrders.pmSource.thisItem")).toBeNull();
    expect(getByText("workOrders.pmSource.failed:count=2")).toBeTruthy();
    expect(getByText("Coolant level: Low")).toBeTruthy();
  });

  it("when its step is the only failure there is no 'also failed' heading", () => {
    const { queryByText } = wrap(
      <WorkOrderPmSource wo={wo({ pm_source: source({ failed_items: [items[0]], this_item: items[0] }) })} language="en" timezone={null} />,
    );
    expect(queryByText(/alsoFailed/)).toBeNull();
  });
});

const ev = (type: AssetEvent["type"], n: number, over: Partial<AssetEvent> = {}): AssetEvent =>
  ({ key: `${type}:${n}`, type, at: "2026-10-30T15:00:00Z", label: `L${n}`, ...over }) as AssetEvent;
const resource = { data: [], loading: false, failed: false, reload: jest.fn() };
const historyNode = (events: AssetEvent[]) => (
  <AssetHistorySection events={events} downtime={resource as never} reliability={{ ...resource, data: null } as never} documents={resource as never} language="en" timezone={null} />
);

describe("Asset history filter chips", () => {
  const events = [ev("pm_completed", 1, { recordId: "c1", scheduleId: "s1" }), ev("work_order_created", 2, { workOrderId: "w2" }), ev("repair_completed", 3, { workOrderId: "w2" }), ev("reading_recorded", 4)];

  it("shows a chip only for groups that have events, with their counts, and starts on All", () => {
    const { getByTestId, queryByTestId } = wrap(historyNode(events));
    expect(getByTestId("asset-history-filter-all").props.accessibilityLabel).toBe("assets.history.filter.all, 4");
    expect(getByTestId("asset-history-filter-repairs").props.accessibilityLabel).toBe("assets.history.filter.repairs, 2");
    expect(queryByTestId("asset-history-filter-downtime")).toBeNull();
    expect(getByTestId("asset-history-filter-all").props.accessibilityState.selected).toBe(true);
  });

  it("selecting a group narrows the timeline to exactly that group, and All restores it", () => {
    const { getByTestId, queryByText } = wrap(historyNode(events));
    fireEvent.press(getByTestId("asset-history-filter-repairs"));
    expect(queryByText(/events\.work_order_created/)).toBeTruthy();
    expect(queryByText(/events\.repair_completed/)).toBeTruthy();
    expect(queryByText(/events\.pm_completed/)).toBeNull();
    expect(queryByText(/events\.reading_recorded/)).toBeNull();
    expect(getByTestId("asset-history-filter-repairs").props.accessibilityState.selected).toBe(true);
    fireEvent.press(getByTestId("asset-history-filter-all"));
    expect(queryByText(/events\.pm_completed/)).toBeTruthy();
  });

  it("offers no filter when one group holds everything (nothing to narrow)", () => {
    const { queryByTestId } = wrap(historyNode([ev("pm_completed", 1), ev("pm_completed", 2)]));
    expect(queryByTestId("asset-history-filter")).toBeNull();
  });

  it("a filter that empties after a reload falls back to All instead of showing a blank list", () => {
    const view = wrap(historyNode(events));
    fireEvent.press(view.getByTestId("asset-history-filter-repairs"));
    view.rerender(<ThemeProvider><ToastProvider>{historyNode([ev("pm_completed", 1), ev("reading_recorded", 4)])}</ToastProvider></ThemeProvider>);
    expect(view.queryByText(/events\.pm_completed/)).toBeTruthy();
    expect(view.getByTestId("asset-history-filter-all").props.accessibilityState.selected).toBe(true);
  });
});

const assetRow = (over: Partial<AssetRow> = {}): AssetRow => ({
  id: "a1", name: "Chiller 2", asset_tag: "CH-2", location_text: "Roof", room_id: null, rooms: null, asset_categories: { name: "HVAC", code: "hvac" },
  service_status: "operational", active_work_order_count: 0, pm_overdue: false, pm_due_soon: false, repeat_repairs_90d: 0, has_active_prediction: false, had_downtime_365d: false, ...over,
});

describe("Asset quick actions", () => {
  const sheet = (props: Partial<React.ComponentProps<typeof AssetQuickActionsSheet>> = {}) =>
    wrap(<AssetQuickActionsSheet row={assetRow()} isOnline canRecordReading onClose={jest.fn()} {...props} />);

  it("renders nothing when no card is selected", () => {
    const { queryByTestId } = sheet({ row: null });
    expect(queryByTestId("asset-quick-open")).toBeNull();
  });

  it("each action opens the existing screen for exactly this asset and closes the sheet", () => {
    const onClose = jest.fn();
    const { getByTestId } = sheet({ onClose });
    fireEvent.press(getByTestId("asset-quick-reading"));
    expect(push).toHaveBeenLastCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a1", section: "readings" } });
    fireEvent.press(getByTestId("asset-quick-maintenance"));
    expect(push).toHaveBeenLastCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a1", section: "maintenance" } });
    fireEvent.press(getByTestId("asset-quick-label"));
    expect(push).toHaveBeenLastCalledWith({ pathname: "/(app)/assets/label/[assetId]", params: { assetId: "a1" } });
    fireEvent.press(getByTestId("asset-quick-open"));
    expect(push).toHaveBeenLastCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a1" } });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("reporting opens the shared form pre-filled with this equipment and its location", () => {
    const { getByTestId } = sheet({ row: assetRow({ room_id: "r9", rooms: { room_number: "214" } }) });
    fireEvent.press(getByTestId("asset-quick-report"));
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/(app)/work-orders/new",
      params: { from: "asset", assetId: "a1", assetName: "Chiller 2", assetCategory: "hvac", assetLocation: "Roof", assetRoomId: "r9", assetRoomNumber: "214" },
    });
  });

  it("offline, reporting is disabled and does nothing, while the others still work", () => {
    const { getByTestId } = sheet({ isOnline: false });
    expect(getByTestId("asset-quick-report").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("asset-quick-report"));
    expect(push).not.toHaveBeenCalled();
    expect(getByTestId("asset-quick-open").props.accessibilityState.disabled).toBe(false);
  });

  it("a role that may not record readings is not offered the reading action", () => {
    const { queryByTestId } = sheet({ canRecordReading: false });
    expect(queryByTestId("asset-quick-reading")).toBeNull();
  });

  it("an id that cannot be a safe path segment opens nothing", () => {
    const { getByTestId } = sheet({ row: assetRow({ id: "../x" }) });
    fireEvent.press(getByTestId("asset-quick-label"));
    fireEvent.press(getByTestId("asset-quick-open"));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Asset card actions", () => {
  it("the ellipsis, a long press and the screen reader action all hand over the same row; tapping the card still just opens it", () => {
    const row = assetRow();
    const onPress = jest.fn();
    const onActions = jest.fn();
    const { getByTestId } = wrap(<AssetCard row={row} onPress={onPress} onActions={onActions} />);
    fireEvent.press(getByTestId("asset-actions-a1"));
    fireEvent(getByTestId("asset-card-a1"), "longPress");
    fireEvent(getByTestId("asset-card-a1"), "accessibilityAction", { nativeEvent: { actionName: "actions" } });
    expect(onActions).toHaveBeenCalledTimes(3);
    expect(onActions).toHaveBeenCalledWith(row);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("asset-card-a1"));
    expect(onPress).toHaveBeenCalledWith("a1");
  });

  it("without a handler the card looks and behaves exactly as before", () => {
    const { queryByTestId } = wrap(<AssetCard row={assetRow()} onPress={jest.fn()} />);
    expect(queryByTestId("asset-actions-a1")).toBeNull();
  });
});
