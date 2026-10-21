import { StyleSheet } from "react-native";
import { act, fireEvent, within } from "@testing-library/react-native";
import {
  AsyncStorage,
  mockComplete,
  mockQueue,
  mockState,
  mockSubmitLegacy,
  mockTemplates,
  navigate,
  openWorkspace as open,
  renderWorkspace,
  resetWorld,
  room205,
} from "../helpers/workspaceMocks";
import { allStrings, CHECKLIST_ITEMS, en, es, flush, REQUIRED_COUNT, settle, standardTemplate } from "../helpers/workspaceHarness";
import { useAppStore } from "@/stores/appStore";
import { rawTemplate, readyRoom } from "../helpers/inspectionFixtures";

/* ─── The active inspection workspace ───────────────────────────────────────
   Opening a room, its checklist, answers, progress, guidance, review. Drafts, drawers and safety are in the sibling
   suites (InspectionWorkspaceDrafts / Drawers / Safety), which share the same fakes (helpers/workspaceMocks). */

let dateNow: jest.SpyInstance;
beforeEach(async () => {
  dateNow = await resetWorld();
});
afterEach(async () => {
  await flush();
  dateNow.mockRestore();
});

describe("opening a room", () => {
  it("shows the room the id names, with only recorded facts, and the hotel's checklist by section in configured order", async () => {
    const { screen, text } = await open();
    expect(text("workspace-title")).toBe("Inspect Room 205");
    expect(text("workspace-room-number")).toBe("205");
    expect(text("workspace-room-status")).toBe("Awaiting inspection");
    expect(text("workspace-room-details")).toBe("Standard King · Departure · Floor 2");
    expect(text("workspace-room-cleaned")).toBe("Cleaned by Maria S. · 11:42 AM");
    expect(text("workspace-room-checklist")).toBe("Checklist: Standard Departure");
    const sections = screen.getAllByTestId(/^workspace-section-(?!count|open)/).map((node) => node.props.testID);
    expect(sections).toEqual(["workspace-section-Bathroom", "workspace-section-Bedroom", "workspace-section-Entry"]);
    expect(text("workspace-section-count-Bathroom")).toBe("0/3");
    expect(text("workspace-section-count-Bedroom")).toBe("0/2");
  });

  it("opens the first section that still needs answers, in order, and keeps the others closed", async () => {
    const { screen, has } = await open();
    expect(has("workspace-item-toilet")).toBe(true);
    expect(screen.getAllByTestId(/^workspace-item-[a-z]+$/).map((n) => n.props.testID)).toEqual(["workspace-item-toilet", "workspace-item-mirror", "workspace-item-towels"]);
    expect(has("workspace-item-bed")).toBe(false);
    expect(has("workspace-item-door")).toBe(false);
  });

  it("resolves by the stable id, never by the label", async () => {
    const { text } = await open({ roomId: "room-305", roomNumber: "205", from: "queue" });
    expect(text("workspace-room-number")).toBe("305");
  });

  it("two rooms with the same number are told apart by id", async () => {
    mockQueue.mockResolvedValue([room205({ room_id: "tower-a-205", building: "A", cleaned_by: "Ana" }), room205({ room_id: "tower-b-205", building: "B", cleaned_by: "Bo" })]);
    const { text } = await open({ roomId: "tower-b-205", roomNumber: "205", from: "queue" });
    expect(text("workspace-room-cleaned")).toBe("Cleaned by Bo · 11:42 AM");
    expect(text("workspace-room-details")).toContain("Building B");
  });

  it("opening starts nothing: no draft is stored, nothing is submitted, no status changes", async () => {
    await open();
    await flush();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(mockSubmitLegacy).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("a reinspection says so and marks the items that failed last time", async () => {
    const failure = { inspection_id: "insp-1", inspected_at: "2026-10-20T14:00:00Z", overall_result: "failed", notes: null, correction_kind: "reclean" as const, items: [{ id: "mirror", label: "Bathroom mirrors", note: null }] };
    mockQueue.mockResolvedValue([room205({ previous_failure: failure })]);
    const { text, has } = await open();
    expect(text("workspace-room-status")).toBe("Reinspection");
    expect(text("workspace-room-recheck")).toBe("1 item failed last time");
    expect(has("workspace-item-mirror")).toBe(true);
  });

  it("does not display invented facts when the server did not record them", async () => {
    mockQueue.mockResolvedValue([room205({ room_type_name: null, cleaned_by: "", cleaned_at: null, clean_type: null, floor: null })]);
    const { has } = await open();
    expect(has("workspace-room-details")).toBe(false);
    expect(has("workspace-room-cleaned")).toBe(false);
  });
});

describe("a link that cannot be inspected", () => {
  it("an invalid id selects nothing", async () => {
    const { text, has } = await open({ roomId: "../../x", from: "queue" });
    expect(text("workspace-unavailable-title")).toBe("This link isn't valid");
    expect(has("workspace-list")).toBe(false);
  });

  it("a room that is not in this hotel's queue (finished, being cleaned, or foreign) says so and never switches rooms", async () => {
    const { screen, text, press } = await open({ roomId: "room-999", roomNumber: "999", from: "queue" });
    expect(text("workspace-unavailable-title")).toBe("Not waiting for inspection");
    expect(screen.queryByTestId("workspace-room-number")).toBeNull();
    expect(screen.queryByText("305")).toBeNull();
    await press("workspace-unavailable-back");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
  });

  it("when the queue cannot be read the room is not judged missing; there is a retry that recovers", async () => {
    mockQueue.mockReset();
    mockQueue.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    const { screen, text, press } = await open();
    expect(text("workspace-unavailable-title")).toBe("Couldn't check this room");
    expect(screen.queryByText("Not waiting for inspection")).toBeNull();
    mockQueue.mockResolvedValue([room205()]);
    await press("workspace-unavailable-retry");
    await settle();
    expect(text("workspace-room-number")).toBe("205");
  });

  it("offline with nothing verified yet asks for a connection instead of spinning forever", async () => {
    mockQueue.mockReset();
    mockQueue.mockReturnValue(new Promise(() => undefined));
    useAppStore.setState({ isOnline: false });
    const { text } = await open();
    expect(text("workspace-unavailable-title")).toBe("Connect to start");
  });

  it("says which checklist problem blocks the room, never a guess", async () => {
    mockTemplates.mockResolvedValue({ data: [standardTemplate({ is_active: false })] });
    const { text } = await open();
    expect(text("workspace-unavailable-title")).toBe("Checklist unavailable");
    expect(text("workspace-unavailable-body")).toBe(en("inspect.template.no_usable_template"));
  });

  it("checklists that could not be loaded say so", async () => {
    mockTemplates.mockRejectedValue(new Error("offline"));
    const { text } = await open();
    expect(text("workspace-unavailable-title")).toBe("Couldn't load the checklist");
  });

  it("uses the checklist configured for the room's own type, not whichever the server listed first", async () => {
    mockQueue.mockResolvedValue([room205({ room_type_id: "type-suite" })]);
    mockTemplates.mockResolvedValue({
      data: [
        standardTemplate({ id: "t-default", name: "Default" }),
        standardTemplate({ id: "t-king", name: "King checklist", is_default: false, room_type_id: "type-king" }),
        rawTemplate("t-suite", { name: "Suite checklist", is_default: false, room_type_id: "type-suite", items: [{ ...CHECKLIST_ITEMS[0], id: "suite-only", section: "Suite", description: "Minibar stocked" }] }),
      ],
    });
    const { text, has } = await open();
    expect(text("workspace-room-checklist")).toBe("Checklist: Suite checklist");
    expect(has("workspace-item-suite-only")).toBe(true);
  });

  it("does not guess when the room type is unknown and a type-specific checklist exists", async () => {
    mockQueue.mockResolvedValue([room205({ room_type_id: null })]);
    mockTemplates.mockResolvedValue({ data: [standardTemplate({ is_default: false, room_type_id: "type-suite" })] });
    const { text } = await open();
    expect(text("workspace-unavailable-body")).toBe(en("inspect.template.room_type_unknown"));
  });
});

describe("answers and progress", () => {
  it("an unanswered item is not a pass: progress starts at zero and says what is left", async () => {
    const { screen, text } = await open();
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
    expect(text("workspace-progress-line")).toBe("5 required items left  ·  No issues so far");
    for (const id of ["toilet", "mirror", "towels"]) {
      for (const choice of ["pass", "fail", "na"]) expect(screen.getByTestId(`workspace-answer-${id}-${choice}`).props.accessibilityState.checked).toBe(false);
    }
  });

  it("Pass, Issue and N/A each record an explicit answer, with selected state announced", async () => {
    const { screen, answer, text } = await open();
    await answer("toilet", "pass");
    await answer("mirror", "fail");
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: true, selected: true });
    expect(screen.getByTestId("workspace-answer-toilet-fail").props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId("workspace-answer-mirror-fail").props.accessibilityState).toMatchObject({ checked: true });
    expect(text("workspace-progress-fraction")).toBe("2 of 6");
    expect(text("workspace-progress-line")).toBe("3 required items left  ·  1 issue found");
    await answer("toilet", "na");
    expect(screen.getByTestId("workspace-answer-toilet-na").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: false });
  });

  it("an accidental tap is undone by tapping the chosen answer again", async () => {
    const { screen, answer, text } = await open();
    await answer("toilet", "pass");
    expect(text("workspace-progress-fraction")).toBe("1 of 6");
    await answer("toilet", "pass");
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: false });
  });

  it("a failed item counts as reviewed but stays failed, and says its details are still needed", async () => {
    const { answer, text } = await open();
    await answer("mirror", "fail");
    expect(text("workspace-progress-fraction")).toBe("1 of 6");
    expect(text("workspace-issue-mirror")).toBe("Issue details still needed before approval");
  });

  it("N/A is refused where the item does not allow it, with the reason shown and no answer recorded", async () => {
    const { screen, answer, text } = await open();
    expect(screen.getByTestId("workspace-answer-towels-na").props.accessibilityState).toMatchObject({ disabled: true });
    await answer("towels", "na");
    expect(text("workspace-hint-towels")).toBe("N/A isn't allowed for this check.");
    expect(text("workspace-progress-fraction")).toBe("0 of 6");
    await answer("towels", "pass");
    expect(screen.queryByTestId("workspace-hint-towels")).toBeNull();
  });

  it("the progress bar shows completion only: it is not coloured as a pass and never reads 'passed'", async () => {
    const { screen, answer, text } = await open();
    for (const id of ["toilet", "mirror", "towels"]) await answer(id, "pass");
    expect(StyleSheet.flatten(screen.getByTestId("workspace-progress-fill", { includeHiddenElements: true }).props.style)).toMatchObject({ width: "50%" });
    expect(text("workspace-progress-line")).not.toMatch(/pass/i);
    expect(screen.getByTestId("workspace-progress").props.accessibilityLabel).toContain("Progress is not a result");
  });

  it("answering keeps the checklist where it is: no section opens, closes or jumps on its own", async () => {
    const { screen, answer, has } = await open();
    await answer("toilet", "pass");
    await answer("mirror", "pass");
    await answer("towels", "pass"); // the whole first section is done
    expect(has("workspace-item-toilet")).toBe(true);
    expect(has("workspace-item-bed")).toBe(false);
    expect(screen.getByTestId("workspace-section-count-Bathroom").props.children).toBe("3/3");
  });

  it("sections collapse and expand without touching their answers", async () => {
    const { answer, press, has, text } = await open();
    await answer("toilet", "pass");
    await press("workspace-section-Bathroom");
    expect(has("workspace-item-toilet")).toBe(false);
    expect(text("workspace-section-count-Bathroom")).toBe("1/3");
    await press("workspace-section-Bedroom");
    expect(has("workspace-item-bed")).toBe(true);
    await press("workspace-section-Bathroom");
    expect(has("workspace-item-toilet")).toBe(true);
  });

  it("'Go to next item' opens the section of the next required item and does not answer anything", async () => {
    const { answer, press, has, text } = await open();
    for (const id of ["toilet", "mirror", "towels"]) await answer(id, "pass");
    await press("workspace-next");
    expect(has("workspace-item-bed")).toBe(true);
    expect(text("workspace-progress-fraction")).toBe("3 of 6");
  });

  it("a note can be added to a pass and survives collapsing the section", async () => {
    const { screen, answer, press } = await open();
    await answer("toilet", "pass");
    await press("workspace-add-note-toilet");
    await act(async () => fireEvent.changeText(screen.getByTestId("workspace-note-toilet"), "Seat loose"));
    await press("workspace-section-Bathroom");
    await press("workspace-section-Bathroom");
    expect(screen.getByTestId("workspace-note-toilet").props.value).toBe("Seat loose");
  });

  it("an optional item is labelled optional and never required", async () => {
    const { press, screen } = await open();
    await press("workspace-section-Bedroom");
    expect(within(screen.getByTestId("workspace-item-lamp")).getByText("Optional")).toBeTruthy();
    expect(within(screen.getByTestId("workspace-item-bed")).getByText("Required")).toBeTruthy();
  });
});

