import React from "react";
import { Alert } from "react-native";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* Team Scheduling Phase 3 through the REAL screen: shift detail, Add / Edit / Copy, recurring, safe cancel, version
   conflicts, retries and the shift templates screen. Only the network, router, translator, store, toast and icon font
   are doubled. The server doubled here follows routers/scheduling.py, scheduling_plan.py and scheduling_team.py. */

let mockLanguage: Language = "en";
const mockParams: Record<string, string | undefined> = {};
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ ...mockParams }),
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));

const mockAppState: { isOnline: boolean; hotelTimezone: string; user: { id: string; role: string; tenant_id: string } } = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import { api } from "@/lib/api/client";
import { hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import { addDaysToYmd } from "@/lib/scheduling/teamScheduleDates";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import TeamScheduleRoute from "@/app/(app)/team-schedule/index";
import TemplatesRoute from "@/app/(app)/team-schedule/templates";
import { allStrings } from "../helpers/workspaceHarness";
import { wirePage, wirePerson, wireShift, ZONE, type WireShift } from "../helpers/teamScheduleFixtures";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator(mockLanguage)(key, values);
const TODAY = hotelDateKey(new Date(), ZONE) as string;
const TOMORROW = addDaysToYmd(TODAY, 1);
const LATER = addDaysToYmd(TODAY, 3);

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const at = (date: string, h: number, m: number) => (zonedTimeToInstant(date, h, m, ZONE) as Date).toISOString();
function row(date: string, id: string, userId: string, over: Partial<WireShift> & Record<string, unknown> = {}): WireShift {
  return wireShift({ id, user_id: userId, work_date: date, shift_id: "t1", shift_name: "Morning", start_time: "07:00:00", end_time: "15:00:00", starts_at: at(date, 7, 0), ends_at: at(date, 15, 0), ...over });
}

const STAFF = [wirePerson("u1", "Ana Torres"), wirePerson("u2", "Ben Ruiz"), wirePerson("u3", "Cy Díaz", { roles: ["inspector"] })];
const TEMPLATES = [
  { id: "t1", name: "Morning", department_id: "d1", start_time: "07:00:00", end_time: "15:00:00", is_active: true, archived_at: null, version: 1 },
  { id: "t2", name: "Overnight", department_id: "d1", start_time: "23:00:00", end_time: "07:00:00", is_active: true, archived_at: null, version: 2 },
];

interface World {
  shifts: WireShift[];
  detail: (id: string) => Record<string, unknown>;
  templates: Record<string, unknown>[];
  usage: { upcoming: number; past: number };
}
let world: World;
const teamCalls = () => get.mock.calls.filter(([url]) => String(url).startsWith("/schedules/team")).length;

function freshWorld(): World {
  return {
    shifts: [row(TODAY, "s1", "u1"), row(TODAY, "s2", "u2", { shift_id: "t2", shift_name: "Overnight", start_time: "23:00:00", end_time: "07:00:00", starts_at: at(TODAY, 23, 0), ends_at: at(TOMORROW, 7, 0) }), row(TOMORROW, "s3", "u1"), row(TOMORROW, "s4", "u1", { shift_id: "t2", shift_name: "Evening", start_time: "16:00:00", end_time: "20:00:00", starts_at: at(TOMORROW, 16, 0), ends_at: at(TOMORROW, 20, 0) })],
    detail: (id) => ({
      data: {
        assignment: { ...world.shifts.find((s) => s.id === id), created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-20T15:45:00Z" },
        department_code: "HK",
        attendance: { applicable: false, verified: false, sessions: [] },
        rooms: { applicable: true, available: true, count: 12 },
        editable: true,
      },
    }),
    templates: TEMPLATES.map((t) => ({ ...t })),
    usage: { upcoming: 5, past: 40 },
  };
}

function serve() {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/schedules/gaps")) return { data: [], meta: { count: 0 } };
    if (url.startsWith("/schedules/team")) {
      const range = /date_from=([\d-]+)&date_to=([\d-]+)/.exec(url);
      const [from, to] = [range?.[1] ?? TODAY, range?.[2] ?? TODAY];
      const attendance = url.includes("include_attendance=true");
      return wirePage({
        staff: STAFF.map((p) => ({ ...p, ...(attendance ? { workforce_status: "scheduled" } : {}) })),
        assignments: world.shifts.filter((s) => s.work_date >= from && s.work_date <= to).map((s) => ({ ...s, ...(attendance ? { workforce_status: "scheduled" } : {}) })),
        requested: attendance,
        verified: attendance,
        asOf: attendance ? new Date().toISOString() : null,
        dateFrom: from,
        dateTo: to,
      });
    }
    if (url.startsWith("/schedules/shifts") && url.includes("/usage")) return { data: { shift_id: "t1", ...world.usage, archived: false, version: 1 } };
    if (url.startsWith("/schedules/shifts")) return { data: world.templates };
    const detail = /^\/schedules\/assignments\/([^/]+)\/detail$/.exec(url);
    if (detail) return world.detail(detail[1]);
    throw new Error(`unexpected GET ${url}`);
  });
}

