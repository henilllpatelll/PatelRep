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
    // Choosing Fail opens the failure sheet; the finding is written into the draft as it is typed.
    expect(ui.getByTestId("pm-failure-sheet")).toBeTruthy();
    fireEvent.changeText(ui.getByTestId("pm-failure-note"), "Dripping at the union");
    fireEvent.press(ui.getByTestId("pm-failure-save"));
    expect(ui.queryByTestId("pm-failure-sheet")).toBeNull();
    expect(ui.getByTestId("pm-item-i1-finding").props.children).toBe("Dripping at the union");

    fireEvent.press(ui.getByTestId("pm-step-measurements"));
    fireEvent.changeText(ui.getByTestId("pm-reading-m1-input"), "22");
    expect(ui.getByTestId("pm-reading-m1-status")).toBeTruthy();

    fireEvent.press(ui.getByTestId("pm-step-review"));
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
    fireEvent.press(ui.getByTestId("pm-step-review"));
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
    fireEvent.press(ui.getByTestId("pm-step-review"));
    await ui.findByTestId("pm-review");
    expect(ui.getByTestId("pm-review-evidence-i0")).toBeTruthy();
    expect(ui.getByTestId("pm-complete-button").props.accessibilityState.disabled).toBe(true);
  });

  it("needs a connection to complete: the button is disabled and the limitation is stated; the draft stays local", async () => {
    mockOnline = false;
    const ui = renderScreen();
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    fireEvent.press(ui.getByTestId("pm-step-review"));
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
    fireEvent.press(ui.getByTestId("pm-step-review"));
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
    fireEvent.press(ui.getByTestId("pm-step-review"));
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

describe("PM inspection, field work", () => {
  async function passAll(ui: ReturnType<typeof renderScreen>) {
    uploadApi.mockResolvedValue("ev-1");
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-item-i0-photos-camera"));
    });
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-passed"));
  }

  it("names the equipment and the procedure in the header, and says where the draft is saved", async () => {
    const ui = renderScreen();
    await ui.findByTestId("pm-progress");
    expect(ui.getByText("Boiler 1 — Boiler PM")).toBeTruthy();
    expect(ui.getByText("pm.header.checklist:Boiler inspection,2")).toBeTruthy();
    fireEvent.press(ui.getByTestId("pm-step-measurements"));
    await ui.findByTestId("pm-readings");
    fireEvent.press(ui.getByTestId("pm-step-checklist"));
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-passed"));
    await waitFor(() => expect(ui.getByTestId("pm-save-state").props.children).toContain("pm.save.saved"));
  });

  it("moving between sections loses nothing that was entered", async () => {
    const ui = renderScreen();
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-passed"));
    fireEvent.press(ui.getByTestId("pm-step-measurements"));
    fireEvent.changeText(await ui.findByTestId("pm-reading-m1-input"), "18.5");
    fireEvent.press(ui.getByTestId("pm-step-findings"));
    fireEvent.changeText(await ui.findByTestId("pm-labor-input"), "45");
    fireEvent.press(ui.getByTestId("pm-step-checklist"));
    // The card is still open and still answered.
    expect(ui.getByTestId("pm-item-i1-passed").props.accessibilityState.selected).toBe(true);
    fireEvent.press(ui.getByTestId("pm-step-measurements"));
    expect(ui.getByTestId("pm-reading-m1-input").props.value).toBe("18.5");
    fireEvent.press(ui.getByTestId("pm-step-findings"));
    expect(ui.getByTestId("pm-labor-input").props.value).toBe("45");
  });

  it("offers only the meters the equipment really has", async () => {
    metersApi.mockResolvedValue([]);
    const ui = renderScreen();
    await ui.findByTestId("pm-progress");
    fireEvent.press(ui.getByTestId("pm-step-measurements"));
    expect(await ui.findByTestId("pm-no-meters")).toBeTruthy();
    expect(ui.queryByTestId("pm-reading-m1")).toBeNull();
  });

  it("dismissing the failure sheet keeps the step Failed; completion stays blocked until the finding is written, and Fix this reopens it", async () => {
    const ui = renderScreen();
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-failed"));
    expect(ui.getByTestId("pm-failure-sheet")).toBeTruthy();
    expect(ui.getByTestId("pm-failure-guidance")).toBeTruthy(); // says where an immediate danger is reported
    fireEvent.press(ui.getByTestId("pm-failure-save")); // nothing written yet
    expect(ui.getByTestId("pm-failure-error")).toBeTruthy();
    expect(ui.getByTestId("pm-failure-sheet")).toBeTruthy(); // Save did not pretend the finding was saved

    fireEvent(ui.getByTestId("pm-failure-sheet"), "requestClose"); // the Android back button
    expect(ui.queryByTestId("pm-failure-sheet")).toBeNull();

    expect(ui.getByTestId("pm-item-i1-failed").props.accessibilityState.selected).toBe(true);
    fireEvent.press(ui.getByTestId("pm-step-review"));
    await ui.findByTestId("pm-review");
    expect(ui.getByTestId("pm-review-finding-i1")).toBeTruthy();
    expect(ui.getByTestId("pm-complete-button").props.accessibilityState.disabled).toBe(true);

    fireEvent.press(ui.getByTestId("pm-review-finding-i1"));
    expect(await ui.findByTestId("pm-failure-sheet")).toBeTruthy();
    fireEvent.changeText(ui.getByTestId("pm-failure-note"), "Weeping at the relief valve");
    await waitFor(async () => expect((await loadPmDraft("s1"))?.items.i1.note).toBe("Weeping at the relief valve"), { timeout: 2000 });
  });

  it("a retry after an unknown outcome is labelled as a safe retry and re-sends the very same submission", async () => {
    submitApi.mockRejectedValueOnce(new Error("Network request failed"));
    submitApi.mockResolvedValueOnce({ id: "c1", pm_schedule_id: "s1", completed_at: "2026-11-01T18:00:00Z" });
    const ui = renderScreen();
    await passAll(ui);
    fireEvent.press(ui.getByTestId("pm-step-review"));
    await ui.findByTestId("pm-review");
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    expect((await ui.findByTestId("pm-outcome")).props.children).toBe("pm.errors.unknown");
    expect(ui.queryByTestId("pm-recorded")).toBeNull();
    expect(await loadPmDraft("s1")).not.toBeNull(); // nothing is thrown away until the server confirms

    expect(ui.getByText("pm.submit.retry")).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    await ui.findByTestId("pm-recorded");
    expect(submitApi).toHaveBeenCalledTimes(2);
    expect(submitApi.mock.calls[1][1].submission_id).toBe(submitApi.mock.calls[0][1].submission_id);
    expect(submitApi.mock.calls[1][1].submission_id).toBeTruthy();
  });

  it("shows only what the server confirmed: order numbers, the next due date, and a failed step never reads as a pass", async () => {
    uploadApi.mockResolvedValue("ev-1");
    submitApi.mockResolvedValue({
      id: "c1",
      pm_schedule_id: "s1",
      completed_at: "2026-11-01T18:00:00Z",
      next_due_at: "2026-12-01T18:00:00Z",
      corrective_work_orders: [{ id: "wo-9", title: "Corrective PM work: No leaks", work_order_number: 1042 }],
    });
    const ui = renderScreen();
    await openStep(ui, "i0");
    fireEvent.press(ui.getByTestId("pm-item-i0-passed"));
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-item-i0-photos-camera"));
    });
    await openStep(ui, "i1");
    fireEvent.press(ui.getByTestId("pm-item-i1-failed"));
    fireEvent.changeText(ui.getByTestId("pm-failure-note"), "Drip");
    fireEvent.press(ui.getByTestId("pm-failure-save"));
    fireEvent.press(ui.getByTestId("pm-step-review"));
    await ui.findByTestId("pm-review");
    await act(async () => {
      fireEvent.press(ui.getByTestId("pm-complete-button"));
    });
    await ui.findByTestId("pm-recorded");
    expect(ui.getByTestId("pm-recorded-issues").props.children).toBe("pm.recorded.issues:1");
    expect(ui.getByTestId("pm-recorded-results").props.children).toBe("pm.recorded.resultsLine:1,1,0");
    expect(ui.getByTestId("pm-recorded-next-due")).toBeTruthy();
    expect(ui.getByText(/pm\.recorded\.workOrderNumber:1042/)).toBeTruthy();
    fireEvent.press(ui.getByTestId("pm-recorded-equipment"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "asset-1" } });
  });
});