describe("checklist standard", () => {
  it("offers a standard only where there is something to read, and shows the configured wording exactly", async () => {
    const { screen, has, press } = await open();
    expect(has("workspace-guidance-toilet")).toBe(false); // plain, short: the row already says it all
    expect(has("workspace-guidance-towels")).toBe(true); // N/A not allowed
    await press("workspace-guidance-towels");
    expect(within(screen.getByTestId("workspace-guidance")).getByTestId("workspace-guidance-standard").props.children).toBe("Towels and amenities");
    expect(screen.getByText("N/A is not allowed.")).toBeTruthy();
  });

  it("opening and closing it leaves the answer alone", async () => {
    const { screen, answer, press } = await open();
    await answer("towels", "fail");
    await press("workspace-guidance-towels");
    await press("workspace-guidance-done");
    expect(screen.queryByTestId("workspace-guidance-standard")).toBeNull();
    expect(screen.getByTestId("workspace-answer-towels-fail").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("states the photo requirement from the template, nothing else", async () => {
    const { press, screen } = await open();
    await press("workspace-section-Entry");
    await press("workspace-guidance-door");
    expect(screen.getByText("A photo is needed if this fails.")).toBeTruthy();
    expect(screen.getByText("Required item")).toBeTruthy();
  });
});

describe("reviewing", () => {
  it("with required items missing it explains and takes the supervisor to the first one, never to a review", async () => {
    const { screen, answer, press, has } = await open();
    await answer("toilet", "pass");
    await press("workspace-section-Bathroom"); // close it, then ask to review
    await press("workspace-review");
    expect(screen.getByText(en("inspect.workspace.review.missing", { count: 4 }))).toBeTruthy();
    expect(has("workspace-review-view")).toBe(false);
    expect(has("workspace-item-mirror")).toBe(true); // its section was reopened
  });

  it("with everything answered it opens a read-only review: counts, findings, outstanding details - and no way to submit", async () => {
    const { screen, answer, press, text, has } = await open();
    for (const id of ["toilet", "towels"]) await answer(id, "pass");
    await answer("mirror", "fail");
    await press("workspace-section-Bedroom");
    await answer("bed", "pass");
    await press("workspace-section-Entry");
    await answer("door", "na");
    await press("workspace-review");
    expect(has("workspace-review-view")).toBe(true);
    expect(text("workspace-review-count-pass")).toContain("3");
    expect(text("workspace-review-count-fail")).toContain("1");
    expect(text("workspace-review-count-na")).toContain("1");
    expect(within(screen.getByTestId("workspace-review-issue-mirror")).getByText("Issue details are still needed.")).toBeTruthy();
    expect(text("workspace-review-outstanding")).toBe("1 issue still needs details before this inspection can be approved.");
    expect(text("workspace-review-readonly")).toContain("Nothing has been submitted");
    // no submit, approve, send-back or pass/fail outcome control exists
    expect(screen.queryAllByRole("button", { name: /submit|approve|send back|confirm|finish|complete/i })).toEqual([]);
    expect(mockSubmitLegacy).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("going back from the review returns to the checklist with every answer intact", async () => {
    const { screen, answer, press, has } = await open();
    for (const id of ["toilet", "mirror", "towels"]) await answer(id, "pass");
    await press("workspace-section-Bedroom");
    await answer("bed", "pass");
    await press("workspace-section-Entry");
    await answer("door", "pass");
    await press("workspace-review");
    expect(has("workspace-review-view")).toBe(true);
    await press("workspace-back-to-checklist");
    expect(has("workspace-review-view")).toBe(false);
    expect(screen.getByTestId("workspace-answer-door-pass").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("review never writes a room status or an outcome anywhere", async () => {
    const { answer, press } = await open();
    for (const id of ["toilet", "mirror", "towels"]) await answer(id, "pass");
    await press("workspace-section-Bedroom");
    await answer("bed", "pass");
    await press("workspace-section-Entry");
    await answer("door", "pass");
    await press("workspace-review");
    await press("workspace-back-to-checklist");
    expect(mockSubmitLegacy).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(REQUIRED_COUNT).toBe(5);
  });
});

describe("language and theme", () => {
  it("renders real Spanish, never a raw key", async () => {
    mockState.language = "es";
    const { screen, text } = await open();
    expect(text("workspace-title")).toBe("Inspeccionar habitación 205");
    expect(text("workspace-room-status")).toBe("Pendiente de inspección");
    expect(screen.getByTestId("workspace-answer-toilet-fail").props.accessibilityLabel).toBe("Problema para Toilet sanitized");
    expect(allStrings(screen).filter((value) => /inspect\.workspace\./.test(value))).toEqual([]);
    expect(es("inspect.workspace.review.cta")).toBe("Revisar inspección");
  });

  it("renders the same content in dark mode", async () => {
    mockState.scheme = "dark";
    const { screen, text } = await open();
    expect(text("workspace-room-number")).toBe("205");
    expect(screen.getByTestId("workspace-item-toilet")).toBeTruthy();
  });

  it("controls are named, at least 48 points tall, and text scales with a cap", async () => {
    const { screen } = await open();
    const chip = screen.getByTestId("workspace-answer-toilet-pass");
    expect(StyleSheet.flatten(chip.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(chip.props.accessibilityRole).toBe("radio");
    expect(screen.getByTestId("workspace-title").props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.6);
  });
});
