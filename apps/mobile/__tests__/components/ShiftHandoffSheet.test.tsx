import React from "react";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  submitShiftHandoff: jest.fn(),
  fetchShiftHandoff: jest.fn(),
}));

import { router } from "expo-router";
import i18n from "@/i18n";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ShiftHandoffSheet } from "@/components/supervisor/handoff/ShiftHandoffSheet";
import { fetchShiftHandoff, submitShiftHandoff } from "@/lib/api/housekeepingSupervisor";
import type { InspectionRecordRaw } from "@/lib/api/housekeepingSupervisor";
import type { BlockedTaskItem } from "@/lib/api/tasks";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource, failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import { composeSupervisorToday, normalizeBoard, type TodaySources } from "@/lib/housekeeping/supervisorToday";

const submit = submitShiftHandoff as jest.Mock;
const fetchSaved = fetchShiftHandoff as jest.Mock;
const push = router.push as jest.Mock;

const NOW = Date.now();
const ZONE = "America/Chicago";
const SCOPE = "h1:sup-1";
const DRAFT_KEY = `@patelrep/mobile/supervisor-handoff-draft:${SCOPE}`;
const SAVED = { id: "abcdef12-0000-4000-8000-000000000000", createdAt: new Date(NOW).toISOString(), reportDate: "2026-10-16", replay: false, managers: "complete" as const };

function room(id: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: `r-${id}`, status, rooms: { id: `r-${id}`, room_number: id, floor: 1 }, ...extra };
}
const BOARD = [
  room("101", "INSPECTED"),
  room("102", "INSPECTED"),
  room("103", "CLEAN", { assigned_to: "hk-1" }),
  room("104", "IN_PROGRESS", { assigned_to: "hk-1" }),
  room("105", "DIRTY"),
  room("106", "DIRTY", { assigned_to: "hk-2" }),
  room("107", "OOO"),
];
const inspection = (id: string, result: string): InspectionRecordRaw => ({ id, overall_result: result, completed_at: new Date(NOW).toISOString() });

interface Over {
  board?: TodaySources["board"];
  inspections?: TodaySources["inspections"];
  blockedTasks?: TodaySources["blockedTasks"];
}
function todayFor(over: Over = {}) {
  return composeSupervisorToday(
    {
      board: over.board ?? availableSource(normalizeBoard(BOARD), NOW),
      staff: availableSource([], NOW),
      roster: availableSource([], NOW),
      inspections: over.inspections ?? availableSource([inspection("i1", "passed"), inspection("i2", "failed")], NOW),
      blockedTasks: over.blockedTasks ?? availableSource([], NOW),
    },
    { now: NOW, timeZone: ZONE, viewerId: "sup-1" },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const onClose = jest.fn();
const refresh = jest.fn(async () => undefined);

function elementFor(over: Over = {}, isOnline = true) {
  return (
    <ThemeProvider>
      <ShiftHandoffSheet visible today={todayFor(over)} refresh={refresh} scope={SCOPE} isOnline={isOnline} supervisorName="Sam Super" language="en" onClose={onClose} />
    </ThemeProvider>
  );
}
function mount(over: Over = {}, isOnline = true) {
  const view = render(elementFor(over, isOnline));
  return { ...view, update: (next: Over = {}, online = true) => view.rerender(elementFor(next, online)) };
}

const disabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) => Boolean(el.props.accessibilityState?.disabled);

async function toConfirm(screen: ReturnType<typeof mount>) {
  await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
  fireEvent.press(screen.getByTestId("handoff-review"));
  fireEvent.press(await screen.findByTestId("handoff-ack"));
  fireEvent.press(screen.getByTestId("handoff-continue"));
  await screen.findByTestId("handoff-step-confirm");
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  submit.mockResolvedValue(SAVED);
  fetchSaved.mockResolvedValue(null);
});