const ui = (Route: React.ComponentType<unknown> = TeamScheduleRoute as React.ComponentType<unknown>) => (
  <ThemeProvider>
    <Route />
  </ThemeProvider>
);
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};
async function open(params: Record<string, string> = {}, Route?: React.ComponentType<unknown>) {
  Object.assign(mockParams, params);
  const screen = render(ui(Route));
  await settle();
  await waitFor(() => {
    expect(screen.queryByTestId(Route ? "templates-screen" : "team-schedule")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-skeleton")).toBeNull();
  });
  return screen;
}
const press = async (screen: ReturnType<typeof render>, id: string) => {
  fireEvent.press(await screen.findByTestId(id));
  await settle();
};
/** All the text under a node, however deeply it is nested. */
const flip = async (screen: ReturnType<typeof render>, id: string, value: boolean) => {
  fireEvent(await screen.findByTestId(id), "valueChange", value);
  await settle();
};
const text = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  const children = (node as { children?: unknown } | null)?.children;
  return children === undefined ? "" : text(children);
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of [get, post, patch, del]) fn.mockReset();
  (router.push as jest.Mock).mockReset();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockLanguage = "en";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  world = freshWorld();
  serve();
  // The destructive choice in a native confirmation is pressed automatically.
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style === "destructive")?.onPress?.();
  });
});

/** Fills the Add Shift form: Ana on the Morning shift. */
async function fillAdd(screen: ReturnType<typeof render>, userId = "u1", templateId = "t1") {
  await press(screen, "shift-form-employee");
  await press(screen, `employee-picker-${userId}`);
  await press(screen, `shift-form-template-${templateId}`);
}
async function openAdd(screen: ReturnType<typeof render>) {
  await press(screen, "team-schedule-add-shift");
  await screen.findByTestId("shift-form");
}

