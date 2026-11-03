import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockParams: { scheduleId?: string } = {};
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/api/pmManagement", () => ({
  createPmSchedule: jest.fn(),
  updatePmSchedule: jest.fn(),
  assignPmChecklist: jest.fn(),
  deactivatePmSchedule: jest.fn(),
}));
jest.mock("@/lib/api/assets", () => ({ browseAssets: jest.fn() }));
jest.mock("@/lib/api/pm", () => ({ listPmTemplates: jest.fn() }));
jest.mock("@/components/engineering/assets/form/DateField", () => {
  const { TextInput } = require("react-native");
  return { DateField: ({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID: string }) => <TextInput value={value} onChangeText={onChange} testID={testID} /> };
});
const mockReload = jest.fn();
let mockSchedules: unknown[] = [];
jest.mock("@/lib/engineering/usePmSchedules", () => ({
  usePmSchedules: () => ({ schedules: mockSchedules, loading: false, failure: null, hasData: true, reload: mockReload }),
}));
let mockOnline = true;
let mockRole = "chief_engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, hotelTimezone: "America/Chicago", user: { id: "u1", role: mockRole, tenant_id: "h1" } })),
  };
});

import { router } from "expo-router";
import * as pmMgmt from "@/lib/api/pmManagement";
import * as assetsApi from "@/lib/api/assets";
import * as pmApi from "@/lib/api/pm";
import PmScheduleFormScreen from "@/app/(app)/pm-schedules/management/schedule-form";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";

const m = pmMgmt as unknown as Record<string, jest.Mock>;
const browse = assetsApi.browseAssets as unknown as jest.Mock;
const templates = pmApi.listPmTemplates as unknown as jest.Mock;
const apiError = (status: number, code?: string, message = "x") => Object.assign(new Error(message), { status, code });
const flush = () => act(async () => { await Promise.resolve(); });
const screen = () => render(<ThemeProvider><ToastProvider><PmScheduleFormScreen /></ToastProvider></ThemeProvider>);

const TEMPLATES = [
  { id: "t1", name: "Chiller PM", version: 2, is_active: true, items: { checklist: [{ label: "Check belt", requires_evidence: true }, { label: "Check oil" }] } },
  { id: "t2", name: "Boiler PM", version: 1, is_active: true, items: { checklist: [{ label: "Check flame" }] } },
];
const SCHEDULE = {
  id: "s1", name: "Chiller quarterly", description: "Old text", assetName: "Chiller 1", intervalType: "quarterly", intervalDays: null,
  estimatedMinutes: 45, recurrenceBasis: "scheduled_date", rowVersion: 3, nextDueAt: "2026-12-01T18:00:00Z",
  checklist: { state: "ready", templateId: "t1" },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.scheduleId;
  mockOnline = true;
  mockRole = "chief_engineer";
  mockSchedules = [SCHEDULE];
  templates.mockResolvedValue(TEMPLATES);
  browse.mockResolvedValue({ rows: [{ id: "a1", name: "Chiller 1", asset_tag: "CH-1", location_text: "Roof", asset_categories: { name: "HVAC" } }], hasMore: false, total: 1 });
});

