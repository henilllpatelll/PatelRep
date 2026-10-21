import { BackHandler } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";
import {
  AsyncStorage,
  failStorage,
  watchStorage,
  mockComplete,
  mockQueue,
  mockSubmitLegacy,
  mockTemplates,
  navigate,
  openWorkspace as open,
  renderWorkspace,
  mockState,
  resetWorld,
  room205,
  useAppStore,
} from "../helpers/workspaceMocks";
import { afterAutosave, en, flush, flatText, settle, standardTemplate } from "../helpers/workspaceHarness";
import { chooseAnswer } from "@/lib/inspections/workspace";
import { createDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { draftKey, writeDraft } from "@/lib/inspections/draftStore";
import { normalizeTemplate } from "@/lib/inspections/templates";
import { rawItem } from "../helpers/inspectionFixtures";

/* ─── Drafts: durable, scoped, resumable, and never applied to the wrong thing ─── */

const checklist = normalizeTemplate(standardTemplate())!;
const KEY = draftKey("hotel-1", "sup-1", "room-205");
const stored = async (key = KEY): Promise<InspectionDraft | null> => {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as InspectionDraft) : null;
};

/** A draft as an earlier session left it on the phone. */
function seed(answers: Record<string, "pass" | "fail" | "na">, over: Partial<InspectionDraft> = {}, template = checklist): InspectionDraft {
  let draft = createDraft({
    hotelId: "hotel-1", userId: "sup-1", roomId: "room-205", businessDate: "2026-10-20", cleanCycleId: "cycle-1",
    reinspectionOf: null, template, submissionId: "sub-original", now: Date.parse("2026-10-20T17:30:00Z"),
  });
  for (const [id, result] of Object.entries(answers)) {
    const out = chooseAnswer(draft, template, id, result, Date.parse("2026-10-20T17:30:00Z"));
    if (out.ok) draft = out.draft;
  }
  return { ...draft, ...over };
}
const keep = async (draft: InspectionDraft) => {
  expect(await writeDraft(draft)).toBe(true);
};

const restores: (() => void)[] = [];
const breakStorage = (method: "setItem" | "getItem" | "removeItem") => {
  const restore = failStorage(method);
  restores.push(restore);
  return restore;
};

let dateNow: jest.SpyInstance;
beforeEach(async () => {
  dateNow = await resetWorld();
});
afterEach(async () => {
  restores.splice(0).forEach((restore) => restore());
  await flush();
  dateNow.mockRestore();
});

