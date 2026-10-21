import { act, fireEvent } from "@testing-library/react-native";
import {
  AsyncStorage,
  mockCapture,
  mockComplete,
  mockDeleteEvidence,
  mockDeleteRoomEvidence,
  mockFindMissing,
  mockPrune,
  mockState,
  mockSubmitLegacy,
  openWorkspace as open,
  resetWorld,
  useAppStore,
} from "../helpers/workspaceMocks";
import { afterAutosave, allStrings, en, es, flush, standardTemplate } from "../helpers/workspaceHarness";
import { createDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { draftKey, writeDraft } from "@/lib/inspections/draftStore";
import { normalizeTemplate } from "@/lib/inspections/templates";
import { chooseAnswer } from "@/lib/inspections/workspace";

/* ─── Reporting an issue: the drawer, its photo, the row, and the review ────
   The real screen, hook, rules and components run. Only the camera / file system (evidence module), the network, the
   router and the clock are replaced, so these prove what the supervisor can do and what is kept — NOT that a real
   camera works (that is checked by hand on a device). */

const checklist = normalizeTemplate(standardTemplate())!;
const KEY = draftKey("hotel-1", "sup-1", "room-205");
const PHOTO = (item: string, n: number) => `file:///docs/inspection-evidence/hotel-1/sup-1/room-205/${item}-t${n}.jpg`;

const storedDraft = async (): Promise<InspectionDraft> => JSON.parse((await AsyncStorage.getItem(KEY)) as string) as InspectionDraft;

function seed(answers: InspectionDraft["answers"], photos: Record<string, string> = {}): InspectionDraft {
  let draft = createDraft({
    hotelId: "hotel-1", userId: "sup-1", roomId: "room-205", businessDate: "2026-10-20", cleanCycleId: "cycle-1",
    reinspectionOf: null, template: checklist, submissionId: "sub-original", now: Date.parse("2026-10-20T17:30:00Z"),
  });
  for (const [id, answer] of Object.entries(answers)) {
    const out = chooseAnswer(draft, checklist, id, answer.result, Date.parse("2026-10-20T17:30:00Z"));
    if (out.ok) draft = out.draft;
  }
  return { ...draft, answers: { ...draft.answers, ...answers }, photos };
}

let dateNow: jest.SpyInstance;
beforeEach(async () => {
  dateNow = await resetWorld();
});
afterEach(async () => {
  await flush();
  dateNow.mockRestore();
});

type Opened = Awaited<ReturnType<typeof open>>;
const typeNote = (o: Opened, value: string) => act(async () => fireEvent.changeText(o.screen.getByTestId("workspace-issue-note"), value));

/** Open the workspace, fail an item and fill the drawer in. */
async function reportIssue(o: Opened, item: string, { note, severity }: { note?: string; severity?: "minor" | "major" } = {}) {
  await o.answer(item, "fail");
  if (note !== undefined) await typeNote(o, note);
  if (severity) await o.press(`workspace-issue-severity-${severity}`);
}

describe("the issue drawer", () => {
  it("opens by itself when an item is marked Issue, with the room, section and exact standard", async () => {
    const o = await open();
    expect(o.has("workspace-issue-sheet")).toBe(false);
    await o.answer("towels", "fail");
    expect(o.has("workspace-issue-sheet")).toBe(true);
    expect(o.text("workspace-issue-sheet-title")).toBe("Report issue");
    expect(o.text("workspace-issue-context")).toBe("Room 205 · Bathroom");
    expect(o.text("workspace-issue-item")).toBe("Towels and amenities");
    expect(o.text("workspace-issue-correction")).toContain("Housekeeping correction");
  });

  it("never opens for Pass or N/A: the routine path stays one tap with no questions", async () => {
    const o = await open();
    await o.answer("toilet", "pass");
    await o.answer("mirror", "na");
    expect(o.has("workspace-issue-sheet")).toBe(false);
    expect(o.has("workspace-change-answer")).toBe(false);
    expect(o.text("workspace-progress-fraction")).toBe("2 of 6");
  });

  it("shows only supported correction: housekeeping, with no engineering option", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    expect(o.text("workspace-issue-correction")).toContain("Engineering problems aren't routed from an inspection");
    expect(o.screen.queryByText(/^Engineering$/)).toBeNull();
    expect(o.screen.queryByRole("radio", { name: /engineering/i })).toBeNull();
  });

  it("severity has no default: saving without choosing says so and stores nothing", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { note: "Streaks" });
    await o.press("workspace-issue-save");
    expect(o.text("workspace-issue-severity-error")).toBe("Choose Minor or Major.");
    expect(o.has("workspace-issue-sheet")).toBe(true);
    expect(o.screen.getByTestId("workspace-issue-severity-minor").props.accessibilityState.checked).toBe(false);
    expect(o.screen.getByTestId("workspace-issue-severity-major").props.accessibilityState.checked).toBe(false);
    expect((await storedDraft()).answers.mirror?.severity).toBeUndefined();
  });

  it("severity is a text label as well as a colour, and the choice is announced", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-severity-major");
    expect(o.text("workspace-issue-severity-major")).toContain("Major");
    expect(o.screen.getByTestId("workspace-issue-severity-major").props.accessibilityState).toMatchObject({ checked: true, selected: true });
    expect(o.screen.getByTestId("workspace-issue-severity-minor").props.accessibilityState).toMatchObject({ checked: false });
  });

  it("saves the description and severity against that item, and the row summarises them", async () => {
    const o = await open();
    await reportIssue(o, "towels", { note: "  Two bath towels missing.  ", severity: "minor" });
    await o.press("workspace-issue-save");
    expect(o.has("workspace-issue-sheet")).toBe(false);
    expect(o.text("workspace-issue-towels")).toBe("Issue recorded");
    expect(o.text("workspace-issue-severity-text-towels")).toBe("Minor");
    expect(o.text("workspace-has-note-towels")).toBe("Two bath towels missing.");
    await afterAutosave();
    const draft = await storedDraft();
    expect(draft.answers.towels).toEqual({ result: "fail", severity: "minor", note: "Two bath towels missing." });
    expect(draft.answers.mirror).toBeUndefined();
  });

  it("notes stay with their own item", async () => {
    const o = await open();
    await reportIssue(o, "towels", { note: "Towels gone", severity: "minor" });
    await o.press("workspace-issue-save");
    await reportIssue(o, "mirror", { note: "Streaks", severity: "major" });
    await o.press("workspace-issue-save");
    expect(o.text("workspace-has-note-towels")).toBe("Towels gone");
    expect(o.text("workspace-has-note-mirror")).toBe("Streaks");
  });

  it("reopening an issue shows what was saved, and an edit replaces it", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { note: "Streaks", severity: "minor" });
    await o.press("workspace-issue-save");
    await o.press("workspace-issue-edit-mirror");
    expect(o.text("workspace-issue-sheet-title")).toBe("Edit issue");
    expect(o.screen.getByTestId("workspace-issue-note").props.value).toBe("Streaks");
    expect(o.screen.getByTestId("workspace-issue-severity-minor").props.accessibilityState.checked).toBe(true);
    await typeNote(o, "Streaks and spots");
    await o.press("workspace-issue-severity-major");
    await o.press("workspace-issue-save");
    expect(o.text("workspace-issue-severity-text-mirror")).toBe("Major");
    expect(o.text("workspace-has-note-mirror")).toBe("Streaks and spots");
  });

  it("refuses to pass the length limit instead of quietly cutting the text", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { severity: "minor" });
    await typeNote(o, "x".repeat(600));
    expect(o.screen.getByTestId("workspace-issue-note").props.value).toHaveLength(500);
    expect(o.text("workspace-issue-note-count")).toBe("500 of 500");
  });
});

