import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${Object.values(o).length ? `|${Object.values(o).join("|")}` : ""}` : k),
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { WorkOrderCard, type WorkOrderCardProps } from "@/components/engineering/WorkOrderCard";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const ME = "u-me";
const NOW = new Date("2026-10-15T17:30:00Z").getTime(); // 12:30 PM in Chicago
const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: "w1",
  title: "AC not cooling",
  status: "open",
  priority: "normal",
  assigned_to: null,
  work_order_number: "1042",
  rooms: { room_number: "312" },
  ...over,
});

function renderCard(order: WorkOrder, over: Partial<WorkOrderCardProps> = {}) {
  const props: WorkOrderCardProps = {
    wo: order,
    locale: "en",
    timeZone: "America/Chicago",
    view: "mine",
    viewerId: ME,
    now: NOW,
    onOpen: jest.fn(),
    ...over,
  };
  render(
    <ThemeProvider>
      <WorkOrderCard {...props} />
    </ThemeProvider>,
  );
  return props;
}

describe("WorkOrderCard", () => {
  it("shows the location first, then the order number, the issue and the priority word", () => {
    renderCard(wo({ priority: "urgent" }));
    expect(screen.getByText("workQueue.roomLabel|312 · WO-1042")).toBeTruthy();
    expect(screen.getByText("AC not cooling")).toBeTruthy();
    expect(screen.getByTestId("wo-priority-w1").props.children).toBe("workQueue.priority.urgent");
  });

  it.each(["emergency", "urgent", "normal", "low"] as const)("states %s priority in words", (priority) => {
    renderCard(wo({ priority }));
    expect(screen.getByTestId("wo-priority-w1").props.children).toBe(`workQueue.priority.${priority}`);
  });

  it("falls back to free-text location, then to the category, without inventing a room", () => {
    renderCard(wo({ rooms: null, location_text: "Pool deck", work_order_number: null }));
    expect(screen.getByText("Pool deck")).toBeTruthy();
  });

  it("keeps a very long issue to two lines yet readable in full by a screen reader", () => {
    const title = "Guest reports the air conditioner in the corner suite is blowing warm air and making a loud rattling noise ".repeat(3).trim();
    renderCard(wo({ title }));
    expect(screen.getByText(title).props.numberOfLines).toBe(2);
    expect(screen.getByTestId("wo-w1").props.accessibilityLabel).toContain(title);
  });

  it("names overdue work in words and in the hotel's clock", () => {
    renderCard(wo({ status: "in_progress", assigned_to: ME, due_at: "2026-10-15T16:45:00Z" }));
    expect(screen.getByTestId("wo-overdue-w1").props.children).toBe("workQueue.card.overdueBy|45m");
  });

  it("shows when work is due in the hotel's clock", () => {
    renderCard(wo({ assigned_to: ME, due_at: "2026-10-15T20:00:00Z" }));
    expect(screen.getByTestId("wo-due-w1").props.children).toBe("workQueue.card.dueToday|3:00 PM");
  });

  it("says nothing about a deadline when there is no due date", () => {
    renderCard(wo({ assigned_to: ME, due_at: null }));
    expect(screen.queryByTestId("wo-due-w1")).toBeNull();
    expect(screen.queryByTestId("wo-overdue-w1")).toBeNull();
  });

  it("shows the real status and only the verified hotel context", () => {
    renderCard(
      wo({
        status: "in_progress",
        assigned_to: ME,
        guest_reported: true,
        assets: { name: "Chiller 2" },
        room_context: { occupancy: "occupied", availability: "out_of_service" },
      }),
    );
    expect(screen.getByText("workOrders.status.in_progress")).toBeTruthy();
    expect(screen.getByTestId("wo-badge-occupied-w1")).toBeTruthy();
    expect(screen.getByTestId("wo-badge-out_of_service-w1")).toBeTruthy();
    expect(screen.getByTestId("wo-badge-guest-w1")).toBeTruthy();
    expect(screen.getByTestId("wo-badge-equipment-w1")).toBeTruthy();
    expect(screen.getByText("Chiller 2")).toBeTruthy();
  });

  it("guesses nothing when occupancy is unknown or absent, but still shows a guest report", () => {
    renderCard(wo({ assigned_to: ME, guest_reported: true, room_context: { occupancy: "unknown", availability: null } }));
    expect(screen.queryByTestId("wo-badge-occupied-w1")).toBeNull();
    expect(screen.queryByTestId("wo-badge-vacant-w1")).toBeNull();
    expect(screen.getByTestId("wo-badge-guest-w1")).toBeTruthy();
  });

  it("opens the order from the card body", () => {
    const props = renderCard(wo({ assigned_to: ME, status: "in_progress" }));
    fireEvent.press(screen.getByTestId("wo-w1"));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
  });

  it("leads an engineer's started work with Continue", () => {
    const props = renderCard(wo({ assigned_to: ME, status: "in_progress" }));
    expect(screen.getByText("workQueue.action.continue")).toBeTruthy();
    fireEvent.press(screen.getByTestId("wo-action-w1"));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it("claims through the handler for a claimable order, with one primary action only", () => {
    const onClaim = jest.fn();
    renderCard(wo(), { view: "available", claimable: true, onClaim });
    fireEvent.press(screen.getByTestId("wo-claim-w1"));
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
    expect(screen.queryByTestId("wo-assign-w1")).toBeNull();
  });

  it("marks a queued claim as waiting to sync and offers no second claim — never as assigned", () => {
    renderCard(wo(), { view: "available", claimable: false, claimQueued: true, onClaim: jest.fn() });
    expect(screen.getByTestId("wo-claim-queued-w1")).toBeTruthy();
    expect(screen.getByText("workQueue.claimQueued")).toBeTruthy();
    expect(screen.queryByTestId("wo-claim-w1")).toBeNull();
    expect(screen.queryByTestId("wo-action-w1")).toBeNull();
    expect(screen.queryByText(/assignedToYou/)).toBeNull();
  });

  it("shows a busy claim button and does not claim twice while it is pending", () => {
    renderCard(wo(), { view: "available", claimable: true, onClaim: jest.fn(), claiming: true });
    const button = screen.getByTestId("wo-claim-w1");
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it("gives a chief engineer Assign on unowned work and no claim", () => {
    const onAssign = jest.fn();
    renderCard(wo(), { view: "available", assignable: true, onAssign });
    expect(screen.queryByTestId("wo-claim-w1")).toBeNull();
    fireEvent.press(screen.getByTestId("wo-assign-w1"));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
    expect(screen.getAllByTestId("wo-assign-w1")).toHaveLength(1);
  });

  it("gives a chief engineer Review on a colleague's work with a small Reassign beside it", () => {
    const onAssign = jest.fn();
    const props = renderCard(wo({ status: "in_progress", assigned_to: "sam", assigned_to_name: "Sam Ortiz" }), {
      view: "team",
      assignable: true,
      onAssign,
    });
    expect(screen.getByText("workQueue.action.review")).toBeTruthy();
    expect(screen.queryByText("workQueue.action.continue")).toBeNull();
    expect(screen.getByText("workQueue.assignedTo|Sam Ortiz")).toBeTruthy();
    fireEvent.press(screen.getByTestId("wo-assign-w1"));
    expect(onAssign).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("wo-action-w1"));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it("explains a held order and sends the person to review the hold", () => {
    renderCard(wo({ status: "on_hold", assigned_to: "sam", assigned_to_name: "Sam", hold_reason_code: "awaiting_parts", held_since: "2026-10-15T15:30:00Z" }), {
      view: "waiting",
    });
    expect(screen.getByText(/workOrders.holdReason.awaiting_parts/)).toBeTruthy();
    expect(screen.getByText(/workQueue.waitingFor\|2h 00m/)).toBeTruthy();
    expect(screen.getByText("workQueue.action.reviewHold")).toBeTruthy();
  });

  it("keeps completed and cancelled records in their real state with a View record action and no hotel context", () => {
    renderCard(wo({ status: "cancelled", assigned_to: ME, updated_at: "2026-10-15T15:00:00Z", room_context: { occupancy: "occupied", availability: null } }), {
      view: "done",
    });
    expect(screen.getByText("workOrders.status.cancelled")).toBeTruthy();
    expect(screen.getByText(/workQueue.cancelledAt/)).toBeTruthy();
    expect(screen.getByText("workQueue.action.viewRecord")).toBeTruthy();
    expect(screen.queryByTestId("wo-badge-occupied-w1")).toBeNull();
    expect(screen.queryByTestId("wo-due-w1")).toBeNull();
  });

  it("describes the whole card to a screen reader in reading order", () => {
    renderCard(wo({ priority: "urgent", status: "in_progress", assigned_to: ME, due_at: "2026-10-15T16:45:00Z", guest_reported: true }));
    const label: string = screen.getByTestId("wo-w1").props.accessibilityLabel;
    const order = ["workQueue.roomLabel|312 · WO-1042", "AC not cooling", "workQueue.priority.urgent", "workOrders.status.in_progress", "workQueue.guestReported", "workQueue.card.overdueBy|45m"];
    const positions = order.map((part) => label.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