describe("shift details", () => {
  it("opens from Today with the scheduled window, the last update and a timeline that says why it has no attendance", async () => {
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    expect(await screen.findByTestId("shift-detail-body")).toBeTruthy();
    await screen.findByTestId("shift-detail-timeline");
    expect(text(screen.getByTestId("shift-detail-window"))).toContain("7:00 AM");
    expect(screen.getByTestId("shift-detail-updated")).toBeTruthy();
    expect(text(screen.getByTestId("shift-detail-attendance-note"))).toBe(tr("teamSchedule.manage.timeline.note.future"));
    expect(text(screen.getByTestId("shift-detail-rooms"))).toBe(tr("teamSchedule.manage.detail.roomsCount", { count: 12 }));
  });

  it("shows only verified attendance events and never calls a missing clock-in an absence", async () => {
    world.detail = (id) => ({
      data: { assignment: { ...world.shifts.find((s) => s.id === id), updated_at: null }, department_code: "HK", attendance: { applicable: true, verified: true, sessions: [] }, rooms: { applicable: true, available: false, count: null }, editable: true },
    });
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    expect(text(screen.getByTestId("shift-detail-attendance-note"))).toBe(tr("teamSchedule.manage.timeline.note.none"));
    expect(screen.queryByTestId("shift-detail-event-started")).toBeNull();
    // Rooms that could not be read are not "0 rooms".
    expect(text(screen.getByTestId("shift-detail-rooms"))).toBe(tr("teamSchedule.manage.detail.roomsUnavailable"));
    expect(allStrings(screen).join(" ").toLowerCase()).not.toMatch(/\babsent\b(?! ?\.)|no.show/);
  });

  it("renders recorded sessions as started / break / ended", async () => {
    world.detail = (id) => ({
      data: {
        assignment: { ...world.shifts.find((s) => s.id === id) },
        department_code: "HK",
        attendance: { applicable: true, verified: true, sessions: [{ status: "ended", started_at: at(TODAY, 7, 5), ended_at: at(TODAY, 15, 2), on_break_since: null, break_seconds: 1800 }] },
        rooms: { applicable: false, available: false, count: null },
        editable: true,
      },
    });
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-event-started");
    expect(text(screen.getByTestId("shift-detail-event-started"))).toBe(tr("teamSchedule.manage.timeline.started", { time: "7:05 AM" }));
    expect(screen.getByTestId("shift-detail-event-break")).toBeTruthy();
    expect(screen.getByTestId("shift-detail-event-ended")).toBeTruthy();
    expect(screen.queryByTestId("shift-detail-rooms")).toBeNull(); // not a housekeeping department shift
  });

  it("opens from the Week on the tapped shift, and lets the supervisor switch between a person's shifts that day", async () => {
    const screen = await open({ view: "week", date: TOMORROW });
    await press(screen, "team-schedule-member-s4");
    await screen.findByTestId("team-schedule-detail-sheet");
    expect(screen.getByTestId("team-schedule-detail-shift-s3")).toBeTruthy();
    expect(screen.getByTestId("team-schedule-detail-shift-s4")).toBeTruthy();
    expect(text(screen.getByTestId("shift-detail-window"))).toContain("4:00 PM"); // s4 was tapped, so s4 is selected
    await press(screen, "team-schedule-detail-shift-s3");
    await waitFor(() => expect(text(screen.getByTestId("shift-detail-window"))).toContain("7:00 AM"));
  });

  it("explains why an action is unavailable instead of hiding the reason: past, recorded attendance, offline", async () => {
    world.detail = (id) => ({
      data: { assignment: { ...world.shifts.find((s) => s.id === id) }, department_code: "HK", attendance: { applicable: true, verified: true, sessions: [{ status: "active", started_at: at(TODAY, 7, 5), ended_at: null, on_break_since: null, break_seconds: 0 }] }, rooms: { applicable: false, available: false, count: null }, editable: true },
    });
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    expect(screen.getByTestId("shift-action-edit").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("shift-action-edit").props.accessibilityLabel).toContain(tr("teamSchedule.manage.detail.attendanceLocked"));
    expect(screen.getByTestId("shift-action-cancel").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("shift-action-edit"));
    expect(screen.queryByTestId("shift-form")).toBeNull();
  });
});