describe("closing the drawer", () => {
  it("closes silently when nothing changed", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-sheet-close");
    expect(o.has("workspace-issue-sheet")).toBe(false);
    expect(o.has("workspace-issue-unsaved")).toBe(false);
    // the item stays an issue; nothing is quietly turned into a pass
    expect(o.screen.getByTestId("workspace-answer-mirror-fail").props.accessibilityState.checked).toBe(true);
    expect(o.text("workspace-issue-mirror")).toBe("Issue details still needed before approval");
  });

  it("never discards an unsaved edit without asking; Keep editing returns to it intact", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { note: "Streaks", severity: "minor" });
    await o.press("workspace-issue-sheet-close");
    expect(o.has("workspace-issue-unsaved")).toBe(true);
    expect(o.text("workspace-issue-unsaved")).toContain("Discard your changes?");
    await o.press("workspace-issue-keep-editing");
    expect(o.has("workspace-issue-unsaved")).toBe(false);
    expect(o.screen.getByTestId("workspace-issue-note").props.value).toBe("Streaks");
    expect(o.screen.getByTestId("workspace-issue-severity-minor").props.accessibilityState.checked).toBe(true);
  });

  it("Discard changes leaves the saved issue exactly as it was", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { note: "Streaks", severity: "minor" });
    await o.press("workspace-issue-save");
    await o.press("workspace-issue-edit-mirror");
    await typeNote(o, "Something else entirely");
    await o.press("workspace-issue-sheet-close");
    await o.press("workspace-issue-discard-changes");
    expect(o.has("workspace-issue-sheet")).toBe(false);
    expect(o.text("workspace-has-note-mirror")).toBe("Streaks");
  });

  it("a backdrop tap does not dismiss the drawer", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    expect(o.screen.getByTestId("workspace-issue-sheet-backdrop", { includeHiddenElements: true }).props.accessible).toBe(false);
  });
});

