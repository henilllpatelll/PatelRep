import { selectTeamCounts } from "@/lib/housekeeping/assignmentSelectors";
import {
  buildStaffDetail,
  buildTeamCard,
  buildTeamHeaderMetrics,
  capacityLine,
  remainingText,
  teamEmptyKind,
  teamNotices,
} from "@/lib/housekeeping/assignmentTeamView";
import { availableSource, failedSource, loadingSource, offlineSource } from "@/lib/housekeeping/supervisorSources";
import type { RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import { makeTranslator } from "../helpers/i18n";
import { SETTINGS, assignmentsOf, rosterOf, rosterRow, shift } from "../helpers/assignmentFixtures";
import { NOW, rawRoom } from "../helpers/roomBoardFixtures";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";

const t = makeTranslator("en");
const owned = (number: string, status: string, user: string, extra = {}) => rawRoom(number, status, { assigned_to: user, assignment_id: `as-${number}`, ...extra });
const member = (model: AssignmentsModel, id: string) => {
  const found = model.team?.find((candidate) => candidate.userId === id);
  if (!found) throw new Error(`no team member ${id}`);
  return found;
};
const entriesOf = (model: AssignmentsModel) => new Map((model.rooms ?? []).map((entry) => [entry.room.roomId, entry] as const));
const apiError = (status: number) => Object.assign(new Error("x"), { status });

describe("header counts (On shift / On break / Need review)", () => {
  const raw = [owned("101", "DIRTY", "hk-1"), owned("102", "DIRTY", "hk-2")];

  it("counts only VERIFIED attendance: on shift and on break come from the roster", () => {
    const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "ended")]) });
    expect(buildTeamHeaderMetrics(model)).toMatchObject({ onShift: 1, onBreak: 1 });
  });

  it("assigned rooms and a schedule never count as on shift", () => {
    const model = assignmentsOf({ raw, roster: rosterOf([]), schedule: availableSource([shift("hk-1"), shift("hk-2")], NOW) });
    expect(buildTeamHeaderMetrics(model)).toMatchObject({ onShift: 0, onBreak: 0 });
    expect(member(model, "hk-1").attendance).toBe("scheduled_not_clocked_in");
  });

  it.each([
    ["failed", failedSource<RosterEntry[]>(apiError(500), loadingSource())],
    ["loading", loadingSource<RosterEntry[]>()],
    ["stale", offlineSource(rosterOf([rosterRow("hk-1", "active")]))],
  ])("a %s roster is unknown — never zero people on shift", (_name, roster) => {
    const counts = selectTeamCounts(assignmentsOf({ raw, roster }));
    expect(counts.onShift).toBeNull();
    expect(counts.onBreak).toBeNull();
  });

  it("an unavailable staff list also withholds the attendance counts (the team would be incomplete)", () => {
    const model = assignmentsOf({ raw, staff: failedSource(apiError(500), loadingSource()), roster: rosterOf([rosterRow("hk-1", "active")]) });
    expect(model.staffListKnown).toBe(false);
    expect(selectTeamCounts(model).onShift).toBeNull();
  });

  it("is unknown while the board is unavailable", () => {
    const counts = selectTeamCounts(assignmentsOf({ boardDate: "2026-10-15" }));
    expect(counts).toMatchObject({ onShift: null, onBreak: null, needReview: null });
  });

  it("'Need review' counts people with a supported concern and is a lower bound when evidence is missing", () => {
    const base = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "active")]) });
    // hk-2 owns an open room, is not clocked in and is not scheduled → a verified concern.
    expect(selectTeamCounts(base)).toMatchObject({ needReview: 1 });
    // Everything verified (settings + schedule + roster + staff) → exact.
    expect(selectTeamCounts(base).needReviewAtLeast).toBe(false);
    // Roster unverified → the count cannot be exact, and a zero would be a guess.
    const noRoster = assignmentsOf({ raw, roster: failedSource(apiError(500), loadingSource()) });
    expect(selectTeamCounts(noRoster)).toMatchObject({ needReview: null, needReviewAtLeast: true });
  });

  it("the Rooms header and the Team header use ONE on-shift definition", () => {
    const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active")]) });
    expect(selectTeamCounts(model).onShift).toBe(2);
  });
});