describe("Create PM Schedule", () => {
  it("builds the exact request from real equipment, a real procedure and a hotel-local first due date", async () => {
    m.createPmSchedule.mockResolvedValue({ id: "newsched" });
    const { getByTestId } = screen();
    await waitFor(() => expect(getByTestId("pm-form-asset-a1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-form-asset-a1"));
    await waitFor(() => expect(getByTestId("pm-form-template-t1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-form-template-t1"));
    fireEvent.press(getByTestId("pm-form-interval-quarterly"));
    fireEvent.changeText(getByTestId("pm-form-first-due"), "2099-03-10");
    fireEvent.press(getByTestId("pm-form-submit"));
    await waitFor(() => expect(m.createPmSchedule).toHaveBeenCalledTimes(1));
    expect(m.createPmSchedule).toHaveBeenCalledWith({
      asset_id: "a1", name: "Chiller 1", description: null, interval_type: "quarterly", interval_days: null,
      estimated_minutes: 30, next_due_at: "2099-03-10T17:00:00.000Z", recurrence_basis: "scheduled_date", checklist_template_id: "t1",
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("refuses to submit an incomplete form and says what is missing", async () => {
    const { getByTestId } = screen();
    await flush();
    fireEvent.press(getByTestId("pm-form-submit"));
    await flush();
    expect(m.createPmSchedule).not.toHaveBeenCalled();
    expect(getByTestId("pm-form-error-asset_missing")).toBeTruthy();
    expect(getByTestId("pm-form-error-name_missing")).toBeTruthy();
    expect(getByTestId("pm-form-error-checklist_missing")).toBeTruthy();
  });

  it("a double tap creates one schedule", async () => {
    let release: (v: unknown) => void = () => undefined;
    m.createPmSchedule.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { getByTestId } = screen();
    await waitFor(() => expect(getByTestId("pm-form-asset-a1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-form-asset-a1"));
    await waitFor(() => expect(getByTestId("pm-form-template-t1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-form-template-t1"));
    fireEvent.changeText(getByTestId("pm-form-first-due"), "2099-03-10");
    fireEvent.press(getByTestId("pm-form-submit"));
    fireEvent.press(getByTestId("pm-form-submit"));
    expect(m.createPmSchedule).toHaveBeenCalledTimes(1);
    await act(async () => release({ id: "x" }));
  });

  it("reports a failed create honestly and never navigates as if it worked", async () => {
    m.createPmSchedule.mockRejectedValue(new Error("Network request failed"));
    const { getByTestId, getByText } = screen();
    await waitFor(() => expect(getByTestId("pm-form-asset-a1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-form-asset-a1"));
    await waitFor(() => expect(getByTestId("pm-form-template-t1")).toBeTruthy());
    fireEvent.press(getByTestId("pm-form-template-t1"));
    fireEvent.changeText(getByTestId("pm-form-first-due"), "2099-03-10");
    fireEvent.press(getByTestId("pm-form-submit"));
    await waitFor(() => expect(getByText("pmMgmt.failure.unconfirmed")).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("with no active procedure it says so instead of offering a schedule that could not run", async () => {
    templates.mockResolvedValue([]);
    const { findByTestId } = screen();
    expect(await findByTestId("pm-form-no-templates")).toBeTruthy();
  });

  it("an engineer is sent away: nothing is fetched", async () => {
    mockRole = "engineer";
    screen();
    await flush();
    expect(templates).not.toHaveBeenCalled();
    expect(browse).not.toHaveBeenCalled();
  });
});

describe("Edit PM Schedule", () => {
  beforeEach(() => { mockParams.scheduleId = "s1"; });

  it("has no due-date field: postponing is a deferral, not an edit", async () => {
    const { queryByTestId, getByTestId } = screen();
    await flush();
    expect(queryByTestId("pm-form-first-due")).toBeNull();
    expect(getByTestId("pm-form-due-note")).toBeTruthy();
    expect(getByTestId("pm-form-name").props.value).toBe("Chiller quarterly");
  });

  it("saving is disabled until something changes, then sends only the change and the version", async () => {
    m.updatePmSchedule.mockResolvedValue(undefined);
    const { getByTestId } = screen();
    await flush();
    expect(getByTestId("pm-form-submit").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(getByTestId("pm-form-name"), "Chiller annual");
    fireEvent.press(getByTestId("pm-form-submit"));
    await waitFor(() => expect(m.updatePmSchedule).toHaveBeenCalledWith("s1", { name: "Chiller annual" }, 3));
    expect(m.assignPmChecklist).not.toHaveBeenCalled();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it("changing the procedure warns about drafts and past inspections, then binds it separately", async () => {
    m.assignPmChecklist.mockResolvedValue(undefined);
    const { getByTestId, findByTestId } = screen();
    fireEvent.press(await findByTestId("pm-form-template-t2"));
    expect(getByTestId("pm-form-checklist-warning")).toBeTruthy();
    fireEvent.press(getByTestId("pm-form-submit"));
    await waitFor(() => expect(m.assignPmChecklist).toHaveBeenCalledWith("s1", "t2"));
    expect(m.updatePmSchedule).not.toHaveBeenCalled();
  });

  it("a stale version is refused, explained and the schedule is re-read", async () => {
    m.updatePmSchedule.mockRejectedValue(apiError(409, "version_conflict"));
    const { getByTestId, getByText } = screen();
    await flush();
    fireEvent.changeText(getByTestId("pm-form-name"), "Other");
    fireEvent.press(getByTestId("pm-form-submit"));
    await waitFor(() => expect(getByText("pmMgmt.failure.version_conflict")).toBeTruthy());
    expect(mockReload).toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("if the details saved but the procedure did not, it says exactly that", async () => {
    m.updatePmSchedule.mockResolvedValue(undefined);
    m.assignPmChecklist.mockRejectedValue(apiError(422, undefined, "Template inactive"));
    const { getByTestId, findByTestId } = screen();
    fireEvent.press(await findByTestId("pm-form-template-t2"));
    fireEvent.changeText(getByTestId("pm-form-name"), "Renamed");
    fireEvent.press(getByTestId("pm-form-submit"));
    await waitFor(() => expect(getByTestId("pm-form-partial")).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });

  it("deactivating needs an explicit confirmation that says history stays", async () => {
    m.deactivatePmSchedule.mockResolvedValue(undefined);
    const { getByTestId, getByText } = screen();
    await flush();
    fireEvent.press(getByTestId("pm-form-deactivate"));
    expect(m.deactivatePmSchedule).not.toHaveBeenCalled();
    expect(getByText("pmMgmt.form.deactivateEffects")).toBeTruthy();
    fireEvent.press(getByTestId("pm-form-deactivate-confirm"));
    await waitFor(() => expect(m.deactivatePmSchedule).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("a schedule that no longer exists shows an empty state, not a blank form", async () => {
    mockSchedules = [];
    const { queryByTestId } = screen();
    await flush();
    expect(queryByTestId("pm-form-submit")).toBeNull();
  });
});
