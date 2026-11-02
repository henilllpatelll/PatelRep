import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("@/lib/api/pmManagement", () => ({
  listPmTechnicians: jest.fn(),
  assignPmSchedule: jest.fn(),
  requestPmDeferral: jest.fn(),
  decidePmDeferral: jest.fn(),
  setAssetCriticality: jest.fn(),
}));
// The platform date picker is native; a text box stands in so a test can choose a day.
jest.mock("@/components/engineering/assets/form/DateField", () => {
  const { TextInput } = require("react-native");
  return { DateField: ({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID: string }) => <TextInput value={value} onChangeText={onChange} testID={testID} /> };
});

import * as mgmt from "@/lib/api/pmManagement";
import { AssignInspectionSheet, type AssignTarget } from "@/components/engineering/pm/management/AssignInspectionSheet";
import { DeferralRequestSheet } from "@/components/engineering/pm/management/DeferralRequestSheet";
import { DeferralReviewSheet } from "@/components/engineering/pm/management/DeferralReviewSheet";
import { CriticalitySheet } from "@/components/engineering/assets/CriticalitySheet";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import type { PmDeferralRequest } from "@/lib/api/pmManagement";

const api = mgmt as unknown as Record<string, jest.Mock>;
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const apiError = (status: number, code?: string, message = "x") => Object.assign(new Error(message), { status, code });
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => jest.clearAllMocks());

const target: AssignTarget = { id: "s1", name: "Chiller PM", assetName: "Chiller 1", location: "Roof", dueAt: "2026-11-10T18:00:00Z", estimatedMinutes: 45, assigneeId: null, assigneeName: null, rowVersion: 4 };

