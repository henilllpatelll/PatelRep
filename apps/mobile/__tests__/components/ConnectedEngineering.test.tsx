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