describe("photos", () => {
  it("says a photo is required for a standard that requires one, and optional otherwise, and still lets the issue be saved", async () => {
    const o = await open();
    await o.press("workspace-section-Bathroom");
    await o.press("workspace-section-Entry");
    await o.answer("door", "fail");
    expect(o.text("workspace-issue-photo-status")).toBe("Photo required for this standard");
    expect(o.has("workspace-issue-photo-add")).toBe(true);
    await o.press("workspace-issue-severity-major");
    await o.press("workspace-issue-save");
    expect(o.has("workspace-issue-sheet")).toBe(false); // saving a draft is allowed
    expect(o.text("workspace-issue-photo-state-door")).toBe("Photo required");
    await o.press("workspace-issue-edit-door");
    await o.press("workspace-issue-sheet-close");
    expect(o.has("workspace-issue-sheet")).toBe(false);
  });

  it("an optional photo is labelled optional and is never forced", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    expect(o.text("workspace-issue-photo-status")).toBe("A photo is optional for this standard");
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("Add photo offers the camera, the library and cancel; nothing is captured until one is chosen", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    expect(o.has("workspace-issue-photo-menu")).toBe(true);
    expect(o.has("workspace-issue-photo-camera")).toBe(true);
    expect(o.has("workspace-issue-photo-library")).toBe(true);
    await o.press("workspace-issue-photo-menu-cancel");
    expect(o.has("workspace-issue-photo-menu")).toBe(false);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("a photo is captured for the right item in this hotel/person/room's scope, shown as a thumbnail, and saved with the issue", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    expect(mockCapture).toHaveBeenCalledWith("camera", { hotelId: "hotel-1", userId: "sup-1", roomId: "room-205" }, "mirror");
    expect(o.has("workspace-issue-photo")).toBe(true);
    await o.press("workspace-issue-severity-minor");
    await o.press("workspace-issue-save");
    expect(o.has("workspace-issue-thumb-mirror")).toBe(true);
    await afterAutosave();
    expect((await storedDraft()).photos.mirror).toMatch(/inspection-evidence\/hotel-1\/sup-1\/room-205\/mirror-/);
  });

  it("choosing from the library goes through the same path", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-library");
    expect(mockCapture).toHaveBeenCalledWith("library", expect.anything(), "mirror");
    expect(o.has("workspace-issue-photo")).toBe(true);
  });

  it("backing out of the camera is not an error", async () => {
    mockCapture.mockResolvedValueOnce({ ok: false, reason: "cancelled" });
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    expect(o.has("workspace-issue-photo-error")).toBe(false);
    expect(o.has("workspace-issue-photo")).toBe(false);
  });

  it.each([
    ["permission_denied", true],
    ["permission_blocked", true],
    ["camera_unavailable", true],
    ["unsupported", false],
    ["too_large", false],
    ["convert_failed", true],
    ["save_failed", true],
  ] as const)("a %s failure is explained in plain words, with a way forward when there is one", async (reason, canRetry) => {
    mockCapture.mockResolvedValueOnce({ ok: false, reason });
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    expect(o.text("workspace-issue-photo-error")).toContain(en(`inspect.workspace.photo.error.${reason}`));
    expect(o.has("workspace-issue-photo-retry")).toBe(canRetry);
    expect(o.has("workspace-issue-photo-settings")).toBe(reason === "permission_blocked");
    expect(o.has("workspace-issue-photo")).toBe(false);
  });

  it("Try again reopens the choices", async () => {
    mockCapture.mockResolvedValueOnce({ ok: false, reason: "convert_failed" });
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    await o.press("workspace-issue-photo-retry");
    expect(o.has("workspace-issue-photo-menu")).toBe(true);
    expect(o.has("workspace-issue-photo-error")).toBe(false);
  });

  it("two quick taps open the camera once", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockCapture.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    const camera = o.screen.getByTestId("workspace-issue-photo-camera");
    await act(async () => {
      fireEvent.press(camera);
      fireEvent.press(camera);
    });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(o.has("workspace-issue-photo-working")).toBe(true);
    await act(async () => finish({ ok: true, photo: { uri: PHOTO("mirror", 9), bytes: 1, width: 1, height: 1 } }));
    expect(o.has("workspace-issue-photo")).toBe(true);
  });

  it("replacing a photo taken in the same drawer deletes the first, and only the final one is kept", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    const first = (await mockCapture.mock.results[0].value).photo.uri as string;
    await o.press("workspace-issue-photo-replace");
    await o.press("workspace-issue-photo-library");
    const second = (await mockCapture.mock.results[1].value).photo.uri as string;
    expect(mockDeleteEvidence).toHaveBeenCalledWith(first, expect.objectContaining({ roomId: "room-205" }));
    expect(mockDeleteEvidence).not.toHaveBeenCalledWith(second, expect.anything());
    await o.press("workspace-issue-severity-minor");
    await o.press("workspace-issue-save");
    await afterAutosave();
    expect((await storedDraft()).photos.mirror).toBe(second);
  });

  it("replacing a saved photo deletes the old file only after the new draft is stored", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    const old = (await mockCapture.mock.results[0].value).photo.uri as string;
    await o.press("workspace-issue-severity-minor");
    await o.press("workspace-issue-save");
    await afterAutosave();
    mockDeleteEvidence.mockClear();
    await o.press("workspace-issue-edit-mirror");
    await o.press("workspace-issue-photo-replace");
    await o.press("workspace-issue-photo-camera");
    const next = (await mockCapture.mock.results[1].value).photo.uri as string;
    expect(mockDeleteEvidence).not.toHaveBeenCalled(); // not before Save
    await o.press("workspace-issue-save");
    await afterAutosave();
    expect(mockDeleteEvidence).toHaveBeenCalledWith(old, expect.anything());
    expect((await storedDraft()).photos.mirror).toBe(next);
  });

  it("removing the photo and saving drops the reference and the file", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    const uri = (await mockCapture.mock.results[0].value).photo.uri as string;
    await o.press("workspace-issue-severity-minor");
    await o.press("workspace-issue-save");
    await afterAutosave();
    await o.press("workspace-issue-edit-mirror");
    await o.press("workspace-issue-photo-remove");
    expect(o.has("workspace-issue-photo")).toBe(false);
    await o.press("workspace-issue-save");
    await afterAutosave();
    expect((await storedDraft()).photos).toEqual({});
    expect(mockDeleteEvidence).toHaveBeenCalledWith(uri, expect.anything());
  });

  it("discarding the drawer deletes a photo it took but never adopted, and keeps the saved one", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    const uri = (await mockCapture.mock.results[0].value).photo.uri as string;
    await o.press("workspace-issue-sheet-close");
    await o.press("workspace-issue-discard-changes");
    expect(mockDeleteEvidence).toHaveBeenCalledWith(uri, expect.anything());
  });

  it("independent failed items keep independent photos", async () => {
    const o = await open();
    for (const item of ["mirror", "towels"]) {
      await o.answer(item, "fail");
      await o.press("workspace-issue-photo-add");
      await o.press("workspace-issue-photo-camera");
      await o.press("workspace-issue-severity-minor");
      await o.press("workspace-issue-save");
    }
    await afterAutosave();
    const draft = await storedDraft();
    expect(Object.keys(draft.photos).sort()).toEqual(["mirror", "towels"]);
    expect(draft.photos.mirror).toContain("/mirror-");
    expect(draft.photos.towels).toContain("/towels-");
    expect(draft.photos.mirror).not.toBe(draft.photos.towels);
  });

  it("opens the photo at full size without losing the description, then returns to the drawer", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { note: "Streaks on glass", severity: "minor" });
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    await o.press("workspace-issue-photo");
    expect(o.has("workspace-photo-viewer-image")).toBe(true);
    expect(o.has("workspace-issue-sheet")).toBe(false); // stepped aside
    await o.press("workspace-photo-viewer-close");
    expect(o.has("workspace-photo-viewer-image")).toBe(false);
    expect(o.has("workspace-issue-sheet")).toBe(true);
    expect(o.screen.getByTestId("workspace-issue-note").props.value).toBe("Streaks on glass");
    expect(o.screen.getByTestId("workspace-issue-severity-minor").props.accessibilityState.checked).toBe(true);
  });

  it("every photo control has an accessible name that says which item it is for", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    expect(o.screen.getByTestId("workspace-issue-photo-add").props.accessibilityLabel).toBe("Add a photo for Bathroom mirrors");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    expect(o.screen.getByTestId("workspace-issue-photo").props.accessibilityLabel).toBe("Photo for Bathroom mirrors. Double tap to view it larger.");
    expect(o.screen.getByTestId("workspace-issue-photo-remove").props.accessibilityLabel).toBe("Remove the photo for Bathroom mirrors");
    expect(o.screen.getByTestId("workspace-issue-photo-replace").props.accessibilityLabel).toBe("Replace the photo for Bathroom mirrors");
  });
});

