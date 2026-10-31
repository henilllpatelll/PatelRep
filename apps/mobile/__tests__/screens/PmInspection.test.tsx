import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ scheduleId: "s1" }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${Object.values(o).length ? `:${Object.values(o).join(",")}` : ""}` : k),
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/housekeeping/useHotelTimezone", () => ({ useHotelTimezone: () => undefined }));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn().mockResolvedValue({ ok: true, uri: "file:///picked.jpg" }),
  prepareForUpload: jest.fn().mockImplementation(async (uri: string) => uri),
}));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
jest.mock("@/lib/api/pm", () => ({
  listPmTemplates: jest.fn(),
  listAssetMeters: jest.fn(),
  submitPmCompletion: jest.fn(),
  uploadPmEvidence: jest.fn(),
  deletePmEvidence: jest.fn().mockResolvedValue(undefined),
}));
let mockOnline = true;
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      user: { id: "u1", tenant_id: "h1", role: mockRole, full_name: "Eli Park" },
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
    })),
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { listPmSchedules } from "@/lib/api/assets";
import { listAssetMeters, listPmTemplates, submitPmCompletion, uploadPmEvidence } from "@/lib/api/pm";
import PmInspectionScreen from "@/app/(app)/pm-schedules/inspect/[scheduleId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetPmScheduleCache } from "@/lib/engineering/usePmSchedules";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { loadPmDraft } from "@/lib/engineering/pmDraftStore";

const schedulesApi = listPmSchedules as jest.Mock;
const templatesApi = listPmTemplates as jest.Mock;
const metersApi = listAssetMeters as jest.Mock;
const submitApi = submitPmCompletion as jest.Mock;
const uploadApi = uploadPmEvidence as jest.Mock;

const scheduleRow = { id: "s1", asset_id: "asset-1", name: "Boiler PM", interval_type: "monthly", next_due_at: new Date().toISOString(), is_active: true, assets: { name: "Boiler 1" } };
const template = {
  id: "t1",
  name: "Boiler inspection",
  version: 2,
  items: { checklist: [{ key: "valve", label: "Relief valve", requires_evidence: true }, { key: "leaks", label: "No leaks" }] },
};

const renderScreen = () =>
  render(
    <ThemeProvider>
      <PmInspectionScreen />
    </ThemeProvider>,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  [schedulesApi, templatesApi, metersApi, submitApi, uploadApi].forEach((m) => m.mockReset());
  await AsyncStorage.clear();
  setQueueOwner("h1:u1");
  resetPmScheduleCache();
  mockOnline = true;
  mockRole = "engineer";
  schedulesApi.mockResolvedValue([scheduleRow]);
  templatesApi.mockResolvedValue([template]);
  metersApi.mockResolvedValue([{ id: "m1", name: "Pressure", unit: "psi", warning_high: 20, critical_high: 25 }]);
});

async function openStep(utils: ReturnType<typeof renderScreen>, id: string) {
  fireEvent.press(await utils.findByTestId(`pm-item-toggle-${id}`));
}

describe("PM inspection", () => {
  it("records a guided inspection end to end: answers, a photo, a failed step, then a server-confirmed result", async () => {
    uploadApi.mockResolvedValue("ev-1");
    submitApi.mockResolvedValue({ id: "c1", pm_schedule_id: "s1", completed_at: "x", corrective_work_orders: [{ id: "wo-9", title: "Corrective PM work: No leaks" }] });
    const ui = renderScreen();

    expect((await ui.findByTestId("pm-progress"))).toBeTruthy();
    expect(ui.getByTestId("pm-draft-label").props.children).toBe("pm.localDraftSaved");

    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-item-i0-photos-camera"));
    });
    await waitFor(() => expect(uploadApi).toHaveBeenCalledTimes(1));

    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-failed"));
    expect(ui.getByTestId("pm-item-i1-issue")).toBeTruthy();
    fireEvent.changeText(ui.getByTestId("pm-item-i1-note"), "Dripping at the union");

    fireEvent.changeText(ui.getByTestId("pm-reading-m1-input"), "22");
    expect(ui.getByTestId("pm-reading-m1-status")).toBeTruthy();

    fireEvent.press(ui.getByTestId("pm-review-button"));
    await ui.findByTestId("pm-review");
    expect(ui.getByTestId("pm-review-wo-notice")).toBeTruthy();
    expect(submitApi).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    await ui.findByTestId("pm-recorded");

    expect(submitApi).toHaveBeenCalledTimes(1);
    const [id, payload] = submitApi.mock.calls[0];
    expect(id).toBe("s1");
    expect(payload).toMatchObject({
      checklist_template_id: "t1",
      checklist_version: 2,
      condition_readings: [{ meter_id: "m1", value: 22 }],
      items: [
        { key: "valve", result: "passed", evidence: ["ev-1"] },
        { key: "leaks", result: "failed", note: "Dripping at the union", evidence: [] },
      ],
    });
    expect(ui.getByTestId("pm-recorded-wo-wo-9")).toBeTruthy(); // listed only because the server returned it
    expect(ui.getByTestId("pm-recorded-issues").props.children).toBe("pm.recorded.issues:1");
    expect(await loadPmDraft("s1")).toBeNull();

    fireEvent.press(ui.getByTestId("pm-recorded-wo-wo-9"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-9");
    fireEvent.press(ui.getByTestId("pm-recorded-view"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/pm-schedules/record/c1?scheduleId=s1");
  });

  it("cannot be completed while steps are unanswered, lists them in the review, and never posts", async () => {
    const ui = renderScreen();
    await ui.findByTestId("pm-progress");
    fireEvent.press(ui.getByTestId("pm-review-button"));
    await ui.findByTestId("pm-review");
    expect(ui.getByTestId("pm-review-jump-i0")).toBeTruthy();
    expect(ui.getByTestId("pm-review-jump-i1")).toBeTruthy();
    expect(ui.getByTestId("pm-complete-button").props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    expect(submitApi).not.toHaveBeenCalled();
  });

  it("requires the photo for a controlled step before it can be completed", async () => {
    const ui = renderScreen();
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-passed"));
    fireEvent.press(ui.getByTestId("pm-review-button"));
    await ui.findByTestId("pm-review");
    expect(ui.getByTestId("pm-review-evidence-i0")).toBeTruthy();
    expect(ui.getByTestId("pm-complete-button").props.accessibilityState.disabled).toBe(true);
  });

  it("needs a connection to complete: the button is disabled and the limitation is stated; the draft stays local", async () => {
    mockOnline = false;
    const ui = renderScreen();
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    fireEvent.press(ui.getByTestId("pm-review-button"));
    await ui.findByTestId("pm-review");
    expect(ui.getByTestId("pm-offline-submit")).toBeTruthy();
    expect(ui.getByTestId("pm-complete-button").props.accessibilityState.disabled).toBe(true);
    expect(submitApi).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as a failure, never as success, and keeps the draft", async () => {
    uploadApi.mockResolvedValue("ev-1");
    submitApi.mockRejectedValue(Object.assign(new Error("x"), { status: 422, detail: "Evidence is required for Relief valve" }));
    const ui = renderScreen();
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-item-i0-photos-camera"));
    });
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-passed"));
    fireEvent.press(ui.getByTestId("pm-review-button"));
    await ui.findByTestId("pm-review");
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    const outcome = await ui.findByTestId("pm-outcome");
    expect(JSON.stringify(outcome.props.children)).toContain("Evidence is required for Relief valve");
    expect(ui.queryByTestId("pm-recorded")).toBeNull();
    expect(submitApi).toHaveBeenCalledTimes(1);
  });

  it("says the outcome is unknown after a network failure and does not claim success or failure", async () => {
    uploadApi.mockResolvedValue("ev-1");
    submitApi.mockRejectedValue(new Error("Network request failed"));
    const ui = renderScreen();
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-item-i0-photos-camera"));
    });
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-passed"));
    fireEvent.press(ui.getByTestId("pm-review-button"));
    await ui.findByTestId("pm-review");
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    const outcome = await ui.findByTestId("pm-outcome");
    expect(outcome.props.children).toBe("pm.errors.unknown");
    expect(ui.queryByTestId("pm-recorded")).toBeNull();
  });

  it("restores a saved draft after leaving and coming back", async () => {
    const first = renderScreen();
    await openStep(first, "i1");
    fireEvent.press(first.getByTestId("pm-item-i1-passed"));
    await waitFor(async () => expect((await loadPmDraft("s1"))?.items.i1.result).toBe("passed"), { timeout: 2000 });
    first.unmount();

    const second = renderScreen();
    await second.findByTestId("pm-progress");
    await openStep(second, "i1");
    expect(second.getByTestId("pm-item-i1-passed").props.accessibilityState.selected).toBe(true);
  });

  it("shows a configuration message - not an invented checklist - when the property has no templates", async () => {
    templatesApi.mockResolvedValue([]);
    const ui = renderScreen();
    await ui.findByTestId("pm-no-templates");
    expect(ui.queryByTestId("pm-review-button")).toBeNull();
  });

  it("asks which checklist to use when there are several, and never guesses", async () => {
    templatesApi.mockResolvedValue([template, { ...template, id: "t2", name: "Pump" }]);
    const ui = renderScreen();
    await ui.findByTestId("pm-template-picker");
    expect(ui.queryByTestId("pm-progress")).toBeNull();
    fireEvent.press(ui.getByTestId("pm-template-t2"));
    await ui.findByTestId("pm-progress");
  });

  it("blocks a draft whose checklist has changed until the technician reviews it against the new one", async () => {
    const first = renderScreen();
    await openStep(first, "i1");
    fireEvent.press(first.getByTestId("pm-item-i1-passed"));
    await waitFor(async () => expect(await loadPmDraft("s1")).not.toBeNull(), { timeout: 2000 });
    first.unmount();

    templatesApi.mockResolvedValue([{ ...template, version: 3 }]);
    const ui = renderScreen();
    await ui.findByTestId("pm-draft-incompatible");
    expect(ui.queryByTestId("pm-review-button")).toBeNull();
    fireEvent.press(ui.getByTestId("pm-draft-rebase"));
    await ui.findByTestId("pm-progress");
  });

  it("is not available to a role the API would refuse", async () => {
    mockRole = "front_desk";
    const ui = renderScreen();
    await waitFor(() => expect(ui.queryByTestId("pm-progress")).toBeNull());
    expect(templatesApi).not.toHaveBeenCalled();
    expect(submitApi).not.toHaveBeenCalled();
  });
});