describe("a staff card", () => {
  it("shows a person with ZERO assignments and says so honestly", () => {
    const model = assignmentsOf({ raw: [owned("101", "DIRTY", "hk-1")], roster: rosterOf([rosterRow("hk-2", "active")]) });
    const card = buildTeamCard(member(model, "hk-2"), t);
    expect(card).toMatchObject({ name: "Ben Ortiz", stats: "No rooms assigned", remaining: "No current cleaning workload", capacity: null, preview: [] });
    expect(card.attendance).toMatchObject({ attendance: "on_shift", label: "On shift" });
  });

  it("an employee on break keeps their assignments, with a note — nothing is removed or moved", () => {
    const model = assignmentsOf({
      raw: [owned("101", "DIRTY", "hk-1"), owned("102", "DIRTY", "hk-1"), owned("103", "IN_PROGRESS", "hk-1"), owned("104", "CLEAN", "hk-1", { inspection_required: true })],
      roster: rosterOf([rosterRow("hk-1", "on_break")]),
    });
    const card = buildTeamCard(member(model, "hk-1"), t);
    expect(card.counts).toEqual({ assigned: 4, completed: 1, inProgress: 1, notStarted: 2 });
    expect(card.attendance.label).toBe("On break");
    expect(card.notes.map((note) => note.key)).toContain("on_break");
    expect(card.notes.find((note) => note.key === "on_break")?.text).toMatch(/discouraged/);
    expect(card.preview.map((room) => room.number).sort()).toEqual(["101", "102", "103", "104"]);
  });

  it("a shift that ended with unfinished rooms is an actionable concern", () => {
    const model = assignmentsOf({ raw: [owned("101", "DIRTY", "hk-1"), owned("102", "DIRTY", "hk-1")], roster: rosterOf([rosterRow("hk-1", "ended")]) });
    const card = buildTeamCard(member(model, "hk-1"), t);
    expect(card.attendance.label).toBe("Shift ended");
    expect(card.notes[0]).toMatchObject({ key: "shift_ended_with_open_rooms", tone: "warn", text: "Shift ended · 2 rooms still open" });
  });

  it("a person known only from a room assignment gets a safe fallback name — their rooms are not dropped", () => {
    const model = assignmentsOf({ raw: [owned("101", "DIRTY", "ghost")] });
    const ghost = member(model, "ghost");
    expect(ghost.listed).toBe(false);
    const card = buildTeamCard(ghost, t);
    expect(card).toMatchObject({ name: "Name unavailable", unnamed: true, unlisted: true });
    expect(card.counts.assigned).toBe(1);
  });

  it("completed / in-progress / not-started are counted from room stages", () => {
    const model = assignmentsOf({
      raw: [
        owned("101", "CLEAN", "hk-1", { inspection_required: true }),
        owned("102", "INSPECTED", "hk-1"),
        owned("103", "IN_PROGRESS", "hk-1"),
        owned("104", "DIRTY", "hk-1"),
        owned("105", "PICKUP", "hk-1"),
      ],
    });
    const card = buildTeamCard(member(model, "hk-1"), t);
    expect(card.counts).toEqual({ assigned: 5, completed: 2, inProgress: 1, notStarted: 2 });
    expect(card.stats).toBe("5 rooms · 2 completed · 1 in progress");
  });

  it("room chips are a short preview: at most five, the rest as '+N more'", () => {
    const model = assignmentsOf({ raw: Array.from({ length: 8 }, (_, index) => owned(`10${index}`, "DIRTY", "hk-1")) });
    const card = buildTeamCard(member(model, "hk-1"), t);
    expect(card.preview).toHaveLength(5);
    expect(card.more).toBe(3);
  });

  it("coverage names the floors a person works, only from recorded floors", () => {
    const model = assignmentsOf({ raw: [owned("101", "DIRTY", "hk-1"), owned("301", "DIRTY", "hk-1")] });
    expect(buildTeamCard(member(model, "hk-1"), t).coverage).toBe("Building A · Floors 1, 3");
  });
});

describe("remaining time is never invented", () => {
  const noEstimateRoom = (number: string, user: string) =>
    owned(number, "DIRTY", user, { rooms: { id: `room-${number}`, room_number: number, floor: 1, building: "A", room_types: { code: "K" } } });

  it("a complete estimate is stated plainly", () => {
    const model = assignmentsOf({ raw: [owned("101", "DIRTY", "hk-1"), owned("102", "DIRTY", "hk-1")] });
    expect(remainingText(member(model, "hk-1"), t)).toBe("60 min remaining");
  });

  it("a partial sum is labelled 'At least … · N estimates missing', never as the whole", () => {
    const model = assignmentsOf({ raw: [owned("101", "DIRTY", "hk-1"), noEstimateRoom("102", "hk-1"), noEstimateRoom("103", "hk-1")] });
    expect(remainingText(member(model, "hk-1"), t)).toBe("At least 30 min remaining · 2 estimates missing");
  });

  it("when no remaining room has an estimate there is no number at all", () => {
    const model = assignmentsOf({ raw: [noEstimateRoom("101", "hk-1")] });
    expect(remainingText(member(model, "hk-1"), t)).toBe("Cleaning estimates unavailable");
  });

  it("finished work says nothing is left", () => {
    const model = assignmentsOf({ raw: [owned("101", "INSPECTED", "hk-1")] });
    expect(remainingText(member(model, "hk-1"), t)).toBe("Nothing left to clean");
  });

  it("totals are not capped at an eight-hour day", () => {
    const model = assignmentsOf({ raw: Array.from({ length: 20 }, (_, index) => owned(`1${String(index).padStart(2, "0")}`, "DIRTY", "hk-1")) });
    expect(remainingText(member(model, "hk-1"), t)).toBe("600 min remaining");
    expect(member(model, "hk-1").load.minutes.remainingMinutes).toBe(600);
  });
});