describe("saving as the supervisor goes", () => {
  it("the first answer creates the draft; it is stored with its identity, answers and submission id, and only then does it say saved", async () => {
    const { screen, answer, text } = await open();
    expect(await stored()).toBeNull();
    await answer("toilet", "pass");
    await afterAutosave();
    const draft = await stored();
    expect(draft).toMatchObject({
      hotelId: "hotel-1", userId: "sup-1", roomId: "room-205", businessDate: "2026-10-20", cleanCycleId: "cycle-1",
      templateId: "t1", templateFingerprint: "fp-1", answers: { toilet: { result: "pass" } },
    });
    expect(draft?.submissionId).toMatch(/[0-9a-f-]{36}/);
    expect(text("workspace-save")).toBe("Draft saved · 1:00 PM");
    expect(screen.queryByTestId("workspace-save-retry")).toBeNull();
  });

  it("a burst of taps ends with every answer on the phone", async () => {
    const { answer } = await open();
    for (const [id, choice] of [["toilet", "pass"], ["mirror", "fail"], ["towels", "pass"]] as const) await answer(id, choice);
    await afterAutosave();
    expect((await stored())?.answers).toEqual({ toilet: { result: "pass" }, mirror: { result: "fail" }, towels: { result: "pass" } });
  });

  it("an undone answer leaves the draft too", async () => {
    const { answer } = await open();
    await answer("toilet", "pass");
    await answer("toilet", "pass");
    await afterAutosave();
    expect((await stored())?.answers).toEqual({});
  });

  it("a failed write is shown as a failure with a retry - it never says saved - and the retry recovers", async () => {
    const restoreStorage = breakStorage("setItem");
    const { screen, answer, text, press } = await open();
    await answer("toilet", "pass");
    await afterAutosave();
    expect(text("workspace-save")).toBe("Couldn't save the draft");
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    restoreStorage();
    await press("workspace-save-retry");
    await afterAutosave();
    expect(text("workspace-save")).toBe("Draft saved · 1:00 PM");
    expect((await stored())?.answers).toEqual({ toilet: { result: "pass" } });
  });

  it("keeps working and saving while the connection drops mid-inspection", async () => {
    const { answer, text } = await open();
    await answer("toilet", "pass");
    await act(async () => useAppStore.setState({ isOnline: false }));
    await settle();
    await answer("mirror", "pass");
    await afterAutosave();
    expect(text("workspace-offline")).toBe("Offline: saving on this phone");
    expect((await stored())?.answers).toMatchObject({ toilet: { result: "pass" }, mirror: { result: "pass" } });
  });

  it("notes are part of the draft", async () => {
    const { screen, answer, press } = await open();
    await answer("toilet", "pass");
    await press("workspace-add-note-toilet");
    await act(async () => fireEvent.changeText(screen.getByTestId("workspace-note-toilet"), "Seat loose"));
    await afterAutosave();
    expect((await stored())?.answers.toilet).toEqual({ result: "pass", note: "Seat loose" });
  });

  it("nothing is sent to the server while drafting", async () => {
    const { answer } = await open();
    await answer("toilet", "pass");
    await afterAutosave();
    expect(mockSubmitLegacy).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("resuming after the app was closed", () => {
  it("offers the saved work with the room, how much is reviewed and when it was saved", async () => {
    await keep(seed({ toilet: "pass", mirror: "fail", towels: "pass" }));
    const { text } = await open();
    expect(text("workspace-resume-title")).toBe("Resume inspection?");
    expect(text("workspace-resume")).toContain("Room 205");
    expect(text("workspace-resume")).toContain("3 of 6 items reviewed");
    expect(text("workspace-resume")).toContain("Last saved 12:30 PM");
  });

  it("resuming restores every answer and keeps the SAME submission id, so finishing later cannot record it twice", async () => {
    await keep(seed({ toilet: "pass", mirror: "fail" }));
    const { screen, press, text } = await open();
    await press("workspace-resume-resume");
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("workspace-answer-mirror-fail").props.accessibilityState).toMatchObject({ checked: true });
    expect(text("workspace-progress-fraction")).toBe("2 of 6");
    expect(text("workspace-save")).toBe("Draft saved · 12:30 PM"); // it is on the phone, from earlier
    // a further answer rewrites the same draft, same submission id
    await press("workspace-answer-towels-pass");
    await afterAutosave();
    expect((await stored())?.submissionId).toBe("sub-original");
    expect(Object.keys((await stored())!.answers).sort()).toEqual(["mirror", "toilet", "towels"]);
  });

  it("survives a real restart: autosave, close the app, open again", async () => {
    const first = await open();
    await first.answer("toilet", "pass");
    await first.answer("mirror", "fail");
    await afterAutosave();
    const submissionId = (await stored())!.submissionId;
    first.screen.unmount();
    const second = await open();
    expect(second.text("workspace-resume")).toContain("2 of 6 items reviewed");
    await second.press("workspace-resume-resume");
    expect(second.text("workspace-progress-fraction")).toBe("2 of 6");
    await second.answer("towels", "pass");
    await afterAutosave();
    expect((await stored())!.submissionId).toBe(submissionId);
  });

  it("the resume prompt cannot be dismissed by accident: only Resume, Start over or leaving act on it", async () => {
    await keep(seed({ toilet: "pass" }));
    const { screen } = await open();
    await act(async () => fireEvent.press(screen.getByTestId("workspace-resume-backdrop", { includeHiddenElements: true })));
    expect(screen.getByTestId("workspace-resume")).toBeTruthy();
    expect(screen.queryByTestId("workspace-list")).toBeNull(); // nothing is applied or editable until the supervisor chooses
  });

  it("Start over asks first, says how many answers go, and only then deletes the draft", async () => {
    await keep(seed({ toilet: "pass", mirror: "pass" }));
    const { screen, press, text } = await open();
    await press("workspace-resume-startover");
    expect(text("workspace-startover-title")).toBe("Start over?");
    expect(text("workspace-startover")).toContain("2 answers saved for Room 205");
    expect(await stored()).not.toBeNull(); // asking changed nothing
    await press("workspace-startover-keep");
    expect(await stored()).not.toBeNull();
    expect(screen.getByTestId("workspace-resume")).toBeTruthy();
    await press("workspace-resume-startover");
    await press("workspace-startover-confirm");
    await settle();
    expect(await stored()).toBeNull();
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
    await press("workspace-answer-toilet-pass");
    await afterAutosave();
    expect((await stored())!.submissionId).not.toBe("sub-original"); // a fresh inspection, a fresh id
  });

  it("a saved draft with nothing in it is quietly reused: no prompt, same submission id", async () => {
    await keep(seed({}));
    const { screen, answer } = await open();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    await answer("toilet", "pass");
    await afterAutosave();
    expect((await stored())!.submissionId).toBe("sub-original");
  });

  it("re-reads the room before resuming: if it was inspected meanwhile, nothing is resumed and the draft is kept", async () => {
    await keep(seed({ toilet: "pass" }));
    const { screen, press } = await open();
    mockQueue.mockResolvedValue([]); // another supervisor approved it while the prompt was open
    await press("workspace-resume-resume");
    await settle();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(flatText(screen.getByTestId("workspace-unavailable-title"))).toBe("Not waiting for inspection");
    expect(await stored()).not.toBeNull();
  });

  it("if the re-read cannot run, it says so and offers to try again; nothing is applied", async () => {
    await keep(seed({ toilet: "pass" }));
    const { screen, press, text } = await open();
    mockQueue.mockRejectedValue(new Error("offline"));
    await press("workspace-resume-resume");
    expect(text("workspace-resume-error")).toBe("Couldn't check the room just now. Check your connection and try again.");
    expect(screen.getByTestId("workspace-resume")).toBeTruthy();
    mockQueue.mockResolvedValue([room205()]);
    await press("workspace-resume-resume");
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(text("workspace-progress-fraction")).toBe("1 of 6");
  });

  it("resuming needs a live check: if the connection drops while the prompt is open, it asks to connect instead", async () => {
    await keep(seed({ toilet: "pass" }));
    const { screen, text } = await open();
    await act(async () => useAppStore.setState({ isOnline: false }));
    await settle();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(text("workspace-unavailable-title")).toBe("Connect to start");
    expect(await stored()).not.toBeNull();
  });
});

describe("a draft never lands on the wrong hotel, person, room, day or cleaning", () => {
  it("another person's or another hotel's or another room's draft is never offered", async () => {
    for (const key of [draftKey("hotel-1", "sup-2", "room-205"), draftKey("hotel-2", "sup-1", "room-205"), draftKey("hotel-1", "sup-1", "room-305")]) {
      await AsyncStorage.setItem(key, JSON.stringify(seed({ toilet: "pass" })));
    }
    const { screen, text } = await open();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
  });

  it("a draft filed under this account whose contents say otherwise is cleared, not applied", async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(seed({ toilet: "pass" }, { userId: "someone-else" })));
    const { screen, text } = await open();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
    expect(await stored()).toBeNull();
  });

  it("a new cleaning of the room makes the old answers meaningless: cleared, with a plain notice", async () => {
    await keep(seed({ toilet: "pass" }, { cleanCycleId: "cycle-0" }));
    const { screen, text } = await open();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(text("workspace-notice")).toContain("earlier cleaning of this room");
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
    expect(await stored()).toBeNull();
  });

  it("a different earlier failure (reinspection lineage) is a different inspection", async () => {
    await keep(seed({ toilet: "pass" }, { reinspectionOf: "insp-old" }));
    const { screen } = await open();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(await stored()).toBeNull();
  });

  it("a draft from an earlier hotel day is never resumed", async () => {
    await keep(seed({ toilet: "pass" }, { businessDate: "2026-10-19" }));
    const { screen } = await open();
    expect(screen.queryByTestId("workspace-resume")).toBeNull();
    expect(await stored()).toBeNull();
  });

  it("an unreadable stored draft is removed and said so", async () => {
    await AsyncStorage.setItem(KEY, "{broken");
    const { text } = await open();
    expect(text("workspace-notice")).toContain("A saved draft couldn't be read and was removed.");
  });

  it("if storage cannot be read at all the supervisor chooses: try again, or continue without it", async () => {
    const restoreStorage = breakStorage("getItem");
    const { screen, text, press } = await open();
    expect(text("workspace-unavailable-title")).toBe("Couldn't check for a saved draft");
    expect(screen.queryByTestId("workspace-list")).toBeNull();
    restoreStorage();
    await press("workspace-unavailable-retry");
    await settle();
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
  });

  it("'continue without it' starts a fresh checklist", async () => {
    breakStorage("getItem");
    const { press, text } = await open();
    await press("workspace-unavailable-continue");
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
  });
});

describe("when the checklist was edited", () => {
  const edited = () =>
    standardTemplate({
      fingerprint: "fp-2",
      items: [
        rawItem("n-toilet", { section: "Bathroom", description: "Toilet sanitized", sort_order: 1 }), // same question, new id
        rawItem("n-mirror", { section: "Bathroom", description: "Bathroom mirrors cleaned", sort_order: 2 }), // reworded
        rawItem("n-bed", { section: "Bedroom", description: "Bedding", sort_order: 3 }),
        rawItem("n-card", { section: "Entry", description: "Safety card in place", sort_order: 4 }), // new
      ],
    });

  it("stops the way to approval, explains, and shows what carries over - never silently passing anything", async () => {
    await keep(seed({ toilet: "pass", mirror: "pass", bed: "fail" }));
    mockTemplates.mockResolvedValue({ data: [edited()] });
    const { screen, text } = await open();
    expect(text("workspace-template-changed-title")).toBe("The checklist changed");
    expect(text("workspace-template-carried")).toBe("2 answers still match"); // toilet and bed; the reworded mirror is a different question
    expect(text("workspace-template-dropped")).toBe("1 answer no longer applies");
    expect(text("workspace-template-needed")).toBe("2 required items still need an answer"); // mirror (reworded) and the new card
    expect(screen.queryByTestId("workspace-review")).toBeNull();
    expect(await stored()).toMatchObject({ templateFingerprint: "fp-1" }); // the old draft is untouched until the supervisor chooses
  });

  it("keeping the matching answers re-bases the draft on the new checklist, with a NEW submission id", async () => {
    await keep(seed({ toilet: "pass", mirror: "pass", bed: "fail" }));
    mockTemplates.mockResolvedValue({ data: [edited()] });
    const { screen, press, text } = await open();
    await press("workspace-template-keep");
    await afterAutosave();
    expect(screen.queryByTestId("workspace-template-changed")).toBeNull();
    expect(screen.getByTestId("workspace-answer-n-toilet-pass").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("workspace-answer-n-mirror-pass").props.accessibilityState).toMatchObject({ checked: false });
    expect(text("workspace-progress-fraction")).toBe("2 of 4"); // toilet and bed; the reworded mirror is not carried
    const draft = await stored();
    expect(draft).toMatchObject({ templateFingerprint: "fp-2", answers: { "n-toilet": { result: "pass" }, "n-bed": { result: "fail" } } });
    expect(draft!.submissionId).not.toBe("sub-original");
  });

  it("starting over from here asks first and clears the saved answers", async () => {
    await keep(seed({ toilet: "pass" }));
    mockTemplates.mockResolvedValue({ data: [edited()] });
    const { press, text } = await open();
    await press("workspace-template-startover");
    expect(text("workspace-startover")).toContain("1 answer saved for Room 205");
    await press("workspace-startover-confirm");
    await settle();
    expect(await stored()).toBeNull();
    expect(text("workspace-progress-fraction")).toBe("0 of 4");
  });

  it("with no matching answers the only way on is the new checklist, plainly named", async () => {
    await keep(seed({ mirror: "pass" }));
    mockTemplates.mockResolvedValue({ data: [edited()] });
    const { screen } = await open();
    expect(screen.getByText("Continue with the new checklist")).toBeTruthy();
  });

  it("a checklist edited WHILE inspecting interrupts at once; the answers so far are saved first", async () => {
    const { answer, text, screen } = await open();
    await answer("toilet", "pass");
    mockTemplates.mockResolvedValue({ data: [edited()] });
    mockQueue.mockResolvedValue([room205()]);
    const refresh = (require("../helpers/workspaceMocks").mockSubscribe as jest.Mock).mock.calls.at(-1)?.[1] as (() => void) | undefined;
    await act(async () => refresh?.());
    await settle();
    expect(text("workspace-template-changed-title")).toBe("The checklist changed");
    expect(screen.queryByTestId("workspace-review")).toBeNull();
    expect((await stored())?.answers).toEqual({ toilet: { result: "pass" } });
  });
});

describe("leaving", () => {
  it("an untouched checklist is left silently; nothing is stored", async () => {
    const { press } = await open();
    await press("workspace-back");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("with answers it asks: Save & exit writes first, then goes back to the queue", async () => {
    const { screen, answer, press, text } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    expect(navigate).not.toHaveBeenCalled();
    expect(text("workspace-saveexit-title")).toBe("Save inspection draft?");
    expect(text("workspace-saveexit")).toContain("Room 205");
    expect(text("workspace-saveexit")).toContain("1 of 6 items reviewed");
    await press("workspace-saveexit-save");
    await settle();
    expect((await stored())?.answers).toEqual({ toilet: { result: "pass" } });
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
    expect(screen).toBeTruthy();
  });

  it("Keep inspecting closes the question and loses nothing; a second Back with no new change leaves, because the draft is saved", async () => {
    const { screen, answer, press } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    await press("workspace-saveexit-keep");
    expect(screen.queryByTestId("workspace-saveexit")).toBeNull();
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: true });
    expect(navigate).not.toHaveBeenCalled();
    await press("workspace-back");
    expect(screen.queryByTestId("workspace-saveexit")).toBeNull(); // not asked again
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((await stored())?.answers).toEqual({ toilet: { result: "pass" } });
  });

  it("a further change brings the question back", async () => {
    const { screen, answer, press } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    await press("workspace-saveexit-keep");
    await answer("mirror", "pass");
    await press("workspace-back");
    expect(screen.getByTestId("workspace-saveexit")).toBeTruthy();
  });

  it("if the save fails it says so, stays put with every answer, and offers retry or leaving without saving", async () => {
    const restoreStorage = breakStorage("setItem");
    const { screen, answer, press, text } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    await press("workspace-saveexit-save");
    expect(text("workspace-saveexit-error")).toContain("Couldn't save the draft on this phone");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-saveexit-unsaved")).toBeTruthy();
    restoreStorage();
    await press("workspace-saveexit-save");
    await settle();
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
    expect((await stored())?.answers).toEqual({ toilet: { result: "pass" } });
  });

  it("leaving without saving is possible only after a failure, and says what it is", async () => {
    breakStorage("setItem");
    const { answer, press, screen } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    expect(screen.queryByTestId("workspace-saveexit-unsaved")).toBeNull();
    await press("workspace-saveexit-save");
    await press("workspace-saveexit-unsaved");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });

  it("tapping Save & exit twice writes once and navigates once", async () => {
    const writes = watchStorage("setItem");
    restores.push(writes.stop);
    const { answer, press, screen } = await open();
    await answer("toilet", "pass");
    await afterAutosave();
    writes.reset();
    await answer("mirror", "pass");
    await press("workspace-back");
    await act(async () => {
      fireEvent.press(screen.getByTestId("workspace-saveexit-save"));
      fireEvent.press(screen.getByTestId("workspace-saveexit-save"));
    });
    await settle();
    expect(writes.calls()).toBe(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("Discard asks separately, deletes only this room's draft for this account, then leaves", async () => {
    await AsyncStorage.setItem(draftKey("hotel-1", "sup-1", "room-305"), JSON.stringify(seed({ toilet: "pass" }, { roomId: "room-305" })));
    const { screen, answer, press, text } = await open();
    await answer("toilet", "pass");
    await afterAutosave();
    await answer("mirror", "pass");
    await press("workspace-back");
    await press("workspace-saveexit-discard");
    expect(text("workspace-discard-title")).toBe("Discard this draft?");
    expect(await stored()).not.toBeNull();
    await press("workspace-discard-keep");
    expect(screen.getByTestId("workspace-saveexit")).toBeTruthy(); // back to the question, nothing lost
    await press("workspace-saveexit-discard");
    await press("workspace-discard-confirm");
    await settle();
    expect(await stored()).toBeNull();
    expect(await AsyncStorage.getItem(draftKey("hotel-1", "sup-1", "room-305"))).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });

  it("a draft that was just discarded does not come back as a pending write", async () => {
    const { answer, press } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    await press("workspace-saveexit-discard");
    await press("workspace-discard-confirm");
    await afterAutosave();
    expect(await stored()).toBeNull();
  });

  it("resuming and leaving without a change needs no question", async () => {
    await keep(seed({ toilet: "pass" }));
    const { press, screen } = await open();
    await press("workspace-resume-resume");
    await press("workspace-back");
    expect(screen.queryByTestId("workspace-saveexit")).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });

  it("comes back to where it was opened from: the Room Board", async () => {
    const { press } = await open({ roomId: "room-205", roomNumber: "205", from: "board" });
    await press("workspace-back");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-205" } });
  });

  it("a crafted origin cannot send the supervisor anywhere else", async () => {
    const { press } = await open({ roomId: "room-205", from: "https://evil.example" });
    await press("workspace-back");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });
});

describe("Android back", () => {
  async function withBack() {
    const handlers: (() => boolean)[] = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_: string, handler: () => boolean) => {
      handlers.push(handler);
      return { remove: jest.fn() };
    }) as never);
    const opened = await open();
    const back = async () => {
      await act(async () => { handlers.at(-1)?.(); });
      await flush();
    };
    return { ...opened, back };
  }

  it("asks the same question as the Back arrow, and the handler consumes the press", async () => {
    const { answer, back, screen } = await withBack();
    await answer("toilet", "pass");
    await back();
    expect(screen.getByTestId("workspace-saveexit")).toBeTruthy();
  });

  it("from the read-only review it returns to the checklist instead of leaving", async () => {
    const { answer, press, back, screen } = await withBack();
    for (const id of ["toilet", "mirror", "towels"]) await answer(id, "pass");
    await press("workspace-section-Bedroom");
    await answer("bed", "pass");
    await press("workspace-section-Entry");
    await answer("door", "pass");
    await press("workspace-review");
    expect(screen.getByTestId("workspace-review-view")).toBeTruthy();
    await back();
    expect(screen.queryByTestId("workspace-review-view")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("with nothing entered it leaves", async () => {
    const { back } = await withBack();
    await back();
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });

  it("the resume prompt's back leaves without touching the saved draft", async () => {
    await keep(seed({ toilet: "pass" }));
    const { back } = await withBack();
    await back();
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
    expect(await stored()).not.toBeNull();
  });
});

describe("the draft sheets in Spanish", () => {
  it("speak Spanish", async () => {
    mockState.language = "es";
    const { answer, press, text } = await open();
    await answer("toilet", "pass");
    await press("workspace-back");
    expect(text("workspace-saveexit-title")).toBe("¿Guardar el borrador de la inspección?");
    expect(text("workspace-saveexit")).toContain("1 de 6 puntos revisados");
    expect(en("inspect.workspace.saveExit.save")).toBe("Save & exit");
  });
});