describe("Add shift", () => {
  it("saves a valid shift after the server validates it, then refreshes the schedule", async () => {
    post.mockImplementation(async (url: string) => {
      if (url.endsWith("/preview")) return { data: { ok: true, create_count: 1, unchanged_count: 0, warnings: [], blocking: null, items: [] } };
      world.shifts.push(row(TOMORROW, "new1", "u1"));
      return { data: row(TOMORROW, "new1", "u1"), meta: { created: true, warnings: [] } };
    });
    const screen = await open();
    const before = teamCalls();
    await openAdd(screen);
    expect(text(screen.getByTestId("shift-form-immediate"))).toBe(tr("teamSchedule.manage.form.immediate"));
    expect(allStrings(screen).join(" ").toLowerCase()).not.toMatch(/draft saved|employees (were )?notified/);
    await fillAdd(screen);
    await press(screen, "shift-form-save");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(tr("teamSchedule.manage.saved.created", { count: 1 })));
    expect(post.mock.calls.map(([url]) => url)).toEqual(["/schedules/assignments/preview", "/schedules/assignments"]);
    expect(post.mock.calls[1][1]).toEqual({ user_id: "u1", shift_id: "t1", work_date: TODAY });
    await waitFor(() => expect(teamCalls()).toBeGreaterThan(before));
    expect(screen.queryByTestId("shift-form")).toBeNull();
  });

  it("blocks an incomplete form with plain messages and sends nothing", async () => {
    const screen = await open();
    await openAdd(screen);
    await press(screen, "shift-form-save");
    expect(text(screen.getByTestId("shift-form-employee-error"))).toBe(tr("teamSchedule.manage.formError.employee"));
    expect(text(screen.getByTestId("shift-form-template-error"))).toBe(tr("teamSchedule.manage.formError.template"));
    expect(post).not.toHaveBeenCalled();
  });

  it("shows the server's blocking conflict and does not create anything", async () => {
    post.mockResolvedValue({ data: { ok: false, create_count: 0, unchanged_count: 0, warnings: [], items: [], blocking: { status: 409, code: "schedule_conflict", detail: "overlap", conflicts: [{ code: "overlapping_shift", user_id: "u1", work_date: TODAY, with_assignment_id: "s1" }] } } });
    const screen = await open();
    await openAdd(screen);
    await fillAdd(screen);
    await press(screen, "shift-form-save");
    expect(await screen.findByTestId("shift-failure")).toBeTruthy();
    expect(text(screen.getByTestId("shift-failure-conflicts"))).toContain("Overlaps on");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("/schedules/assignments/preview");
  });

  it("asks before saving a shift with warnings, then saves exactly what was reviewed", async () => {
    post.mockImplementation(async (url: string) =>
      url.endsWith("/preview")
        ? { data: { ok: true, create_count: 1, unchanged_count: 0, warnings: [{ code: "weekly_overtime", user_id: "u1", work_date: TODAY, detail: "41.0 scheduled hours", severity: "warn" }], blocking: null, items: [{ user_id: "u1", shift_id: "t1", work_date: TODAY, start_time: "07:00:00", end_time: "15:00:00", starts_at: at(TODAY, 7, 0), ends_at: at(TODAY, 15, 0), status: "new" }] } }
        : { data: row(TODAY, "n", "u1"), meta: { created: true, warnings: [{ code: "weekly_overtime" }] } },
    );
    const screen = await open();
    await openAdd(screen);
    await fillAdd(screen);
    await press(screen, "shift-form-save");
    expect(await screen.findByTestId("shift-review")).toBeTruthy();
    expect(text(screen.getByTestId("shift-warnings"))).toContain("Check before saving");
    expect(post).toHaveBeenCalledTimes(1); // nothing written yet
    expect(screen.getByTestId("shift-form-save").props.accessibilityLabel).toBe(tr("teamSchedule.manage.form.saveAnyway"));
    await press(screen, "shift-form-save");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][0]).toBe("/schedules/assignments");
  });

  it("is blocked while offline, and says why", async () => {
    const screen = await open();
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await settle();
    expect(screen.getByTestId("team-schedule-add-shift").props.accessibilityState.disabled).toBe(true);
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    expect(screen.getByTestId("shift-action-edit").props.accessibilityLabel).toContain(tr("teamSchedule.manage.offline"));
    expect(screen.getByTestId("shift-action-cancel").props.accessibilityState.disabled).toBe(true);
  });
});

describe("recurring shifts", () => {
  it("previews every date, then creates the whole series in ONE batch request", async () => {
    const items = [0, 7, 14].map((n) => ({ user_id: "u1", shift_id: "t1", work_date: addDaysToYmd(TODAY, n), start_time: "07:00:00", end_time: "15:00:00", starts_at: at(addDaysToYmd(TODAY, n), 7, 0), ends_at: at(addDaysToYmd(TODAY, n), 15, 0), status: "new" }));
    post.mockImplementation(async (url: string) =>
      url.endsWith("/preview") ? { data: { ok: true, create_count: 3, unchanged_count: 0, warnings: [], blocking: null, items } } : { data: { created_count: 3, updated_count: 0, unchanged_count: 0, warnings: [] } },
    );
    const screen = await open();
    await openAdd(screen);
    await fillAdd(screen);
    // Turning it on selects today's weekday; the series runs 28 days, so 4 matching dates.
    await flip(screen, "shift-form-recurring", true);
    await press(screen, "shift-form-save");
    expect(await screen.findByTestId("shift-review")).toBeTruthy();
    const previewBody = post.mock.calls[0][1].assignments as { work_date: string }[];
    expect(previewBody).toHaveLength(4);
    expect(new Set(previewBody.map((i) => i.work_date)).size).toBe(4);
    expect(text(screen.getByTestId("shift-review"))).toContain("3 shifts");
    await press(screen, "shift-form-save");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(tr("teamSchedule.manage.saved.created", { count: 3 })));
    const writes = post.mock.calls.filter(([url]) => !String(url).endsWith("/preview"));
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("/schedules/assignments/bulk");
    expect(writes[0][1].assignments).toHaveLength(4);
  });

  it("saves nothing when the server refuses any occurrence", async () => {
    post.mockResolvedValue({ data: { ok: false, create_count: 0, unchanged_count: 0, warnings: [], items: [], blocking: { status: 409, code: "schedule_conflict", detail: "overlap", conflicts: [{ code: "overlapping_shift", user_id: "u1", work_date: addDaysToYmd(TODAY, 7) }] } } });
    const screen = await open();
    await openAdd(screen);
    await fillAdd(screen);
    await flip(screen, "shift-form-recurring", true);
    await press(screen, "shift-form-save");
    expect(await screen.findByTestId("shift-failure")).toBeTruthy();
    expect((post.mock.calls[0][1].assignments as unknown[]).length).toBe(4);
    expect(post.mock.calls.every(([url]) => String(url).endsWith("/preview"))).toBe(true);
  });
});