describe("capacity and high load", () => {
  const depRooms = (count: number, user: string) => Array.from({ length: count }, (_, index) => owned(`4${String(index).padStart(2, "0")}`, "DIRTY", user, { clean_type: "DEP" }));

  it("a reliable percentage is shown against the property's target (not capped at 100%)", () => {
    const under = assignmentsOf({ raw: depRooms(4, "hk-1") }); // 12 of 16 credits: comfortably under, no qualifier
    expect(capacityLine(member(under, "hk-1"), t)).toMatchObject({ percent: 75, fill: 0.75, text: "75% capacity used", state: "under", qualifier: null });
    const near = assignmentsOf({ raw: depRooms(5, "hk-1") }); // 15 of 16
    expect(capacityLine(member(near, "hk-1"), t)).toMatchObject({ percent: 94, state: "on", qualifier: "Near capacity" });
    const exact = assignmentsOf({ raw: [...depRooms(5, "hk-1"), owned("499", "DIRTY", "hk-1", { clean_type: "LIGHT" })] }); // 16 of 16
    expect(capacityLine(member(exact, "hk-1"), t)).toMatchObject({ percent: 100, state: "at", qualifier: "At planned capacity" });
    const heavy = assignmentsOf({ raw: depRooms(7, "hk-1") }); // 21 of 16
    expect(capacityLine(member(heavy, "hk-1"), t)).toMatchObject({ percent: 131, fill: 1, state: "over", qualifier: "Over planned capacity" });
  });

  it("an individual capacity override replaces the hotel target", () => {
    const model = assignmentsOf({
      raw: depRooms(4, "hk-1"),
      settings: availableSource({ ...SETTINGS, capacityOverrides: { "hk-1": 24 } }, NOW, () => false),
    });
    expect(capacityLine(member(model, "hk-1"), t)).toMatchObject({ percent: 50, state: "under" });
    const detail = buildStaffDetail(member(model, "hk-1"), entriesOf(model), { t, language: "en", timeZone: "America/Chicago" });
    expect(detail.rows.find((row) => row.key === "planned")?.value).toBe("24 credits (set for this person)");
  });

  it("High load appears only with evidence, never from room count alone", () => {
    const light = assignmentsOf({ raw: depRooms(4, "hk-1") });
    expect(buildTeamCard(member(light, "hk-1"), t).badge).toBeNull();
    const heavy = assignmentsOf({ raw: depRooms(7, "hk-1") });
    expect(buildTeamCard(member(heavy, "hk-1"), t).badge).toBe("High load");
    // A different person with MORE rooms but light cleans is not flagged.
    const many = assignmentsOf({ raw: Array.from({ length: 12 }, (_, index) => owned(`5${String(index).padStart(2, "0")}`, "DIRTY", "hk-2", { clean_type: "LIGHT" })) });
    expect(buildTeamCard(member(many, "hk-2"), t).badge).toBeNull();
  });

  it("without workload settings there is no percentage, no bar and no capacity warning", () => {
    const model = assignmentsOf({ raw: depRooms(7, "hk-1"), settings: failedSource(apiError(500), loadingSource()) });
    const line = capacityLine(member(model, "hk-1"), t);
    expect(line).toMatchObject({ percent: null, text: "Capacity unavailable", qualifier: null });
    const card = buildTeamCard(member(model, "hk-1"), t);
    expect(card.badge).toBeNull();
    expect(teamNotices(model).map((notice) => notice.key)).toContain("capacityUnavailable");
  });

  it("rooms with no workload credit make the percentage unavailable instead of understating it", () => {
    const model = assignmentsOf({ raw: [...depRooms(2, "hk-1"), owned("490", "DIRTY", "hk-1")] }); // third room has no clean type
    const line = capacityLine(member(model, "hk-1"), t);
    expect(line.percent).toBeNull();
    expect(line.text).toMatch(/Capacity unavailable/);
  });

  it("a lower bound that already exceeds the target still proves an overload", () => {
    const model = assignmentsOf({ raw: [...depRooms(7, "hk-1"), owned("490", "DIRTY", "hk-1")] });
    const card = buildTeamCard(member(model, "hk-1"), t);
    expect(card.badge).toBe("High load");
    expect(card.capacity?.percent).toBeNull();
    expect(card.notes.map((note) => note.text)).toContain("Over planned capacity");
  });
});

