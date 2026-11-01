import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { WorkOrderChecklist } from "@/components/engineering/workorder/WorkOrderChecklist";
import type { ChecklistItem, ChecklistLoad, ChecklistSummary } from "@/lib/engineering/workOrderChecklist";

const item = (id: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  label: `Step ${id}`,
  is_required: false,
  is_done: false,
  done_by: null,
  done_at: null,
  sort_order: Number(id.replace(/\D/g, "")),
  estimated_minutes: null,
  ...over,
});
const summaryOf = (items: ChecklistItem[]): ChecklistSummary => {
  const remaining = items.filter((i) => i.is_required && !i.is_done).map((i) => ({ id: i.id, label: i.label }));
  return { total: items.length, completed: items.filter((i) => i.is_done).length, required_total: items.filter((i) => i.is_required).length, required_completed: 0, required_remaining: remaining, ready: remaining.length === 0 };
};
const ready = (items: ChecklistItem[], editable = true): ChecklistLoad => ({ phase: "ready", snapshot: { items, summary: summaryOf(items), editable } });

function renderList(over: Partial<React.ComponentProps<typeof WorkOrderChecklist>> = {}) {
  const props: React.ComponentProps<typeof WorkOrderChecklist> = {
    load: ready([item("a1", { is_done: true, done_at: "2026-10-31T15:42:00Z" }), item("a2"), item("a3")]),
    pending: new Set(),
    itemErrors: {},
    stale: false,
    canEdit: true,
    readOnlyReason: null,
    locale: "en",
    onToggle: jest.fn(),
    onRetry: jest.fn(),
    onReviewCompletion: null,
    ...over,
  };
  return { props, ...render(<ThemeProvider><WorkOrderChecklist {...props} /></ThemeProvider>) };
}

describe("WorkOrderChecklist", () => {
  it("shows the real steps with an accurate count and progress", () => {
    const { getByTestId, getByText } = renderList();
    expect(getByText("Step a1")).toBeTruthy();
    expect(getByText("Step a3")).toBeTruthy();
    expect(getByTestId("wo-checklist-count").props.children).toBe("1 of 3 completed");
    expect(getByTestId("wo-checklist-bar").props.accessibilityValue).toEqual({ min: 0, max: 3, now: 1 });
  });

  it("exposes each step as a checkbox with its state spoken", () => {
    const { getByTestId } = renderList();
    const done = getByTestId("wo-checklist-item-a1");
    expect(done.props.accessibilityRole).toBe("checkbox");
    expect(done.props.accessibilityState).toMatchObject({ checked: true });
    expect(done.props.accessibilityLabel).toContain("done");
    expect(getByTestId("wo-checklist-item-a2").props.accessibilityLabel).toContain("not done");
  });

  it("sends the opposite state when a step is tapped", () => {
    const { getByTestId, props } = renderList();
    fireEvent.press(getByTestId("wo-checklist-item-a2"));
    expect(props.onToggle).toHaveBeenCalledWith("a2", true);
    fireEvent.press(getByTestId("wo-checklist-item-a1"));
    expect(props.onToggle).toHaveBeenCalledWith("a1", false);
  });

  it("labels required and optional steps, and says how many required steps remain", () => {
    const { getByTestId, getAllByText, getByText } = renderList({
      load: ready([item("a1", { is_required: true }), item("a2", { is_required: true }), item("a3"), item("a4", { is_required: true, is_done: true })]),
    });
    expect(getAllByText(/^Required/).length).toBe(3);
    expect(getByText(/^Optional/)).toBeTruthy();
    expect(getByTestId("wo-checklist-required").props.children).toBe("2 required steps remaining");
  });

  it("says one required step remains in the singular, and when they are all done", () => {
    const one = renderList({ load: ready([item("a1", { is_required: true })]) });
    expect(one.getByTestId("wo-checklist-required").props.children).toBe("1 required step remaining");
    const none = renderList({ load: ready([item("a1", { is_required: true, is_done: true })]) });
    expect(none.getByTestId("wo-checklist-required").props.children).toBe("All required steps are done");
  });

  it("does not label steps or count requirements when none is required", () => {
    const { queryByTestId, queryByText } = renderList();
    expect(queryByTestId("wo-checklist-required")).toBeNull();
    expect(queryByText(/^Optional/)).toBeNull();
  });

  it("shows a saving state on the step in flight and ignores taps on it", () => {
    const { getByTestId, props } = renderList({ pending: new Set(["a2"]) });
    expect(getByTestId("wo-checklist-saving-a2")).toBeTruthy();
    const row = getByTestId("wo-checklist-item-a2");
    expect(row.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    fireEvent.press(row);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("shows the reason a change was refused beside its step", () => {
    const { getByTestId } = renderList({ itemErrors: { a2: "failed" } });
    expect(getByTestId("wo-checklist-error-a2").props.children).toMatch(/Couldn't save that step/);
  });

  it("is read-only for someone who cannot edit, and says why", () => {
    const { getByTestId, props } = renderList({ canEdit: false, readOnlyReason: "notAssigned" });
    expect(getByTestId("wo-checklist-readonly").props.children).toMatch(/Only the assigned technician/);
    fireEvent.press(getByTestId("wo-checklist-item-a2"));
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(getByTestId("wo-checklist-item-a2").props.accessibilityState.disabled).toBe(true);
  });

  it("keeps a closed order's completed steps readable", () => {
    const { getByText, getByTestId } = renderList({ canEdit: false, readOnlyReason: "closed", load: ready([item("a1", { is_done: true, is_required: true, done_at: "2026-10-31T15:42:00Z" })], false) });
    expect(getByText("Step a1")).toBeTruthy();
    expect(getByTestId("wo-checklist-readonly").props.children).toMatch(/closed/);
  });

  it("says there is no checklist, with no progress and no steps, when there are none", () => {
    const { getByTestId, queryByTestId } = renderList({ load: ready([]) });
    expect(getByTestId("wo-checklist-empty")).toBeTruthy();
    expect(queryByTestId("wo-checklist-bar")).toBeNull();
    expect(queryByTestId("wo-checklist-count")).toBeNull();
  });

  it("shows a loading state, not an empty one", () => {
    const { queryByTestId } = renderList({ load: { phase: "loading" } });
    expect(queryByTestId("wo-checklist-empty")).toBeNull();
    expect(queryByTestId("wo-checklist-bar")).toBeNull();
  });

  it("shows a failed read as a failure with a retry, never as 'no checklist'", () => {
    const { queryByTestId, getByText, props } = renderList({ load: { phase: "error", failure: "failed" } });
    expect(queryByTestId("wo-checklist-empty")).toBeNull();
    expect(getByText("Couldn't load the checklist.")).toBeTruthy();
    fireEvent.press(getByText("Retry"));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("offers no retry for a forbidden read", () => {
    const { queryByText, getByText } = renderList({ load: { phase: "error", failure: "forbidden" } });
    expect(getByText("You don't have access to this checklist.")).toBeTruthy();
    expect(queryByText("Retry")).toBeNull();
  });

  it("says when it is showing the last confirmed read", () => {
    const { getByTestId } = renderList({ stale: true });
    expect(getByTestId("wo-checklist-stale")).toBeTruthy();
  });

  it("offers Review completion only when given a way to open it", () => {
    const hidden = renderList();
    expect(hidden.queryByTestId("wo-checklist-review")).toBeNull();
    const onReview = jest.fn();
    const shown = renderList({ onReviewCompletion: onReview });
    fireEvent.press(shown.getByTestId("wo-checklist-review"));
    expect(onReview).toHaveBeenCalled();
  });
});
