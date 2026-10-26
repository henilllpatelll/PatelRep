import { Modal } from "react-native";
import { act, within } from "@testing-library/react-native";
import {
  mockHistory,
  mockOrders,
  mockPrevious,
  mockSessions,
  mockState,
  navigate,
  openWorkspace as open,
  resetWorld,
  room205,
  mockQueue,
} from "../helpers/workspaceMocks";
import { flush, settle } from "../helpers/workspaceHarness";

/* ─── Room context (read-only) and the More menu ─────────────────────────── */

let dateNow: jest.SpyInstance;
beforeEach(async () => {
  dateNow = await resetWorld();
});
afterEach(async () => {
  await flush();
  dateNow.mockRestore();
});

const openContext = async () => {
  const opened = await open();
  await opened.press("workspace-more");
  await opened.press("workspace-more-context");
  await settle();
  return opened;
};

describe("the More menu", () => {
  it("offers room context and save & exit, nothing that changes a room", async () => {
    const { press, screen, text } = await open();
    await press("workspace-more");
    expect(text("workspace-more-sheet-title")).toBe("Inspection options");
    expect(screen.getByTestId("workspace-more-context")).toBeTruthy();
    expect(screen.getByTestId("workspace-more-saveexit")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /approve|pass|fail|clean|assign|status/i })).toEqual([]);
  });

  it("is only available while there is an inspection to act on", async () => {
    mockQueue.mockResolvedValue([]);
    const { screen } = await open();
    expect(screen.queryByTestId("workspace-more")).toBeNull();
  });

  it("closes with its close button and with Android back", async () => {
    const { press, screen } = await open();
    await press("workspace-more");
    await press("workspace-more-sheet-close");
    expect(screen.queryByTestId("workspace-more-sheet")).toBeNull();
    await press("workspace-more");
    const modal = screen.UNSAFE_getAllByType(Modal).find((m) => m.props.visible);
    await act(async () => modal?.props.onRequestClose());
    expect(screen.queryByTestId("workspace-more-sheet")).toBeNull();
  });

  it("is a modal for screen readers and its title is a header", async () => {
    const { press, screen } = await open();
    await press("workspace-more");
    expect(screen.getByTestId("workspace-more-sheet").props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByTestId("workspace-more-sheet-title").props.accessibilityRole).toBe("header");
  });
});