describe("retrying an uncertain save", () => {
  it("repeats the same create after a lost answer, which the server treats as already scheduled, never as a second shift", async () => {
    let attempt = 0;
    post.mockImplementation(async (url: string) => {
      if (url.endsWith("/preview")) return { data: { ok: true, create_count: 1, unchanged_count: 0, warnings: [], blocking: null, items: [] } };
      attempt += 1;
      if (attempt === 1) throw new Error("Network request failed");
      return { data: row(TODAY, "n", "u1"), meta: { created: false, warnings: [] } };
    });
    const screen = await open();
    await openAdd(screen);
    await fillAdd(screen);
    await press(screen, "shift-form-save");
    const failure = await screen.findByTestId("shift-failure");
    expect(failure).toBeTruthy();
    expect(allStrings(screen).join(" ")).toContain(tr("teamSchedule.manage.failure.unconfirmed.title"));
    expect(screen.getByTestId("shift-form-save").props.accessibilityLabel).toBe(tr("teamSchedule.manage.form.checkAndRetry"));
    await press(screen, "shift-form-save");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(tr("teamSchedule.manage.saved.alreadyThere")));
    const writes = post.mock.calls.filter(([url]) => url === "/schedules/assignments");
    expect(writes).toHaveLength(2);
    expect(writes[1][1]).toEqual(writes[0][1]); // the identical request, so the server cannot create two
  });
});