describe("photos that survived (or did not) a restart", () => {
  it("a saved photo is still attached after the app is reopened", async () => {
    await writeDraft(seed({ mirror: { result: "fail", severity: "minor", note: "Streaks" } }, { mirror: PHOTO("mirror", 1) }));
    const o = await open();
    await o.press("workspace-resume-resume");
    expect(o.has("workspace-issue-thumb-mirror")).toBe(true);
    expect(o.text("workspace-has-note-mirror")).toBe("Streaks");
    expect(mockFindMissing).toHaveBeenCalledWith({ mirror: PHOTO("mirror", 1) }, { hotelId: "hotel-1", userId: "sup-1", roomId: "room-205" });
    expect(mockPrune).toHaveBeenCalledWith({ hotelId: "hotel-1", userId: "sup-1", roomId: "room-205" }, [PHOTO("mirror", 1)]);
  });

  it("a photo whose file has disappeared is not evidence: the row, the drawer and the review all say so", async () => {
    await writeDraft(seed({ door: { result: "fail", severity: "major" }, toilet: { result: "pass" }, mirror: { result: "pass" }, towels: { result: "pass" }, bed: { result: "pass" } }, { door: PHOTO("door", 1) }));
    mockFindMissing.mockResolvedValue(["door"]);
    const o = await open();
    await o.press("workspace-resume-resume");
    await o.press("workspace-section-Bathroom");
    await o.press("workspace-section-Entry");
    expect(o.text("workspace-issue-photo-state-door")).toBe("Photo file missing");
    expect(o.has("workspace-issue-thumb-door")).toBe(false);
    await o.press("workspace-review");
    expect(o.text("workspace-review-needs-door")).toBe("The photo file is missing. Take it again.");
    expect(o.has("workspace-review-photo-door")).toBe(false);
    expect(o.text("workspace-review-outstanding")).toContain("1 issue still needs details");
  });

  it("replacing a lost photo clears the problem", async () => {
    await writeDraft(seed({ door: { result: "fail", severity: "major" } }, { door: PHOTO("door", 1) }));
    mockFindMissing.mockResolvedValue(["door"]);
    const o = await open();
    await o.press("workspace-resume-resume");
    await o.press("workspace-section-Bathroom");
    await o.press("workspace-section-Entry");
    await o.press("workspace-issue-edit-door");
    expect(o.text("workspace-issue-photo-lost")).toBe("This photo is no longer on the phone. Replace it or remove it.");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    await o.press("workspace-issue-save");
    expect(o.has("workspace-issue-thumb-door")).toBe(true);
    expect(o.has("workspace-issue-photo-state-door")).toBe(false);
  });
});