describe("room context", () => {
  it("reads nothing until it is opened", async () => {
    await open();
    expect(mockSessions).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
    expect(mockOrders).not.toHaveBeenCalled();
    expect(mockPrevious).not.toHaveBeenCalled();
  });

  it("shows the room, the cleaning, notes, open work orders and the last inspection from what the server recorded", async () => {
    mockSessions.mockResolvedValue([{ id: "s1", status: "completed", ended_at: "2026-10-20T16:42:30Z", duration_seconds: 1920, checklist_done: 11, checklist_total: 12 }]);
    mockHistory.mockResolvedValue([
      { id: "n1", notes: "Guest left a lamp on", from_status: "CLEAN", to_status: "CLEAN", created_at: "2026-10-20T16:50:00Z", actor_name: "Hana" },
      { id: "x", notes: "status change", from_status: "DIRTY", to_status: "CLEAN", created_at: "2026-10-20T16:42:00Z" },
    ]);
    mockOrders.mockResolvedValue([
      { id: "w1", title: "Leaking faucet", status: "in_progress", priority: "urgent", created_at: "2026-10-19T10:00:00Z", work_order_number: "1042" },
      { id: "w2", title: "Old job", status: "completed", priority: "low", created_at: "2026-10-01T10:00:00Z" },
    ]);
    mockPrevious.mockResolvedValue([{ id: "i1", overall_result: "failed", completed_at: "2026-10-19T14:00:00Z", inspector_name: "Sam Supervisor", notes: "Mirror streaked" }]);
    const { screen, text } = await openContext();
    expect(text("workspace-context-title")).toBe("Room 205 · Context");
    const room = within(screen.getByTestId("context-room"));
    expect(room.getByText("Standard King")).toBeTruthy();
    expect(room.getByText("Floor 2")).toBeTruthy();
    expect(room.getByText("Departure")).toBeTruthy();
    expect(room.getByText("Clean · awaiting inspection")).toBeTruthy();
    const cleaning = within(screen.getByTestId("context-cleaning"));
    expect(cleaning.getByText("Maria S.")).toBeTruthy();
    expect(cleaning.getByText("11:42 AM")).toBeTruthy();
    expect(cleaning.getByText("32 min")).toBeTruthy();
    expect(cleaning.getByText("11 of 12 done")).toBeTruthy();
    expect(within(screen.getByTestId("context-notes")).getByText("Guest left a lamp on")).toBeTruthy();
    expect(within(screen.getByTestId("context-notes")).queryByText("status change")).toBeNull();
    const orders = within(screen.getByTestId("context-orders"));
    expect(orders.getByText("Leaking faucet")).toBeTruthy();
    expect(orders.getByText("#1042 · In progress · Urgent")).toBeTruthy();
    expect(orders.queryByText("Old job")).toBeNull();
    const previous = within(screen.getByTestId("context-previous"));
    expect(previous.getByText("Failed")).toBeTruthy();
    expect(previous.getByText("Sam Supervisor")).toBeTruthy();
  });

  it("says 'Not available' for what the server did not give, and never invents it", async () => {
    mockQueue.mockResolvedValue([room205({ room_type_name: null, cleaned_by: "", cleaned_at: null, clean_type: null, floor: null })]);
    const { screen } = await openContext();
    expect(within(screen.getByTestId("context-room")).getAllByText("Not available").length).toBeGreaterThanOrEqual(3);
    const cleaning = within(screen.getByTestId("context-cleaning"));
    expect(cleaning.getByText("Not recorded")).toBeTruthy();
    expect(cleaning.getAllByText("Not available").length).toBeGreaterThanOrEqual(1);
  });

  it("empty sections say there is nothing recorded - a different message from a failed read", async () => {
    const { screen } = await openContext();
    expect(screen.getByText("No notes on this room.")).toBeTruthy();
    expect(screen.getByText("No open work orders.")).toBeTruthy();
    expect(screen.getByText("No inspection recorded in the last 90 days.")).toBeTruthy();
    expect(screen.getByText("No matching cleaning session was recorded.")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("a failed read says it failed and retries on its own, while the other sections still show", async () => {
    mockOrders.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    mockHistory.mockResolvedValue([{ id: "n1", notes: "Hello", from_status: "CLEAN", to_status: "CLEAN", created_at: "2026-10-20T16:50:00Z" }]);
    const { screen, press } = await openContext();
    expect(within(screen.getByTestId("context-orders")).getByText("Couldn't load this right now.")).toBeTruthy();
    expect(within(screen.getByTestId("context-orders")).queryByText("No open work orders.")).toBeNull(); // not mistaken for none
    expect(within(screen.getByTestId("context-notes")).getByText("Hello")).toBeTruthy();
    mockOrders.mockResolvedValue([{ id: "w1", title: "Leaking faucet", status: "open", priority: "normal", created_at: "2026-10-19T10:00:00Z" }]);
    await press("context-orders-load-retry");
    expect(within(screen.getByTestId("context-orders")).getByText("Leaking faucet")).toBeTruthy();
  });

  it("offline reads say to check the connection", async () => {
    mockPrevious.mockRejectedValue(new Error("Network request failed"));
    const { screen } = await openContext();
    expect(within(screen.getByTestId("context-previous")).getByText("Couldn't load this. Check your connection.")).toBeTruthy();
  });

  it("a work-order list that fills the server's page says older ones may exist", async () => {
    mockOrders.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: `w${i}`, title: "Done", status: "completed", priority: "low", created_at: "2026-10-01T10:00:00Z" })));
    const { screen } = await openContext();
    expect(screen.getByText("No open work orders in the latest records. Older ones may exist.")).toBeTruthy();
  });

  it("each opening reads fresh; closing is by the close button or Android back", async () => {
    const { press, screen } = await openContext();
    expect(mockOrders).toHaveBeenCalledTimes(1);
    await press("workspace-context-close");
    expect(screen.queryByTestId("workspace-context")).toBeNull();
    await press("workspace-more");
    await press("workspace-more-context");
    expect(mockOrders).toHaveBeenCalledTimes(2);
    const modal = screen.UNSAFE_getAllByType(Modal).find((m) => m.props.visible);
    await act(async () => modal?.props.onRequestClose());
    expect(screen.queryByTestId("workspace-context")).toBeNull();
  });

  it("is read-only: the only controls are close, retry and a link to the room", async () => {
    mockPrevious.mockResolvedValue([{ id: "i1", overall_result: "passed", completed_at: "2026-10-19T14:00:00Z", inspector_name: "Sam Supervisor" }]);
    const { screen } = await openContext();
    const labels = within(screen.getByTestId("workspace-context")).queryAllByRole("button").map((b) => b.props.accessibilityLabel ?? "");
    expect(labels.filter((l: string) => !/close|view room|retry|try again/i.test(l) && l !== "")).toEqual([]);
  });

  it("the link to the room goes to the Room Board by id, leaving the draft safely behind", async () => {
    mockPrevious.mockResolvedValue([{ id: "i1", overall_result: "passed", completed_at: "2026-10-19T14:00:00Z", inspector_name: "Sam Supervisor" }]);
    const { press } = await openContext();
    await press("context-view-room");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-205" } });
  });

  it("speaks Spanish", async () => {
    mockState.language = "es";
    const { text } = await openContext();
    expect(text("workspace-context-title")).toBe("Habitación 205 · Contexto");
  });

  it("opening it does not disturb answers already given", async () => {
    const opened = await open();
    await opened.answer("toilet", "pass");
    await opened.press("workspace-more");
    await opened.press("workspace-more-context");
    await opened.press("workspace-context-close");
    expect(opened.screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: true });
  });
});