describe("Assign Inspection sheet", () => {
  const people = [{ id: "u1", name: "Ana", role: "engineer" }, { id: "u2", name: "Bo", role: "chief_engineer" }];
  const open = (over: Partial<React.ComponentProps<typeof AssignInspectionSheet>> = {}) => {
    const props = { visible: true, target, timezone: "America/Chicago", language: "en", isOnline: true, onClose: jest.fn(), onAssigned: jest.fn(), onNeedsRefresh: jest.fn(), ...over };
    return { ...wrap(<AssignInspectionSheet {...props} />), props };
  };

  it("offers only the people the server lists and states that it assigns this inspection only", async () => {
    api.listPmTechnicians.mockResolvedValue(people);
    const { getByTestId, getByText } = open();
    await waitFor(() => expect(getByTestId("pm-assign-tech-u1")).toBeTruthy());
    expect(getByTestId("pm-assign-tech-u2")).toBeTruthy();
    expect(getByText("pmMgmt.assign.scopeNote")).toBeTruthy();
    expect(getByTestId("pm-assign-confirm").props.accessibilityState).toMatchObject({ disabled: true }); // nobody chosen yet
  });

  it("sends the version the manager saw and reports success only after the server accepts", async () => {
    api.listPmTechnicians.mockResolvedValue(people);
    api.assignPmSchedule.mockResolvedValue({ id: "s1" });
    const { getByTestId, props } = open();
    await waitFor(() => expect(getByTestId("pm-assign-tech-u1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-assign-tech-u1"));
    expect(props.onAssigned).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("pm-assign-confirm"));
    await waitFor(() => expect(props.onAssigned).toHaveBeenCalledWith({ id: "s1" }, "assigned"));
    expect(api.assignPmSchedule).toHaveBeenCalledWith("s1", "u1", 4);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("a double tap sends one request", async () => {
    api.listPmTechnicians.mockResolvedValue(people);
    let release: (v: unknown) => void = () => undefined;
    api.assignPmSchedule.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { getByTestId } = open();
    await waitFor(() => expect(getByTestId("pm-assign-tech-u1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-assign-tech-u1"));
    fireEvent.press(getByTestId("pm-assign-confirm"));
    fireEvent.press(getByTestId("pm-assign-confirm"));
    expect(api.assignPmSchedule).toHaveBeenCalledTimes(1);
    await act(async () => release({ id: "s1" }));
  });

  it("a version conflict is explained, nothing is reported as assigned, and the view is refreshed", async () => {
    api.listPmTechnicians.mockResolvedValue(people);
    api.assignPmSchedule.mockRejectedValue(apiError(409, "version_conflict"));
    const { getByTestId, getByText, props } = open();
    await waitFor(() => expect(getByTestId("pm-assign-tech-u1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-assign-tech-u1"));
    fireEvent.press(getByTestId("pm-assign-confirm"));
    await waitFor(() => expect(getByTestId("pm-assign-error")).toBeTruthy());
    expect(getByText("pmMgmt.failure.version_conflict")).toBeTruthy();
    expect(props.onAssigned).not.toHaveBeenCalled();
    expect(props.onNeedsRefresh).toHaveBeenCalled();
  });

  it("reassigning disables the current assignee and offers to remove the assignment", async () => {
    api.listPmTechnicians.mockResolvedValue(people);
    api.assignPmSchedule.mockResolvedValue({ id: "s1" });
    const { getByTestId, props } = open({ target: { ...target, assigneeId: "u1", assigneeName: "Ana" } });
    await waitFor(() => expect(getByTestId("pm-assign-tech-u1")).toBeTruthy());
    expect(getByTestId("pm-assign-tech-u1").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(getByTestId("pm-assign-unassign"));
    await waitFor(() => expect(props.onAssigned).toHaveBeenCalledWith({ id: "s1" }, "unassigned"));
    expect(api.assignPmSchedule).toHaveBeenCalledWith("s1", null, 4);
  });

  it("offline: no list request and no way to confirm", async () => {
    const { getByTestId } = open({ isOnline: false });
    await flush();
    expect(api.listPmTechnicians).not.toHaveBeenCalled();
    expect(getByTestId("pm-assign-confirm").props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe("Request PM Deferral sheet", () => {
  const dueTarget = { scheduleId: "s1", name: "Chiller PM", assetName: "Chiller 1", dueAt: "2099-01-10T18:00:00Z" };
  const open = (over: Partial<React.ComponentProps<typeof DeferralRequestSheet>> = {}) => {
    const props = { visible: true, target: dueTarget, timezone: "America/Chicago", language: "en", isOnline: true, onClose: jest.fn(), onRequested: jest.fn(), ...over };
    return { ...wrap(<DeferralRequestSheet {...props} />), props };
  };

  it("says it sends a request, not an approval", () => {
    const { getByText } = open();
    expect(getByText("pmMgmt.deferral.requestNote")).toBeTruthy();
  });

  it("won't submit without a reason and a later date", async () => {
    const { getByTestId, queryByTestId } = open();
    fireEvent.press(getByTestId("pm-deferral-submit"));
    await flush();
    expect(api.requestPmDeferral).not.toHaveBeenCalled();
    expect(getByTestId("pm-deferral-reason-error")).toBeTruthy();
    fireEvent.changeText(getByTestId("pm-deferral-reason"), "Compressor part on order");
    fireEvent.changeText(getByTestId("pm-deferral-date"), "2099-01-10"); // not later than the current due date
    fireEvent.press(getByTestId("pm-deferral-submit"));
    await flush();
    expect(api.requestPmDeferral).not.toHaveBeenCalled();
    expect(queryByTestId("pm-deferral-error")).toBeNull();
  });

  it("submits the reason and noon-in-the-hotel instant, and reports only after the server accepts", async () => {
    api.requestPmDeferral.mockResolvedValue(undefined);
    const { getByTestId, props } = open();
    fireEvent.changeText(getByTestId("pm-deferral-reason"), "  Compressor part on order  ");
    fireEvent.changeText(getByTestId("pm-deferral-date"), "2099-01-15");
    fireEvent.press(getByTestId("pm-deferral-submit"));
    await waitFor(() => expect(props.onRequested).toHaveBeenCalled());
    expect(api.requestPmDeferral).toHaveBeenCalledWith("s1", { reason: "Compressor part on order", deferredUntil: "2099-01-15T18:00:00.000Z" });
  });

  it("an existing pending request is explained, not hidden", async () => {
    api.requestPmDeferral.mockRejectedValue(apiError(409, undefined, "This schedule already has a deferral request awaiting review"));
    const { getByText, getByTestId, props } = open();
    fireEvent.changeText(getByTestId("pm-deferral-reason"), "Compressor part on order");
    fireEvent.changeText(getByTestId("pm-deferral-date"), "2099-01-15");
    fireEvent.press(getByTestId("pm-deferral-submit"));
    await waitFor(() => expect(getByText("pmMgmt.failure.pending_exists")).toBeTruthy());
    expect(props.onRequested).not.toHaveBeenCalled();
  });
});

describe("Review PM Deferral sheet", () => {
  const request: PmDeferralRequest = {
    id: "d1", pm_schedule_id: "s1", schedule_name: "Chiller PM", asset_name: "Chiller 1", asset_tag: null, location_text: "Roof",
    current_due_at: "2099-01-10T18:00:00Z", schedule_active: true, requested_by: "u-requester", requested_by_name: "Cy",
    requested_at: "2099-01-01T12:00:00Z", requested_due_at: "2099-01-20T18:00:00Z", reason: "Part on order", status: "pending",
    decided_by_name: null, decided_at: null, decision_note: null, stale: false,
  };
  const open = (over: Partial<React.ComponentProps<typeof DeferralReviewSheet>> = {}, req: PmDeferralRequest = request) => {
    const props = { visible: true, request: req, role: "gm", userId: "u-reviewer", timezone: "America/Chicago", language: "en", isOnline: true, onClose: jest.fn(), onDecided: jest.fn(), onNeedsRefresh: jest.fn(), ...over };
    return { ...wrap(<DeferralReviewSheet {...props} />), props };
  };

  it("approval takes two deliberate steps and reports only after the server accepts", async () => {
    api.decidePmDeferral.mockResolvedValue(undefined);
    const { getByTestId, props } = open();
    fireEvent.press(getByTestId("pm-review-approve"));
    expect(api.decidePmDeferral).not.toHaveBeenCalled();
    expect(getByTestId("pm-review-confirm-text")).toBeTruthy();
    fireEvent.press(getByTestId("pm-review-confirm"));
    await waitFor(() => expect(props.onDecided).toHaveBeenCalledWith("approved"));
    expect(api.decidePmDeferral).toHaveBeenCalledWith("d1", "approved", "");
  });

  it("the requester cannot decide their own request: both actions are off and the reason is given", () => {
    const { getByTestId } = open({ userId: "u-requester" });
    expect(getByTestId("pm-review-self")).toBeTruthy();
    expect(getByTestId("pm-review-approve").props.accessibilityState).toMatchObject({ disabled: true });
    expect(getByTestId("pm-review-reject").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("a line engineer cannot decide", () => {
    const { getByTestId } = open({ role: "engineer" });
    expect(getByTestId("pm-review-approve").props.accessibilityState).toMatchObject({ disabled: true });
    expect(getByTestId("pm-review-reject").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("a stale request can be rejected but not approved", () => {
    const { getByTestId } = open({}, { ...request, stale: true });
    expect(getByTestId("pm-review-stale")).toBeTruthy();
    expect(getByTestId("pm-review-approve").props.accessibilityState).toMatchObject({ disabled: true });
    expect(getByTestId("pm-review-reject").props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it("when the server says someone else decided first, it says so and asks for a refresh", async () => {
    api.decidePmDeferral.mockRejectedValue(apiError(409, "already_decided"));
    const { getByText, getByTestId, props } = open();
    fireEvent.press(getByTestId("pm-review-reject"));
    fireEvent.press(getByTestId("pm-review-confirm"));
    await waitFor(() => expect(getByText("pmMgmt.failure.already_decided")).toBeTruthy());
    expect(props.onDecided).not.toHaveBeenCalled();
    expect(props.onNeedsRefresh).toHaveBeenCalled();
  });

  it("a self-review refusal from the server is not shown as a role problem", async () => {
    api.decidePmDeferral.mockRejectedValue(apiError(403, "self_review"));
    const { getByText, getByTestId } = open();
    fireEvent.press(getByTestId("pm-review-reject"));
    fireEvent.press(getByTestId("pm-review-confirm"));
    await waitFor(() => expect(getByText("pmMgmt.failure.self_review")).toBeTruthy());
  });
});

describe("Criticality sheet", () => {
  const asset = { id: "a1", name: "Boiler", criticality: "medium" as const, row_version: 3 };
  const open = (over: Partial<React.ComponentProps<typeof CriticalitySheet>> = {}) => {
    const props = { visible: true, asset, isOnline: true, onClose: jest.fn(), onChanged: jest.fn(), onNeedsRefresh: jest.fn(), ...over };
    return { ...wrap(<CriticalitySheet {...props} />), props };
  };

  it("cannot save an unchanged level", () => {
    const { getByTestId } = open();
    expect(getByTestId("asset-criticality-save").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("saves the chosen level with the version and a reason, then reports", async () => {
    api.setAssetCriticality.mockResolvedValue(undefined);
    const { getByTestId, props } = open();
    fireEvent.press(getByTestId("asset-criticality-life_safety"));
    fireEvent.changeText(getByTestId("asset-criticality-reason"), "Heats the whole building");
    fireEvent.press(getByTestId("asset-criticality-save"));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith("life_safety"));
    expect(api.setAssetCriticality).toHaveBeenCalledWith("a1", { criticality: "life_safety", reason: "Heats the whole building", expectedRowVersion: 3 });
  });

  it("an edit conflict asks for a refresh and does not claim success", async () => {
    api.setAssetCriticality.mockRejectedValue(apiError(409, "asset_conflict"));
    const { getByText, getByTestId, props } = open();
    fireEvent.press(getByTestId("asset-criticality-high"));
    fireEvent.press(getByTestId("asset-criticality-save"));
    await waitFor(() => expect(getByText("pmMgmt.failure.version_conflict")).toBeTruthy());
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(props.onNeedsRefresh).toHaveBeenCalled();
  });
});
