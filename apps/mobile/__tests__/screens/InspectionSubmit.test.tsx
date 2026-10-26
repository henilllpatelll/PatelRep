import { act, fireEvent } from "@testing-library/react-native";
import {
  AsyncStorage,
  mockCapture,
  mockComplete,
  mockDeleteRoomEvidence,
  mockDetail,
  mockPoke,
  mockQueue,
  mockReadBack,
  mockState,
  mockSubmitLegacy,
  navigate,
  openWorkspace as open,
  replace,
  resetWorld,
  room205,
  useAppStore,
} from "../helpers/workspaceMocks";
import { allStrings, en, es, flush, settle } from "../helpers/workspaceHarness";
import { readyRoom } from "../helpers/inspectionFixtures";
import { createDraft } from "@/lib/inspections/draft";
import { draftKey, writeDraft } from "@/lib/inspections/draftStore";
import { normalizeTemplate } from "@/lib/inspections/templates";
import { chooseAnswer } from "@/lib/inspections/workspace";
import { standardTemplate } from "../helpers/workspaceHarness";

/* ─── Approving a room, requesting a correction, and not knowing ─────────────
   The real screen, hook, rules and components run; only the network, the router, the camera and the clock are faked.
   What these prove: nothing is shown as approved before the server says so, one submission id travels with the draft,
   a double tap sends once, an unknown outcome is resolved by reading it back, and a recorded inspection takes its
   draft and photos with it - while a failure whose correction is missing keeps them. They do NOT prove a real
   network, camera or device (see the PR for what was checked by hand). */

let dateNow: jest.SpyInstance;
beforeEach(async () => {
  dateNow = await resetWorld();
});
afterEach(async () => {
  await flush();
  dateNow.mockRestore();
});

type Opened = Awaited<ReturnType<typeof open>>;
const KEY = draftKey("hotel-1", "sup-1", "room-205");
const COMPLETED = "2026-10-20T18:04:00Z";

/** The server's reply to a recorded inspection, for the submission id that was sent. */
const recorded = (body: { client_submission_id: string; overall_result: string; reinspection_of?: string }, extra: Record<string, unknown> = {}) => ({
  data: {
    id: body.client_submission_id,
    overall_result: body.overall_result,
    reclean_requested: body.overall_result === "failed",
    inspection: { id: body.client_submission_id, completed_at: COMPLETED },
    replayed: false,
    correction_kind: body.overall_result === "failed" ? "touch_up" : null,
    reinspection_of: body.reinspection_of ?? null,
    correction: null,
    followup_complete: true,
    ...extra,
  },
});
const created = (over: Record<string, unknown> = {}) => ({
  status: "created",
  task: { id: "task-1", status: "open", priority: "urgent", assigned_to: "hk-1", assigned_name: "Maria S.", ...over },
});

async function finishAllPass(o: Opened) {
  for (const id of ["toilet", "mirror", "towels"]) await o.answer(id, "pass");
  await o.press("workspace-section-Bedroom");
  await o.answer("bed", "pass");
  await o.press("workspace-section-Entry");
  await o.answer("door", "pass");
  await o.press("workspace-review");
}

const typeNote = (o: Opened, value: string) => act(async () => fireEvent.changeText(o.screen.getByTestId("workspace-issue-note"), value));

/** One issue (mirror, minor, with a note); everything else passes. */
async function finishWithIssue(o: Opened, { severity = "minor" }: { severity?: "minor" | "major" } = {}) {
  for (const id of ["toilet", "towels"]) await o.answer(id, "pass");
  await o.answer("mirror", "fail");
  await typeNote(o, "Streaks on glass");
  await o.press(`workspace-issue-severity-${severity}`);
  await o.press("workspace-issue-save");
  await o.press("workspace-section-Bedroom");
  await o.answer("bed", "pass");
  await o.press("workspace-section-Entry");
  await o.answer("door", "pass");
  await o.press("workspace-review");
}