describe("notices and empty states", () => {
  const raw = [owned("101", "DIRTY", "hk-1")];

  it("a verified roster with nobody working says so; a failed roster never does", () => {
    const verified = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-3", "ended")]) });
    expect(teamNotices(verified).map((notice) => notice.key)).toContain("nobodyOnShift");
    const failed = assignmentsOf({ raw, roster: failedSource(apiError(500), loadingSource()) });
    const keys = teamNotices(failed).map((notice) => notice.key);
    expect(keys).toContain("availabilityUnverified");
    expect(keys).not.toContain("nobodyOnShift");
    expect(teamNotices(failed).find((notice) => notice.key === "availabilityUnverified")?.retry).toBe(true);
  });

  it("an unavailable staff list is its own message, and an empty list is not a failed one", () => {
    const failed = assignmentsOf({ raw: [], staff: failedSource(apiError(500), loadingSource()) });
    expect(teamEmptyKind(failed, null)).toBe("staffListUnavailable");
    const empty = assignmentsOf({ raw: [], staff: availableSource([], NOW, (list) => list.length === 0) });
    expect(teamEmptyKind(empty, null)).toBe("noStaff");
    expect(teamEmptyKind(assignmentsOf({ boardDate: "2026-10-15" }), null)).toBe("unavailable");
    expect(teamEmptyKind(assignmentsOf({ raw }), "filters")).toBe("filters");
    expect(teamEmptyKind(assignmentsOf({ raw }), null)).toBeNull();
  });
});

describe("the staff detail", () => {
  const tz = "America/Chicago";
  const raw = [
    owned("201", "CLEAN", "hk-1", { inspection_required: true }),
    owned("204", "INSPECTED", "hk-1"),
    owned("207", "IN_PROGRESS", "hk-1"),
    owned("210", "DIRTY", "hk-1"),
    owned("212", "PICKUP", "hk-1", { clean_type: "FULL" }),
  ];
  const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "active", 4 * 60 * 60_000)]) });
  const detail = buildStaffDetail(member(model, "hk-1"), entriesOf(model), { t, language: "en", timeZone: tz });

  it("lists rooms in operational order with the correct status for each", () => {
    expect(detail.rooms.map((room) => [room.number, room.status])).toEqual([
      ["207", "In progress"],
      ["210", "Not started"],
      ["212", "Not started"],
      ["201", "Completed"],
      ["204", "Completed"],
    ]);
    expect(detail.rooms.find((room) => room.number === "201")?.statusNote).toBe("Awaiting inspection");
    expect(detail.rooms.find((room) => room.number === "204")?.statusNote).toBe("Inspected");
  });

  it("states the workload rows", () => {
    const value = (key: string) => detail.rows.find((row) => row.key === key)?.value;
    expect(value("assigned")).toBe("5 rooms");
    expect(value("completed")).toBe("2 rooms");
    expect(value("inProgress")).toBe("1 room");
    expect(value("notStarted")).toBe("2 rooms");
    expect(value("remaining")).toBe("90 min remaining");
  });

  it("shows the RECORDED clock-in only, in the hotel's time zone", () => {
    expect(detail.startedText).toBe("Started 8:00 AM"); // NOW is 12:00 in Chicago; the roster row started 4 h earlier.
    const none = assignmentsOf({ raw, roster: rosterOf([]) });
    expect(buildStaffDetail(member(none, "hk-1"), entriesOf(none), { t, language: "en", timeZone: tz }).startedText).toBeNull();
    const unverified = assignmentsOf({ raw, roster: failedSource(apiError(500), loadingSource()) });
    expect(buildStaffDetail(member(unverified, "hk-1"), entriesOf(unverified), { t, language: "en", timeZone: tz }).startedText).toBeNull();
  });

  it("estimates and credits appear per room only where a value exists, and only for open work", () => {
    const open = detail.rooms.find((room) => room.number === "212");
    expect(open).toMatchObject({ estimate: "30 min", credits: "2 credits" });
    expect(detail.rooms.find((room) => room.number === "204")).toMatchObject({ estimate: null, credits: null });
  });

  it("a person with no rooms still has a detail, with an empty room list", () => {
    const idle = buildStaffDetail(member(model, "hk-3"), entriesOf(model), { t, language: "en", timeZone: tz });
    expect(idle).toMatchObject({ rooms: [], hasRooms: false, name: "Cara Reyes" });
  });

  it("offers no assign / reassign controls: the model carries none", () => {
    expect(Object.keys(detail)).not.toContain("actions");
  });
});