describe("editing", () => {
  const openEdit = async (id = "s1", userId = "u1") => {
    const screen = await open();
    await press(screen, `team-schedule-person-${userId}`);
    await screen.findByTestId("shift-detail-timeline");
    await press(screen, "shift-action-edit");
    await screen.findByTestId("shift-form");
    expect(id).toBeTruthy();
    return screen;
  };

  it("sends only what changed with the version it read, and refreshes", async () => {
    patch.mockResolvedValue({ data: row(TODAY, "s1", "u1", { notes: "Deep clean", version: 2 }), meta: { warnings: [] } });
    const screen = await openEdit();
    fireEvent.changeText(screen.getByTestId("shift-form-notes"), "Deep clean");
    const before = teamCalls();
    await press(screen, "shift-form-save");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(tr("teamSchedule.manage.saved.updated")));
    expect(patch).toHaveBeenCalledWith("/schedules/assignments/s1", { expected_version: 1, notes: "Deep clean" });
    await waitFor(() => expect(teamCalls()).toBeGreaterThan(before));
  });

  it("does not overwrite a change someone else made: explains it, loads the latest, and needs a new explicit save", async () => {
    const theirs = row(TODAY, "s1", "u1", { notes: "theirs", start_time: "08:00:00", starts_at: at(TODAY, 8, 0), version: 2 });
    patch.mockRejectedValueOnce(Object.assign(new Error("changed"), { status: 409, code: "version_conflict", body: { code: "version_conflict", current: theirs } }));
    patch.mockResolvedValueOnce({ data: { ...theirs, notes: "mine on top", version: 3 }, meta: { warnings: [] } });
    const screen = await openEdit();
    fireEvent.changeText(screen.getByTestId("shift-form-notes"), "mine");
    await press(screen, "shift-form-save");
    expect(await screen.findByTestId("shift-version-conflict")).toBeTruthy();
    expect(text(screen.getByTestId("shift-version-conflict-fields"))).toContain("start time");
    expect(screen.getByTestId("shift-form-save").props.accessibilityState.disabled).toBe(true); // no blind second save
    expect(patch).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("shift-version-conflict-reload"));
    await settle();
    await waitFor(() => expect(screen.queryByTestId("shift-version-conflict")).toBeNull());
    expect(screen.getByTestId("shift-form-notes").props.value).toBe("theirs"); // the latest, not what I typed
    fireEvent.changeText(screen.getByTestId("shift-form-notes"), "mine on top");
    await press(screen, "shift-form-save");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(patch).toHaveBeenLastCalledWith("/schedules/assignments/s1", { expected_version: 2, notes: "mine on top" });
  });

  it("recognises that its own earlier save landed when the answer was lost", async () => {
    patch.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = await openEdit();
    fireEvent.changeText(screen.getByTestId("shift-form-notes"), "Deep clean");
    // The first attempt committed on the server before the answer was lost.
    world.shifts[0] = row(TODAY, "s1", "u1", { notes: "Deep clean", version: 2 });
    await press(screen, "shift-form-save");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(tr("teamSchedule.manage.saved.alreadySaved")));
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("reassigns to another employee through the same guarded edit", async () => {
    patch.mockResolvedValue({ data: row(TODAY, "s1", "u2", { version: 2 }), meta: { warnings: [] } });
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    await press(screen, "shift-action-reassign");
    await press(screen, "employee-picker-u2");
    await press(screen, "shift-form-save");
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/schedules/assignments/s1", { expected_version: 1, user_id: "u2" }));
  });

  it("copies a shift into a new one on the following day without touching the original", async () => {
    post.mockImplementation(async (url: string) => (url.endsWith("/preview") ? { data: { ok: true, create_count: 1, unchanged_count: 0, warnings: [], blocking: null, items: [] } } : { data: row(TOMORROW, "c1", "u1"), meta: { created: true, warnings: [] } }));
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    await press(screen, "shift-action-copy");
    await screen.findByTestId("shift-form");
    await press(screen, "shift-form-save");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ user_id: "u1", shift_id: "t1", work_date: TOMORROW });
    expect(patch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe("cancelling a shift", () => {
  it("asks first, says what will change, and removes it with the version it saw", async () => {
    del.mockResolvedValue({ data: { success: true, deleted_id: "s1" } });
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    const before = teamCalls();
    await press(screen, "shift-action-cancel");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe(tr("teamSchedule.manage.cancel.title"));
    expect(alertSpy.mock.calls[0][1]).toContain("Ana Torres");
    expect(alertSpy.mock.calls[0][1]).toContain("not notified");
    await waitFor(() => expect(del).toHaveBeenCalledWith("/schedules/assignments/s1?expected_version=1"));
    await waitFor(() => expect(teamCalls()).toBeGreaterThan(before));
  });

  it("keeps the shift and says so when it changed first", async () => {
    del.mockRejectedValue(Object.assign(new Error("changed"), { status: 409, code: "version_conflict", body: { code: "version_conflict" } }));
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    await press(screen, "shift-action-cancel");
    expect(text(await screen.findByTestId("shift-detail-notice"))).toBe(tr("teamSchedule.manage.cancel.changed"));
    expect(screen.getByTestId("team-schedule-detail-sheet")).toBeTruthy();
  });

  it("treats a shift that is already gone as cancelled", async () => {
    del.mockRejectedValue(Object.assign(new Error("gone"), { status: 404, code: "assignment_not_found", body: { code: "assignment_not_found" } }));
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await screen.findByTestId("shift-detail-timeline");
    await press(screen, "shift-action-cancel");
    await waitFor(() => expect(screen.queryByTestId("team-schedule-detail-sheet")).toBeNull());
  });
});

describe("integration with the existing schedule", () => {
  it("keeps the selected day and the view when a sheet opens and closes", async () => {
    const screen = await open({ view: "week", date: TOMORROW });
    await press(screen, "team-schedule-member-s3");
    await screen.findByTestId("team-schedule-detail-sheet");
    await press(screen, "team-schedule-detail-close");
    await waitFor(() => expect(screen.queryByTestId("team-schedule-detail-sheet")).toBeNull());
    expect(screen.getByTestId("team-schedule-group-" + "420|900|morning")).toBeTruthy();
  });

  it("opens Assignments with the person's id", async () => {
    const screen = await open();
    await press(screen, "team-schedule-person-u1");
    await press(screen, "team-schedule-detail-assignments");
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assignments", params: { staffId: "u1" } });
  });

  it("works in Spanish", async () => {
    mockLanguage = "es";
    const screen = await open();
    await openAdd(screen);
    expect(allStrings(screen).join(" ")).toContain("Al guardar, el horario cambia de inmediato");
  });
});

describe("shift templates", () => {
  const openTemplates = () => open({}, TemplatesRoute as React.ComponentType<unknown>);

  it("lists the hotel's real templates with their times, and a way to create and edit", async () => {
    const screen = await openTemplates();
    await screen.findByTestId("template-t1");
    expect(screen.getByTestId("template-t2")).toBeTruthy();
    expect(allStrings(screen).join(" ")).toContain("Overnight");
    expect(screen.getByTestId("templates-new")).toBeTruthy();
    expect(screen.getByTestId("template-edit-t1")).toBeTruthy();
  });

  it("says so when there are none, and when they cannot be loaded", async () => {
    world.templates = [];
    const empty = await openTemplates();
    expect(await empty.findByTestId("templates-empty")).toBeTruthy();
    empty.unmount();
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/schedules/team")) return wirePage({ staff: STAFF, assignments: [] });
      throw Object.assign(new Error("server"), { status: 500 });
    });
    const failed = await openTemplates();
    expect(await failed.findByTestId("templates-error")).toBeTruthy();
  });

  it("creates a template for the supervisor's department", async () => {
    post.mockResolvedValue({ data: { id: "t9", name: "Deep Clean", department_id: "d1", start_time: "09:00:00", end_time: "17:00:00", is_active: true, version: 1 } });
    const screen = await openTemplates();
    await press(screen, "templates-new");
    await screen.findByTestId("template-form");
    fireEvent.changeText(screen.getByTestId("template-form-name"), "Deep Clean");
    fireEvent.changeText(screen.getByTestId("template-form-start"), "9:00 AM");
    fireEvent.changeText(screen.getByTestId("template-form-end"), "5pm");
    await press(screen, "template-form-save");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/shifts", { name: "Deep Clean", department_id: "d1", start_time: "09:00", end_time: "17:00" }));
  });

  it("validates before sending", async () => {
    const screen = await openTemplates();
    await press(screen, "templates-new");
    await press(screen, "template-form-save");
    expect(await screen.findByTestId("template-form-name-error")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("edits a template and tells the supervisor that scheduled shifts will not change", async () => {
    patch.mockResolvedValue({ data: { ...TEMPLATES[0], name: "Early", version: 2 } });
    const screen = await openTemplates();
    await press(screen, "template-edit-t1");
    expect(text(await screen.findByTestId("template-form-only-new"))).toBe(tr("teamSchedule.manage.templates.onlyNew"));
    await waitFor(() => expect(text(screen.getByTestId("template-form-usage"))).toBe(tr("teamSchedule.manage.templates.usage", { upcoming: 5, past: 40 })));
    fireEvent.changeText(screen.getByTestId("template-form-name"), "Early");
    await press(screen, "template-form-save");
    await waitFor(() => expect(patch).toHaveBeenCalledWith("/schedules/shifts/t1", { expected_version: 1, name: "Early", start_time: "07:00", end_time: "15:00", is_active: true }));
  });

  it("archives (never deletes) after warning how many shifts use it", async () => {
    del.mockRejectedValue(new SyntaxError("Unexpected end of JSON input")); // the server's 204 has no body
    const screen = await openTemplates();
    await press(screen, "template-edit-t1");
    await waitFor(() => expect(text(screen.getByTestId("template-form-usage"))).toContain("5 upcoming"));
    await press(screen, "template-form-archive");
    expect(alertSpy.mock.calls[0][1]).toBe(tr("teamSchedule.manage.templates.archiveMessage", { upcoming: 5, past: 40 }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/schedules/shifts/t1"));
    await waitFor(() => expect(screen.queryByTestId("template-form")).toBeNull());
  });
});