const sentBody = (call = 0) => mockComplete.mock.calls[call][0] as Record<string, any>;

describe("a passed inspection", () => {
  it("sends the real contract: stable ids, the derived result, guards, and nothing else", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    expect(mockComplete).not.toHaveBeenCalled(); // reviewing sends nothing
    await o.press("workspace-submit");
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const body = sentBody();
    expect(body).toMatchObject({
      room_id: "room-205",
      template_id: "t1",
      template_fingerprint: "fp-1",
      overall_result: "passed",
      expected_hotel_id: "hotel-1",
      expected_clean_cycle_id: "cycle-1",
    });
    expect(body.client_submission_id).toMatch(/[0-9a-f-]{36}/);
    expect(body.reinspection_of).toBeUndefined();
    expect(body.items).toHaveLength(6 - 1); // the optional "lamp" was never looked at: it is not sent, and not counted as passed
    expect(body.items.every((item: any) => item.result === "pass")).toBe(true);
    expect(body).not.toHaveProperty("inspected_by");
    expect(body).not.toHaveProperty("hotel_id");
    expect(mockSubmitLegacy).not.toHaveBeenCalled(); // never the legacy endpoint
    expect(mockComplete.mock.calls[0][1]).toEqual([]); // no photos for a pass
  });

  it("is not approved until the server says so, then shows the server's room, time and the next step", async () => {
    let reply: (value: unknown) => void = () => undefined;
    mockComplete.mockImplementation((body) => new Promise((resolve) => (reply = () => resolve(recorded(body)))));
    mockQueue.mockResolvedValue([room205(), readyRoom("room-305", { room_number: "305", floor: 3, room_type_id: "type-king" })]);
    const o = await open();
    await finishAllPass(o);
    await o.press("workspace-submit");
    expect(o.has("result-approved")).toBe(false); // sent, not yet confirmed
    expect(o.screen.queryByText("Room 205 approved")).toBeNull();
    expect(o.screen.getByTestId("workspace-submit").props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => reply(null));
    await settle();
    expect(o.text("result-title")).toBe("Room 205 approved");
    expect(o.text("result-ready")).toBe("Verified ready");
    expect(o.text("result-time")).toContain("1:04 PM"); // the server's completion time, in the hotel's zone
    expect(o.screen.getByText(/does not change the room's status in your PMS/)).toBeTruthy();
    expect(o.has("result-next")).toBe(true);
  });

  it("clears only this inspection's draft and photos once the server confirmed it, and refreshes everything that shows the room", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
    await o.press("workspace-submit");
    await settle();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(mockDeleteRoomEvidence).toHaveBeenCalledWith({ hotelId: "hotel-1", userId: "sup-1", roomId: "room-205" });
    expect(mockPoke).toHaveBeenCalled(); // Room Board, Home and the queue re-read the shared channel
    expect(mockQueue.mock.calls.length).toBeGreaterThanOrEqual(2); // the queue itself was re-read
  });

  it("a double tap sends one request", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    await act(async () => {
      fireEvent.press(o.screen.getByTestId("workspace-submit"));
      fireEvent.press(o.screen.getByTestId("workspace-submit"));
    });
    await settle();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("'Inspect next room' opens the next room from the verified queue, never the one just finished", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    mockQueue.mockResolvedValue([room205(), readyRoom("room-305", { room_number: "305", floor: 3, room_type_id: "type-king" })]);
    const o = await open();
    await finishAllPass(o);
    await o.press("workspace-submit");
    await settle();
    await o.press("result-next");
    expect(replace).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-305", from: "queue", roomNumber: "305" } });
  });

  it("with no other room waiting it says so and only offers the queue", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    mockQueue.mockResolvedValue([room205()]);
    const o = await open();
    await finishAllPass(o);
    await o.press("workspace-submit");
    await settle();
    mockQueue.mockResolvedValue([]); // and the refreshed queue is empty
    await settle();
    expect(o.has("result-next")).toBe(false);
    expect(o.text("result-no-next")).toContain("No other room is waiting");
    await o.press("result-queue");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });

  it("the optional inspector note is sent, trimmed", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    await act(async () => fireEvent.changeText(o.screen.getByTestId("workspace-review-notes-input"), "  Ready for the 3pm arrival  "));
    await o.press("workspace-submit");
    expect(sentBody().notes).toBe("Ready for the 3pm arrival");
  });

  it("is announced in Spanish too", async () => {
    mockState.language = "es";
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-title")).toBe(es("inspect.result.approved.title", { room: "205" }));
    expect(allStrings(o.screen).filter((text) => text.startsWith("inspect."))).toEqual([]); // no raw keys
  });
});