describe("changing an answer after reporting an issue", () => {
  async function savedIssue() {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    const uri = (await mockCapture.mock.results[0].value).photo.uri as string;
    await typeNote(o, "Streaks");
    await o.press("workspace-issue-severity-major");
    await o.press("workspace-issue-save");
    await afterAutosave();
    mockDeleteEvidence.mockClear();
    return { o, uri };
  }

  it("Issue → Pass asks first, because a description, severity and photo would be lost", async () => {
    const { o } = await savedIssue();
    await o.answer("mirror", "pass");
    expect(o.has("workspace-change-answer")).toBe(true);
    expect(o.text("workspace-change-answer")).toContain("removes the issue's description, severity and photo");
    expect(o.screen.getByTestId("workspace-answer-mirror-fail").props.accessibilityState.checked).toBe(true);
  });

  it("Keep issue leaves everything as it was", async () => {
    const { o } = await savedIssue();
    await o.answer("mirror", "na");
    await o.press("workspace-change-answer-keep");
    expect(o.has("workspace-change-answer")).toBe(false);
    expect(o.text("workspace-has-note-mirror")).toBe("Streaks");
    expect(mockDeleteEvidence).not.toHaveBeenCalled();
  });

  it("confirming changes only that item, clears the stale issue data, deletes the file, and recounts", async () => {
    const { o, uri } = await savedIssue();
    await o.answer("toilet", "fail");
    await o.press("workspace-issue-sheet-close");
    expect(o.text("workspace-progress-line")).toContain("2 issues found");
    await o.answer("mirror", "pass");
    await o.press("workspace-change-answer-confirm");
    await afterAutosave();
    expect(o.screen.getByTestId("workspace-answer-mirror-pass").props.accessibilityState.checked).toBe(true);
    expect(o.screen.getByTestId("workspace-answer-toilet-fail").props.accessibilityState.checked).toBe(true);
    expect(o.text("workspace-progress-line")).toContain("1 issue found");
    const draft = await storedDraft();
    expect(draft.answers.mirror).toEqual({ result: "pass" });
    expect(draft.photos).toEqual({});
    expect(mockDeleteEvidence).toHaveBeenCalledWith(uri, expect.anything());
  });

  it("tapping the selected Issue again also asks before clearing an issue that has details", async () => {
    const { o } = await savedIssue();
    await o.answer("mirror", "fail");
    expect(o.has("workspace-change-answer")).toBe(true);
    await o.press("workspace-change-answer-confirm");
    expect(o.screen.getByTestId("workspace-answer-mirror-fail").props.accessibilityState.checked).toBe(false);
  });

  it("an accidental Issue with nothing written changes straight back without a prompt", async () => {
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-sheet-close");
    await o.answer("mirror", "pass");
    expect(o.has("workspace-change-answer")).toBe(false);
    expect(o.screen.getByTestId("workspace-answer-mirror-pass").props.accessibilityState.checked).toBe(true);
  });

  it("Pass → Issue opens the drawer; N/A → Issue too", async () => {
    const o = await open();
    await o.answer("toilet", "pass");
    await o.answer("toilet", "fail");
    expect(o.has("workspace-issue-sheet")).toBe(true);
    await o.press("workspace-issue-sheet-close");
    await o.answer("toilet", "na");
    await o.answer("toilet", "fail");
    expect(o.has("workspace-issue-sheet")).toBe(true);
  });

  it("one corrected issue never marks the rest of the checklist as passed", async () => {
    const { o } = await savedIssue();
    await o.answer("mirror", "pass");
    await o.press("workspace-change-answer-confirm");
    expect(o.text("workspace-progress-fraction")).toBe("1 of 6");
  });
});