describe("Prepare", () => {
  it("shows real counts, the right denominator and real unfinished work", async () => {
    const screen = mount();
    expect(screen.getByTestId("handoff-ready")).toHaveProp("accessibilityLabel", expect.stringContaining("Ready rooms: 2, of 6 in service"));
    expect(screen.getByTestId("handoff-passed")).toHaveProp("accessibilityLabel", expect.stringContaining("Passed inspections: 1"));
    expect(screen.getByTestId("handoff-failed")).toHaveProp("accessibilityLabel", expect.stringContaining("Failed inspections: 1"));
    expect(screen.getByTestId("handoff-awaiting")).toHaveProp("accessibilityLabel", expect.stringContaining("Awaiting inspection: 1"));
    expect(screen.getByTestId("handoff-item-awaiting")).toHaveTextContent(/^1 room awaiting inspection/);
    expect(screen.getByTestId("handoff-item-unassigned")).toHaveTextContent(/^1 unassigned room/);
    expect(screen.getByTestId("handoff-item-unassigned")).toHaveTextContent(/Rooms: 105/);
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
  });

  it("is available with most rooms unfinished — nothing requires the hotel to be ready", async () => {
    const board = availableSource(normalizeBoard(Array.from({ length: 12 }, (_, i) => room(String(300 + i), "DIRTY"))), NOW);
    const screen = mount({ board });
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
    expect(screen.getByTestId("handoff-item-unassigned")).toHaveTextContent(/^12 unassigned rooms/);
  });

  it("does not turn unverified inspection results into zeros and will not advance", async () => {
    const screen = mount({ inspections: failedSource(new Error("500"), loadingSource()) });
    expect(screen.getByTestId("handoff-blocker-inspectionsUnavailable")).toHaveTextContent("Inspection results could not be verified.");
    expect(screen.getByTestId("handoff-passed")).toHaveProp("accessibilityLabel", expect.stringContaining("Not verified"));
    expect(disabled(screen.getByTestId("handoff-review"))).toBe(true);
    fireEvent.press(screen.getByTestId("handoff-review"));
    expect(screen.queryByTestId("handoff-step-review")).toBeNull();
  });

  it("says plainly when blocked tasks could not be checked, instead of listing none", async () => {
    const screen = mount({ blockedTasks: failedSource({ status: 403 }, loadingSource()) });
    expect(screen.getByTestId("handoff-blocked-unverified")).toBeTruthy();
    expect(screen.queryByTestId("handoff-unfinished-none")).toBeNull();
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false)); // optional context does not block
  });

  it("offers a refresh when the figures are not current", () => {
    const screen = mount({ board: loadingSource() });
    expect(screen.getByTestId("handoff-blocker-boardLoading")).toBeTruthy();
    const offline = mount({ board: availableSource(normalizeBoard(BOARD), NOW - 10 * 60_000) });
    expect(offline.getByTestId("handoff-blocker-boardStale")).toBeTruthy();
    expect(offline.getByTestId("handoff-refresh")).toBeTruthy();
  });
});