describe("a failed inspection", () => {
  it("sends the failed item with its note, severity and photo, and the derived result", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body, { correction: created() }));
    const o = await open();
    for (const id of ["toilet", "towels"]) await o.answer(id, "pass");
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    await typeNote(o, "Streaks on glass");
    await o.press("workspace-issue-severity-minor");
    await o.press("workspace-issue-save");
    await o.press("workspace-section-Bedroom");
    await o.answer("bed", "pass");
    await o.press("workspace-section-Entry");
    await o.answer("door", "pass");
    await o.press("workspace-review");
    expect(o.screen.getByText("Submit & request correction")).toBeTruthy();
    expect(o.screen.queryByText("Approve room")).toBeNull();
    await o.press("workspace-submit");
    expect(sentBody()).toMatchObject({ overall_result: "failed" });
    const mirror = sentBody().items.find((item: any) => item.template_item_id === "mirror");
    expect(mirror).toEqual({ template_item_id: "mirror", result: "fail", note: "Streaks on glass", severity: "minor" });
    expect(mockComplete.mock.calls[0][1]).toEqual([{ itemId: "mirror", uri: expect.stringContaining("mirror-t") }]);
  });

  it("shows 'Correction requested' only from the server's records: who was given the work, and that the room stays blocked", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body, { correction: created() }));
    const o = await open();
    await finishWithIssue(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-title")).toBe("Correction requested");
    expect(o.text("result-blocked")).toBe("Room 205 remains blocked.");
    expect(o.text("result-issues")).toContain("Bathroom mirrors");
    expect(o.text("result-owner")).toBe("Maria S.");
    expect(o.text("result-status")).toBe("Assigned, awaiting acknowledgement"); // assigned is not acknowledged
    expect(o.text("result-priority")).toBe("Urgent");
    expect(o.screen.queryByText("Room 205 approved")).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull(); // fully recorded: nothing left to keep
  });

  it("an unowned correction says Unassigned instead of inventing a person", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body, { correction: created({ assigned_to: null, assigned_name: null }) }));
    const o = await open();
    await finishWithIssue(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-owner")).toBe("Unassigned");
    expect(o.text("result-status")).toBe("Unassigned, needs an owner");
  });

  it("a recorded failure whose correction was not created keeps the room blocked, says so, keeps the evidence, and retries the SAME submission", async () => {
    mockComplete
      .mockImplementationOnce(async (body) => recorded(body, { correction: { status: "failed", task: null }, followup_complete: false }))
      .mockImplementationOnce(async (body) => recorded(body, { correction: { status: "existing", task: created().task } }));
    const o = await open();
    await finishWithIssue(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-title")).toBe("Inspection recorded, correction not confirmed");
    expect(o.text("result-blocked")).toBe("Room 205 remains blocked.");
    expect(o.has("result-owner")).toBe(false); // no owner is claimed
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull(); // the evidence is kept
    expect(mockDeleteRoomEvidence).not.toHaveBeenCalled();
    await o.press("result-retry");
    await settle();
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(sentBody(1).client_submission_id).toBe(sentBody(0).client_submission_id); // never a new id
    expect(o.text("result-title")).toBe("Correction requested");
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it("an issue without a severity cannot be sent, and the screen says why", async () => {
    const o = await open();
    for (const id of ["toilet", "towels"]) await o.answer(id, "pass");
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-save"); // saved without choosing a severity is refused by the drawer; close it
    await act(async () => undefined);
    await o.press("workspace-section-Bedroom");
    await o.answer("bed", "pass");
    await o.press("workspace-section-Entry");
    await o.answer("door", "pass");
    await o.press("workspace-review");
    expect(o.screen.getByTestId("workspace-submit").props.accessibilityState).toMatchObject({ disabled: true });
    await o.press("workspace-submit");
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("not knowing whether it was recorded", () => {
  async function timeout(o: Opened, error: unknown = new Error("Network request failed")) {
    mockComplete.mockRejectedValueOnce(error);
    await finishAllPass(o);
    await o.press("workspace-submit");
    await settle();
  }

  it("a lost reply is 'checking', never an error and never a second submission id", async () => {
    const o = await open();
    await timeout(o);
    expect(o.text("result-title")).toBe("We're checking whether your inspection was recorded.");
    expect(o.text("result-uncertain-body")).toContain("saved on this phone");
    expect(o.screen.getByText("Please do not submit it again yet.")).toBeTruthy();
    expect(o.has("result-send-again")).toBe(false); // sending again is not offered until the server has been asked
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull(); // the draft stays
  });

  it("'Check status' reads the stored inspection back: a recorded one is shown as the result, and cleans up", async () => {
    const o = await open();
    await timeout(o);
    const id = sentBody().client_submission_id;
    mockReadBack.mockResolvedValue({
      status: "found",
      detail: { id, room_id: "room-205", room_number: "205", overall_result: "passed", completed_at: COMPLETED, correction_kind: null, reinspection_of: null, correction: null, items: [{ template_item_id: "toilet", result: "pass" }] },
    });
    await o.press("result-check");
    await settle();
    expect(mockReadBack).toHaveBeenCalledWith(id);
    expect(o.text("result-title")).toBe("Room 205 approved");
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it("if nothing was recorded it offers a safe resend of the SAME submission, and a second tap sends once", async () => {
    const o = await open();
    await timeout(o);
    mockReadBack.mockResolvedValue({ status: "not_found" });
    await o.press("result-check");
    await settle();
    expect(o.text("result-uncertain-body")).toContain("safe to send it again");
    mockComplete.mockImplementation(async (body) => recorded(body));
    await o.press("result-send-again");
    await settle();
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(sentBody(1).client_submission_id).toBe(sentBody(0).client_submission_id);
    expect(o.text("result-title")).toBe("Room 205 approved");
  });

  it("if the read-back itself fails the outcome stays explicitly unknown", async () => {
    const o = await open();
    await timeout(o);
    mockReadBack.mockRejectedValue(new Error("offline"));
    await o.press("result-check");
    await settle();
    expect(o.text("result-uncertain-body")).toContain("still can't tell");
    expect(o.has("result-send-again")).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it("a server error after a possible commit is also 'checking', not 'failed'", async () => {
    const o = await open();
    await timeout(o, Object.assign(new Error("boom"), { status: 500 }));
    expect(o.has("result-uncertain")).toBe(true);
    expect(o.screen.queryByTestId("result-problem")).toBeNull();
  });

  it("a recorded inspection that lost its answers is completed by resending the same id", async () => {
    const o = await open();
    await timeout(o, Object.assign(new Error("partial"), { status: 500, code: "inspection_incomplete" }));
    const id = sentBody().client_submission_id;
    mockReadBack.mockResolvedValue({ status: "found", detail: { id, room_id: "room-205", overall_result: "passed", items: [], correction: null } });
    await o.press("result-check");
    await settle();
    expect(o.text("result-uncertain-body")).toContain("without its answers");
    mockComplete.mockImplementation(async (body) => recorded(body, { replayed: true }));
    await o.press("result-send-again");
    await settle();
    expect(sentBody(1).client_submission_id).toBe(id);
    expect(o.text("result-title")).toBe("Room 205 approved");
  });

  it("offline, checking is disabled with the reason", async () => {
    const o = await open();
    await timeout(o);
    await act(async () => useAppStore.setState({ isOnline: false }));
    expect(o.screen.getByTestId("result-check").props.accessibilityState).toMatchObject({ disabled: true });
    expect(o.text("result-offline")).toBe("Connect to the internet to continue.");
  });

  it("an app restart before the reply: the saved draft is checked against the server first, and a landed inspection is shown, not offered as a resume", async () => {
    const template = normalizeTemplate(standardTemplate())!;
    let draft = createDraft({ hotelId: "hotel-1", userId: "sup-1", roomId: "room-205", businessDate: "2026-10-20", cleanCycleId: "cycle-1", reinspectionOf: null, template, submissionId: "sub-landed", now: Date.parse("2026-10-20T17:30:00Z") });
    const out = chooseAnswer(draft, template, "toilet", "pass", Date.parse("2026-10-20T17:30:00Z"));
    if (out.ok) draft = out.draft;
    await writeDraft(draft);
    mockReadBack.mockResolvedValue({
      status: "found",
      detail: { id: "sub-landed", room_id: "room-205", room_number: "205", overall_result: "passed", completed_at: COMPLETED, correction_kind: null, reinspection_of: null, correction: null, items: [{ template_item_id: "toilet", result: "pass" }] },
    });
    mockQueue.mockResolvedValue([]); // the room has already left the queue
    const o = await open();
    expect(mockReadBack).toHaveBeenCalledWith("sub-landed");
    expect(o.text("result-title")).toBe("Room 205 approved");
    expect(o.has("workspace-resume")).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

describe("the server refusing it", () => {
  it("a room that changed under the supervisor is refused, nothing is shown as recorded, and the queue is re-read", async () => {
    mockComplete.mockRejectedValue(Object.assign(new Error("Room must be clean"), { status: 409, code: "room_not_awaiting_inspection" }));
    const o = await open();
    await finishAllPass(o);
    const reads = mockQueue.mock.calls.length;
    await o.press("workspace-submit");
    await settle();
    expect(o.has("result-approved")).toBe(false);
    expect(mockQueue.mock.calls.length).toBeGreaterThan(reads);
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull(); // the supervisor's work is kept
  });

  it("failed photo uploads say nothing was recorded and retry the same id", async () => {
    mockComplete
      .mockRejectedValueOnce(Object.assign(new Error("Photos could not be uploaded"), { status: 502, code: "photo_upload_failed" }))
      .mockImplementation(async (body) => recorded(body, { correction: created() }));
    const o = await open();
    await finishWithIssue(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-problem-message")).toContain("photos couldn't be uploaded");
    await o.press("result-problem-retry");
    await settle();
    expect(sentBody(1).client_submission_id).toBe(sentBody(0).client_submission_id);
    expect(o.text("result-title")).toBe("Correction requested");
  });

  it("a signed-out / forbidden answer is explained and never shown as success", async () => {
    mockComplete.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const o = await open();
    await finishAllPass(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-problem-message")).toBe(en("inspect.result.problem.forbidden"));
    await o.press("result-problem-back");
    expect(o.has("workspace-review-view")).toBe(true);
  });

  it("an id the server says is already spent gets a new reference instead of being retried as-is", async () => {
    mockComplete
      .mockRejectedValueOnce(Object.assign(new Error("used"), { status: 409, code: "submission_conflict" }))
      .mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    await o.press("workspace-submit");
    await settle();
    await o.press("result-problem-back");
    await o.press("workspace-submit");
    await settle();
    expect(sentBody(1).client_submission_id).not.toBe(sentBody(0).client_submission_id);
  });

  it("offline, the send button is disabled with the reason and nothing is attempted", async () => {
    const o = await open();
    await finishAllPass(o);
    await act(async () => useAppStore.setState({ isOnline: false }));
    expect(o.screen.getByTestId("workspace-submit").props.accessibilityState).toMatchObject({ disabled: true });
    expect(o.text("workspace-footer-hint")).toBe("Connect to the internet to continue.");
    await o.press("workspace-submit");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("another account's draft can never be sent from this one", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    await act(async () => useAppStore.setState({ user: { id: "sup-2", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await settle();
    await o.press("workspace-submit").catch(() => undefined);
    for (const call of mockComplete.mock.calls) expect(call[0].expected_hotel_id).toBe("hotel-1");
  });
});

describe("a reinspection", () => {
  const failure = {
    inspection_id: "insp-1",
    inspected_at: "2026-10-20T14:00:00Z",
    overall_result: "failed",
    notes: null,
    correction_kind: "reclean" as const,
    items: [{ id: "mirror", label: "Bathroom mirrors", note: "Streaks" }],
  };

  beforeEach(() => {
    mockQueue.mockResolvedValue([room205({ previous_failure: failure })]);
    mockDetail.mockResolvedValue({
      id: "insp-1",
      room_id: "room-205",
      items: [{ template_item_id: "mirror", description: "Bathroom mirrors", result: "fail", note: "Streaks", severity: "minor", photo_url: "https://cdn.test/mirror.jpg" }],
      correction: { status: "resubmitted", resubmission: { at: "2026-10-20T17:22:00Z", housekeeper_id: "hk-1", housekeeper_name: "Carlos M." } },
    });
  });

  it("puts the earlier failures first with their notes, the original photo and what the housekeeper submitted", async () => {
    const o = await open();
    expect(o.text("reinspection-item-mirror")).toContain("Bathroom mirrors");
    expect(o.text("reinspection-item-mirror")).toContain("Streaks");
    expect(o.has("reinspection-photo-mirror")).toBe(true);
    expect(o.text("reinspection-submitted")).toBe("Corrected work submitted by Carlos M. at 12:22 PM");
    expect(o.text("reinspection-standing-mirror")).toBe("Not checked yet");
    expect(o.text("reinspection-note")).toContain("Complete the whole checklist");
  });

  it("never counts an untouched item as fixed: it is 'Fixed' only after the supervisor passes it", async () => {
    const o = await open();
    await o.answer("mirror", "pass");
    expect(o.text("reinspection-standing-mirror")).toBe("Fixed");
  });

  it("cannot be reviewed while a previously failed item is unchecked, even if the standard became optional", async () => {
    mockQueue.mockResolvedValue([room205({ previous_failure: { ...failure, items: [{ id: "lamp", label: "Lighting", note: null }] } })]);
    const o = await open();
    for (const id of ["toilet", "mirror", "towels"]) await o.answer(id, "pass");
    await o.press("workspace-section-Bedroom");
    await o.answer("bed", "pass");
    await o.press("workspace-section-Entry");
    await o.answer("door", "pass");
    await o.press("workspace-review");
    expect(o.has("workspace-review-view")).toBe(false); // "lamp" (optional) failed last time and has not been looked at
  });

  it("links the new inspection to the earlier failure and names the full checklist", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body));
    const o = await open();
    await finishAllPass(o);
    expect(o.has("workspace-review-recheck")).toBe(true);
    await o.press("workspace-submit");
    expect(sentBody().reinspection_of).toBe("insp-1");
    expect(sentBody().items.length).toBe(5); // every checklist item that was answered; none were filled in for the supervisor
    await settle();
    expect(o.text("result-title")).toBe("Room 205 approved");
    expect(o.text("result-verified")).toBe("Corrections verified");
  });

  it("a reinspection that still fails keeps the room blocked and says the correction is still required", async () => {
    mockComplete.mockImplementation(async (body) => recorded(body, { correction: created({ assigned_name: "Carlos M." }) }));
    const o = await open();
    await finishWithIssue(o);
    await o.press("workspace-submit");
    await settle();
    expect(o.text("result-blocked")).toBe("Room 205 remains blocked.");
    expect(o.screen.getByText(/still required/)).toBeTruthy();
  });
});