describe("the review of a failed inspection", () => {
  async function failedInspection() {
    const o = await open();
    for (const item of ["toilet", "towels"]) await o.answer(item, "pass");
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
    return o;
  }

  it("shows the actual counts, each failed standard with its words, severity and photo, and why the room cannot be released", async () => {
    const o = await failedInspection();
    expect(o.text("workspace-review-reviewed")).toBe("Reviewed: 5 of 6");
    expect(o.text("workspace-review-count-pass")).toContain("4");
    expect(o.text("workspace-review-count-fail")).toContain("1");
    expect(o.text("workspace-review-blocked")).toContain("Correction required");
    expect(o.text("workspace-review-blocked")).toContain("The room can't be released while an issue is unresolved.");
    expect(o.text("workspace-review-severity-mirror")).toBe("Minor");
    expect(o.text("workspace-review-note-mirror")).toBe("Streaks on glass");
    expect(o.text("workspace-review-photo-mirror")).toBe("1 photo attached");
    expect(o.has("workspace-review-needs-mirror")).toBe(false);
    expect(o.has("workspace-review-outstanding")).toBe(false);
  });

  it("shows the draft correction as pending, owned by the housekeeper who cleaned the room, and nothing as created", async () => {
    const o = await failedInspection();
    expect(o.text("workspace-review-correction-owner")).toBe("Housekeeping · Maria S.");
    expect(o.text("workspace-review-correction-status")).toBe("Pending final submission");
    await o.press("workspace-review-correction-details");
    expect(o.text("workspace-correction-status")).toContain("Pending final submission");
    expect(o.text("workspace-correction-owner")).toContain("Maria S., who cleaned this room");
    expect(o.text("workspace-correction-owner")).toContain("Being assigned doesn't mean they have seen it.");
    expect(o.text("workspace-correction-kind")).toContain("Touch-up");
    expect(o.text("workspace-correction-priority")).toContain("Urgent, set automatically");
    expect(o.text("workspace-correction-step-mirror")).toContain("Streaks on glass");
    expect(o.text("workspace-correction-limits")).toContain("can't be changed from here");
    // it is a preview: no inputs, no save, no send
    expect(o.screen.UNSAFE_queryAllByType(require("react-native").TextInput)).toHaveLength(0);
    expect(o.screen.queryAllByRole("button", { name: /save|send|assign|submit|create/i })).toEqual([]);
    await o.press("workspace-correction-done");
    expect(o.has("workspace-correction")).toBe(false);
  });

  it("a missing required photo and a missing severity are listed as actionable blockers", async () => {
    const o = await open();
    for (const item of ["toilet", "towels"]) await o.answer(item, "pass");
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-sheet-close");
    await o.press("workspace-section-Bedroom");
    await o.answer("bed", "pass");
    await o.press("workspace-section-Entry");
    await o.answer("door", "fail");
    await o.press("workspace-issue-severity-major");
    await o.press("workspace-issue-save");
    await o.press("workspace-review");
    expect(o.text("workspace-review-needs-mirror")).toBe("Severity still needed.");
    expect(o.text("workspace-review-needs-door")).toBe("A photo is still needed.");
    expect(o.text("workspace-review-outstanding")).toBe("2 issues still need details before this inspection can be approved.");
  });

  it("Go to item returns to the checklist at that issue", async () => {
    const o = await failedInspection();
    await o.press("workspace-review-goto-mirror");
    expect(o.has("workspace-review-view")).toBe(false);
    expect(o.has("workspace-item-mirror")).toBe(true);
  });

  it("a checklist with no issues shows no correction and no blocked notice", async () => {
    const o = await open();
    for (const item of ["toilet", "mirror", "towels"]) await o.answer(item, "pass");
    await o.press("workspace-section-Bedroom");
    await o.answer("bed", "pass");
    await o.press("workspace-section-Entry");
    await o.answer("door", "pass");
    await o.press("workspace-review");
    expect(o.has("workspace-review-blocked")).toBe(false);
    expect(o.has("workspace-review-correction")).toBe(false);
  });

  it("never approves, submits or contacts the server", async () => {
    const o = await failedInspection();
    expect(o.screen.queryAllByRole("button", { name: /submit|approve|finish|complete|release/i })).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockSubmitLegacy).not.toHaveBeenCalled();
  });
});