describe("Review and Confirm", () => {
  it("keeps the typed note across every step and back", async () => {
    const screen = mount();
    await waitFor(() => expect(screen.getByTestId("handoff-notes").props.editable).toBe(true));
    fireEvent.changeText(screen.getByTestId("handoff-notes"), "Priority: 312");
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
    fireEvent.press(screen.getByTestId("handoff-review"));
    expect(await screen.findByTestId("handoff-review-notes")).toHaveTextContent("Priority: 312");
    fireEvent.press(screen.getByTestId("handoff-edit-notes"));
    expect(screen.getByTestId("handoff-notes").props.value).toBe("Priority: 312");
  });

  it("shows read-only report details and gates Continue behind the acknowledgement", async () => {
    const screen = mount();
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
    fireEvent.press(screen.getByTestId("handoff-review"));
    await screen.findByTestId("handoff-step-review");
    expect(screen.getByText("Sam Super")).toBeTruthy();
    expect(screen.getByTestId("handoff-meta-date")).toBeTruthy();
    expect(disabled(screen.getByTestId("handoff-continue"))).toBe(true);
    fireEvent.press(screen.getByTestId("handoff-ack"));
    expect(screen.getByTestId("handoff-ack").props.accessibilityState).toMatchObject({ checked: true });
    expect(disabled(screen.getByTestId("handoff-continue"))).toBe(false);
  });

  it("drops the acknowledgement and says what moved when the figures change during review", async () => {
    const screen = mount();
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
    fireEvent.press(screen.getByTestId("handoff-review"));
    fireEvent.press(await screen.findByTestId("handoff-ack"));
    expect(disabled(screen.getByTestId("handoff-continue"))).toBe(false);

    screen.update({ inspections: availableSource([inspection("i1", "passed"), inspection("i2", "failed"), inspection("i3", "failed")], NOW) });

    await waitFor(() => expect(screen.getByTestId("handoff-changed")).toHaveTextContent(/inspection results/));
    expect(screen.getByTestId("handoff-ack").props.accessibilityState).toMatchObject({ checked: false });
    expect(disabled(screen.getByTestId("handoff-continue"))).toBe(true);
    expect(screen.getByTestId("handoff-failed")).toHaveProp("accessibilityLabel", expect.stringContaining("Failed inspections: 2"));
  });

  it("sends a change that lands on the Confirm step back to Review", async () => {
    const screen = mount();
    await toConfirm(screen);
    screen.update({ board: availableSource(normalizeBoard([...BOARD, room("108", "DIRTY")]), NOW) });
    await screen.findByTestId("handoff-step-review");
    expect(screen.getByTestId("handoff-changed")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it("explains what submitting does and does not do", async () => {
    const screen = mount();
    await toConfirm(screen);
    expect(screen.getByText("Submit shift handoff?")).toBeTruthy();
    expect(screen.getByText("This report will be saved to the housekeeping logbook for authorized management to review.")).toBeTruthy();
    expect(screen.getByText(/Outstanding tasks stay open, pending inspections stay pending/)).toBeTruthy();
    expect(screen.getByText("You are not clocked out by submitting.")).toBeTruthy();
  });
});

describe("Submitting", () => {
  it("sends the contract payload once, even when the button is tapped twice, and shows success only after the server answers", async () => {
    const pending = deferred<typeof SAVED>();
    submit.mockReturnValue(pending.promise);
    const screen = mount();
    await waitFor(() => expect(screen.getByTestId("handoff-notes").props.editable).toBe(true));
    fireEvent.changeText(screen.getByTestId("handoff-notes"), "Watch 312");
    await toConfirm(screen);

    fireEvent.press(screen.getByTestId("handoff-submit"));
    fireEvent.press(screen.getByTestId("handoff-submit"));
    // The "a send is in flight" marker is written first, then the request goes out — once.
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId("handoff-submit"));
    await act(async () => undefined);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Handoff submitted")).toBeNull(); // not yet: the server has not answered
    expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) as string)).toMatchObject({ attempted: true });

    const payload = submit.mock.calls[0][0];
    expect(payload).toMatchObject({
      rooms: { total: 7, out_of_order: 1, ready: 2, awaiting_inspection: 1, in_progress: 1, to_clean: 2 },
      inspections: { passed: 1, failed: 1, conditional: 0 },
      unresolved: { unassigned_rooms: 1, unassigned_room_numbers: ["105"], awaiting_inspection_room_numbers: ["103"], blocked_tasks: 0 },
      notes: "Watch 312",
    });
    expect(payload.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload).not.toHaveProperty("rooms_failed");

    await act(async () => pending.resolve(SAVED));
    expect(await screen.findByText("Handoff submitted")).toBeTruthy();
    expect(screen.getByText("Your housekeeping shift report has been saved.")).toBeTruthy();
    expect(screen.getByTestId("handoff-saved-ref")).toHaveTextContent(/#ABCDEF12/);
    expect(screen.getByTestId("handoff-still-open")).toHaveTextContent(/Submitting did not clock you out./);
    expect(screen.getByTestId("handoff-managers")).toHaveTextContent(/Managers were notified./);
    expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull(); // the draft is cleared only on confirmed success
  });

  it("opens the saved report from the success screen", async () => {
    const screen = mount();
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    fireEvent.press(await screen.findByTestId("handoff-view-report"));
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/(app)/logbook/${encodeURIComponent(SAVED.id)}`);
  });

  it("only touches the handoff endpoints: nothing here can clock out, resolve or complete work", async () => {
    const screen = mount();
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    await screen.findByText("Handoff submitted");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(fetchSaved).not.toHaveBeenCalled();
    expect(refresh.mock.calls.length).toBeGreaterThan(0); // reads only
  });

  it("keeps the note and tells the truth when the server rejects it", async () => {
    submit.mockRejectedValue(Object.assign(new Error("Housekeeping department could not be identified."), { status: 422, code: "housekeeping_department_missing" }));
    const screen = mount();
    await waitFor(() => expect(screen.getByTestId("handoff-notes").props.editable).toBe(true));
    fireEvent.changeText(screen.getByTestId("handoff-notes"), "Keep me");
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    expect(await screen.findByTestId("handoff-notice-departmentMissing")).toHaveTextContent("Housekeeping department could not be identified.");
    expect(screen.queryByText("Handoff submitted")).toBeNull();
    expect(fetchSaved).not.toHaveBeenCalled(); // a definite "no" needs no check
    expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) as string)).toMatchObject({ notes: "Keep me", attempted: false });
    expect(disabled(screen.getByTestId("handoff-submit"))).toBe(false); // can fix and retry
  });

  it("returns to Review with fresh figures when inspections changed under the supervisor", async () => {
    submit.mockRejectedValue(Object.assign(new Error("changed"), { status: 409, code: "inspection_counts_changed" }));
    const screen = mount();
    await toConfirm(screen);
    const before = refresh.mock.calls.length;
    fireEvent.press(screen.getByTestId("handoff-submit"));
    await screen.findByTestId("handoff-step-review");
    expect(screen.getByTestId("handoff-notice-countsChanged")).toBeTruthy();
    expect(refresh.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId("handoff-ack").props.accessibilityState).toMatchObject({ checked: false });
  });

  it("checks the server, never blindly resends, after a timeout — and a retry reuses the same key", async () => {
    submit.mockRejectedValueOnce(new Error("Request timed out. Please try again."));
    fetchSaved.mockResolvedValueOnce(null);
    const screen = mount();
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    expect(await screen.findByTestId("handoff-notice-notSaved")).toHaveTextContent("It was not saved. You can submit again safely.");
    expect(submit).toHaveBeenCalledTimes(1);
    const firstKey = submit.mock.calls[0][0].client_request_id;
    expect(fetchSaved).toHaveBeenCalledWith(firstKey);

    fireEvent.press(screen.getByTestId("handoff-submit"));
    expect(await screen.findByText("Handoff submitted")).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].client_request_id).toBe(firstKey);
  });

  it("shows the report instead of resubmitting when the server turns out to have it", async () => {
    submit.mockRejectedValueOnce(new Error("Network request failed"));
    fetchSaved.mockResolvedValueOnce({ ...SAVED, replay: true });
    const screen = mount();
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    expect(await screen.findByText("Handoff submitted")).toBeTruthy();
    expect(screen.getByText("This handoff was already submitted. Here is the saved report.")).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("will not offer another send while it cannot tell whether the last one was saved", async () => {
    submit.mockRejectedValueOnce(new Error("Request timed out. Please try again."));
    fetchSaved.mockRejectedValue(new Error("Network request failed"));
    const screen = mount();
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    const notice = await screen.findByTestId("handoff-notice-verifyFailed");
    expect(notice).toHaveTextContent(/We couldn't confirm whether this handoff was saved\./);
    expect(disabled(screen.getByTestId("handoff-submit"))).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);

    fetchSaved.mockResolvedValueOnce(null);
    fireEvent.press(screen.getByTestId("handoff-check-again"));
    await waitFor(() => expect(disabled(screen.getByTestId("handoff-submit"))).toBe(false));
  });

  it("cannot be submitted offline, and says why", async () => {
    const screen = mount();
    await toConfirm(screen);
    screen.update({}, false);
    expect(await screen.findByTestId("handoff-offline")).toHaveTextContent("Connect to the internet to submit this handoff.");
    expect(disabled(screen.getByTestId("handoff-submit"))).toBe(true);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports an incomplete manager notification honestly and can finish it with the same request", async () => {
    submit.mockResolvedValueOnce({ ...SAVED, managers: "failed" });
    const screen = mount();
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    expect(await screen.findByTestId("handoff-managers")).toHaveTextContent(/Saved, but managers could not be notified yet./);
    const firstPayload = submit.mock.calls[0][0];
    submit.mockResolvedValueOnce({ ...SAVED, replay: true, managers: "complete" });
    fireEvent.press(screen.getByTestId("handoff-notify-again"));
    await waitFor(() => expect(screen.getByTestId("handoff-managers")).toHaveTextContent(/Managers were notified./));
    expect(submit.mock.calls[1][0]).toBe(firstPayload); // same payload, same key: finishes the notices, adds no report
  });
});

describe("Draft and closing", () => {
  it("restores a kept note and key, scoped to this person", async () => {
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ notes: "From before", requestId: "22222222-2222-4222-8222-222222222222", attempted: false, savedAt: Date.now() }));
    const screen = mount();
    await waitFor(() => expect(screen.getByTestId("handoff-notes").props.value).toBe("From before"));
    await toConfirm(screen);
    fireEvent.press(screen.getByTestId("handoff-submit"));
    await screen.findByText("Handoff submitted");
    expect(submit.mock.calls[0][0].client_request_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("checks a half-finished earlier submit on open and shows the saved report if it landed", async () => {
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ notes: "", requestId: "33333333-3333-4333-8333-333333333333", attempted: true, savedAt: Date.now() }));
    fetchSaved.mockResolvedValue({ ...SAVED, replay: true });
    const screen = mount();
    expect(await screen.findByText("Handoff submitted")).toBeTruthy();
    expect(fetchSaved).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
    expect(screen.getByText("This handoff was already submitted. Here is the saved report.")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it("keeps the note on the phone while typing", async () => {
    const screen = mount();
    await waitFor(() => expect(screen.getByTestId("handoff-notes").props.editable).toBe(true));
    fireEvent.changeText(screen.getByTestId("handoff-notes"), "Call GM at 5");
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) as string)).toMatchObject({ notes: "Call GM at 5" }));
  });

  it("warns before discarding a written note, and clears it only on an explicit discard", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const screen = mount();
    await waitFor(() => expect(screen.getByTestId("handoff-notes").props.editable).toBe(true));
    fireEvent.changeText(screen.getByTestId("handoff-notes"), "Important");
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).not.toBeNull());
    fireEvent.press(screen.getByTestId("handoff-cancel"));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>;
    act(() => buttons.find((b) => b.style === "destructive")?.onPress?.());
    expect(onClose).toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull());
    alert.mockRestore();
  });

  it("closes without a warning when nothing was written", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const screen = mount();
    fireEvent.press(screen.getByTestId("handoff-cancel"));
    expect(alert).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe("Spanish", () => {
  it("renders the whole flow in Spanish", async () => {
    await i18n.changeLanguage("es");
    try {
      const screen = mount();
      expect(screen.getByText("Entrega de turno")).toBeTruthy();
      expect(screen.getByText("Revise los resultados de limpieza de hoy y el trabajo pendiente.")).toBeTruthy();
      await waitFor(() => expect(disabled(screen.getByTestId("handoff-review"))).toBe(false));
      expect(screen.getByText("Revisar entrega")).toBeTruthy();
      fireEvent.press(screen.getByTestId("handoff-review"));
      expect(await screen.findByText("He revisado esta entrega y el trabajo pendiente.")).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