describe("safety, scope and offline", () => {
  it("works with no connection once the inspection is open, and sends nothing", async () => {
    const o = await open();
    await act(async () => useAppStore.setState({ isOnline: false }));
    await reportIssue(o, "mirror", { note: "Streaks", severity: "minor" });
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-camera");
    await o.press("workspace-issue-save");
    await afterAutosave();
    expect((await storedDraft()).answers.mirror).toMatchObject({ severity: "minor", note: "Streaks" });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("discarding the inspection removes its photos too", async () => {
    const o = await open();
    await reportIssue(o, "mirror", { severity: "minor" });
    await o.press("workspace-issue-save");
    await afterAutosave();
    await o.press("workspace-more");
    await o.press("workspace-more-saveexit");
    await o.press("workspace-saveexit-discard");
    await o.press("workspace-discard-confirm");
    expect(mockDeleteRoomEvidence).toHaveBeenCalledWith({ hotelId: "hotel-1", userId: "sup-1", roomId: "room-205" });
  });

  it("another account's draft photos are never looked up for this account", async () => {
    await AsyncStorage.setItem(draftKey("hotel-1", "sup-2", "room-205"), JSON.stringify(seed({ mirror: { result: "fail", severity: "minor" } }, { mirror: PHOTO("mirror", 1) })));
    const o = await open();
    expect(o.has("workspace-resume")).toBe(false);
    expect(mockFindMissing).not.toHaveBeenCalledWith(expect.objectContaining({ mirror: expect.anything() }), expect.anything());
  });

  it("photos are only offered on failed items: a Pass row has no photo or issue controls", async () => {
    const o = await open();
    await o.answer("toilet", "pass");
    expect(o.has("workspace-issue-edit-toilet")).toBe(false);
    expect(o.has("workspace-issue-thumb-toilet")).toBe(false);
  });
});

describe("language and appearance", () => {
  it("the whole issue flow speaks Spanish, with no raw keys", async () => {
    mockState.language = "es";
    const o = await open();
    await o.answer("mirror", "fail");
    expect(o.text("workspace-issue-sheet-title")).toBe(es("inspect.workspace.issue.title"));
    await o.press("workspace-issue-photo-add");
    await o.press("workspace-issue-photo-menu-cancel");
    await o.press("workspace-issue-severity-major");
    expect(o.text("workspace-issue-severity-major")).toContain("Grave");
    await typeNote(o, "Rayas");
    await o.press("workspace-issue-sheet-close");
    expect(o.text("workspace-issue-unsaved")).toContain(es("inspect.workspace.issue.unsavedTitle"));
    expect(allStrings(o.screen).filter((text) => /^inspect\./.test(text))).toEqual([]);
  });

  it("renders in dark mode", async () => {
    mockState.scheme = "dark";
    const o = await open();
    await o.answer("mirror", "fail");
    await o.press("workspace-issue-severity-minor");
    expect(o.has("workspace-issue-sheet")).toBe(true);
    expect(allStrings(o.screen).filter((text) => /^inspect\./.test(text))).toEqual([]);
  });
});
