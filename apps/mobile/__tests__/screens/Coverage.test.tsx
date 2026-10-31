import React from "react";
import type { ReactTestInstance } from "react-test-renderer";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

/* The REAL call-out drawer, Find Coverage, Open Shifts and the Team Schedule that hosts them. Only the network, the
   router, the translator, the app store and the icon font are doubled. The server doubled here is the Phase 4
   coverage API (routers/scheduling_absences.py + scheduling_coverage.py). */

const mockParams: Record<string, string | undefined> = {};

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ ...mockParams }),
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("@/lib/navigation/openSupervisorHref", () => ({ openSupervisorHref: jest.fn() }));

const mockAppState: { isOnline: boolean; hotelTimezone: string; user: { id: string; role: string; tenant_id: string } | null } = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import { FindCoverageScreen } from "@/components/scheduling/FindCoverageScreen";
import { OpenShiftsScreen } from "@/components/scheduling/OpenShiftsScreen";
import TeamScheduleRoute from "@/app/(app)/team-schedule/index";
import { api } from "@/lib/api/client";
import { hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { allStrings } from "../helpers/workspaceHarness";
import { wireCandidate, wireGap, wireImpact } from "../helpers/coverageFixtures";
import { wirePage, wirePerson, wireShift, ZONE } from "../helpers/teamScheduleFixtures";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const TODAY = hotelDateKey(new Date(), ZONE) as string;

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const wrap = (node: React.ReactNode) => <ThemeProvider>{node}</ThemeProvider>;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
/** The words inside a node, however deeply nested (a testID often sits on a View that holds the Text). */
const text = (node: ReactTestInstance) =>
  node
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => [n.props.children].flat(2).filter((part) => typeof part === "string" || typeof part === "number").join(""))
    .join(" ")
    .trim();
const apiError = (status: number, code: string, message = "refused") => Object.assign(new Error(message), { status, code, body: { code } });

let world: { gap: Record<string, unknown>; candidates: unknown[]; gaps: unknown[]; filled: unknown[]; gapsFail: boolean };

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReset();
  post.mockReset();
  mockAppState.isOnline = true;
  Object.keys(mockParams).forEach((key) => delete mockParams[key]);
  world = {
    gap: wireGap({ version: 3 }),
    candidates: [wireCandidate("u2", "Bea Cruz"), wireCandidate("u3", "Cy Diaz", { eligible: false, blockers: ["overlapping_shift"], warnings: [], reasons: [] })],
    gaps: [],
    filled: [],
    gapsFail: false,
  };
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/schedules/gaps/g1/candidates")) return { data: world.candidates, meta: { gap_version: world.gap.version, eligible: 1 } };
    if (url.startsWith("/schedules/gaps/g1/history")) return { data: [{ id: "e1", resource_type: "absence", action: "confirmed", at: "2030-01-08T10:00:00Z", actor_name: "Sam Wu", reason: null }] };
    if (url.startsWith("/schedules/gaps/g1")) return { data: world.gap };
    if (url.startsWith("/schedules/gaps")) {
      if (world.gapsFail) throw Object.assign(new Error("down"), { status: 500 });
      return { data: url.includes("status=filled") ? world.filled : world.gaps };
    }
    if (url.startsWith("/schedules/shifts")) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
});

/* ─── Find Coverage ───────────────────────────────────────────────────────── */

describe("Find Coverage", () => {
  const open = async () => {
    const screen = render(wrap(<FindCoverageScreen gapId="g1" />));
    await settle();
    await waitFor(() => expect(screen.getByTestId("find-coverage-header")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("candidate-u2")).toBeTruthy());
    return screen;
  };

  it("shows the shift, who is out and explained candidates, never 'available'", async () => {
    const screen = await open();
    expect(text(screen.getByTestId("find-coverage-status"))).toBe("Open");
    expect(text(screen.getByTestId("find-coverage-absent"))).toContain("Ana Torres");
    expect(text(screen.getByTestId("candidate-summary-u2"))).toBe(tr("teamSchedule.coverage.summary.eligible"));
    expect(text(screen.getByTestId("candidate-summary-u3"))).toBe(tr("teamSchedule.coverage.flag.overlapping_shift"));
    expect(screen.getByTestId("candidate-u3").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("candidate-u2").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId("find-coverage-availability-note")).toBeTruthy();
    const everything = allStrings(screen).join(" ").toLowerCase();
    expect(everything).not.toMatch(/\bis available\b|\bavailable to work\b/);
  });

  it("creates an offer with the version it read, and says the employee was not notified", async () => {
    const screen = await open();
    post.mockResolvedValue({ data: wireGap({ status: "offered", version: 4, pending_offer_count: 1, offers: [{ id: "o1", user_id: "u2", user_name: "Bea Cruz", status: "pending", delivery: "not_sent", expires_at: "2030-01-08T16:00:00Z" }] }), meta: { delivered: false } });
    fireEvent.press(screen.getByTestId("candidate-u2"));
    await screen.findByTestId("offer-sheet");
    fireEvent.press(screen.getByTestId("offer-create"));
    await settle();
    await screen.findByTestId("offer-not-delivered");
    expect(post).toHaveBeenCalledWith("/schedules/gaps/g1/offers", { user_id: "u2", expected_version: 3 });
    expect(text(screen.getByTestId("offer-not-delivered"))).toMatch(/not scheduled yet and has not been notified/);
    fireEvent.press(screen.getByTestId("offer-done"));
    await waitFor(() => expect(screen.queryByTestId("offer-sheet")).toBeNull());
    expect(text(screen.getByTestId("find-coverage-status"))).toBe("Offered");
    expect(screen.getByTestId("find-coverage-offer-o1")).toBeTruthy();
    expect(screen.queryByTestId("find-coverage-filled")).toBeNull();   // an offer is not coverage
  });

  it("makes the supervisor acknowledge warnings before assigning, then shows the gap as covered", async () => {
    world.candidates = [wireCandidate("u2", "Bea Cruz", { warnings: ["insufficient_rest", "availability_unknown"] })];
    const screen = await open();
    fireEvent.press(screen.getByTestId("candidate-u2"));
    await screen.findByTestId("offer-sheet");
    expect(screen.getByTestId("offer-warning-insufficient_rest")).toBeTruthy();
    expect(screen.getByTestId("offer-assign").props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("offer-assign"));
    expect(post).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("offer-acknowledge"));
    post.mockResolvedValue({ data: wireGap({ status: "filled", version: 4, filled_user_id: "u2", filled_user_name: "Bea Cruz" }) });
    fireEvent.press(screen.getByTestId("offer-assign"));
    await settle();
    await waitFor(() => expect(screen.queryByTestId("offer-sheet")).toBeNull());
    expect(post).toHaveBeenCalledWith("/schedules/gaps/g1/assign", { user_id: "u2", expected_version: 3, acknowledge_warnings: true });
    expect(text(screen.getByTestId("find-coverage-filled"))).toBe("Covered by Bea Cruz");
    expect(screen.getByTestId("find-coverage-rooms-separate")).toBeTruthy();
    expect(screen.queryByTestId("candidate-u2")).toBeNull();
  });

  it("explains a lost race, reloads, and does not show the shift as covered", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("candidate-u2"));
    await screen.findByTestId("offer-sheet");
    world.gap = wireGap({ status: "filled", version: 4, filled_user_id: "u9", filled_user_name: "Dee Fox" });
    post.mockRejectedValue(apiError(409, "gap_not_fillable"));
    const reads = get.mock.calls.length;
    fireEvent.press(screen.getByTestId("offer-assign"));
    await settle();
    await waitFor(() => expect(screen.queryByTestId("offer-sheet")).toBeNull());
    expect(get.mock.calls.length).toBeGreaterThan(reads);
    expect(text(screen.getByTestId("find-coverage-filled"))).toBe("Covered by Dee Fox");
  });

  it("is read-only offline", async () => {
    const screen = await open();
    mockAppState.isOnline = false;
    screen.rerender(wrap(<FindCoverageScreen gapId="g1" />));
    expect(screen.getByTestId("find-coverage-offline")).toBeTruthy();
    expect(screen.getByTestId("candidate-u2").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("find-coverage-waive").props.accessibilityState?.disabled).toBe(true);
  });

  it("records a phone acceptance, withdraws an offer and approves a claim only through the server", async () => {
    world.gap = wireGap({
      status: "offered", version: 5, pending_offer_count: 1, pending_claim_count: 1,
      offers: [{ id: "o1", user_id: "u2", user_name: "Bea Cruz", status: "pending", delivery: "not_sent" }],
      claims: [{ id: "c1", user_id: "u4", user_name: "Dee Fox", status: "pending" }],
    });
    const screen = await open();
    post.mockResolvedValue({ data: wireGap({ status: "filled", version: 6, filled_user_id: "u2", filled_user_name: "Bea Cruz" }) });
    fireEvent.press(screen.getByTestId("offer-accepted-o1"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/offers/o1/respond", { accept: true }));
    fireEvent.press(screen.getByTestId("claim-approve-c1"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/claims/c1/approve", { expected_version: 5, acknowledge_warnings: true }));
  });

  it("reviews rooms in Assignments for the person who is out, and keeps a waived reason on screen", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("find-coverage-review-rooms"));
    expect(openSupervisorHref).toHaveBeenCalledWith({ pathname: "/(app)/assignments", params: { staffId: "u1" } });
    fireEvent.press(screen.getByTestId("find-coverage-waive"));
    await screen.findByTestId("waive-sheet");
    expect(screen.getByTestId("waive-confirm").props.accessibilityState?.disabled).toBe(true);   // a reason is required
    fireEvent.changeText(screen.getByTestId("waive-reason"), "Low occupancy");
    post.mockResolvedValue({ data: wireGap({ status: "waived", version: 4, resolution_reason: "Low occupancy" }) });
    fireEvent.press(screen.getByTestId("waive-confirm"));
    await settle();
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/gaps/g1/waive", { expected_version: 3, reason: "Low occupancy" }));
    await waitFor(() => expect(screen.queryByTestId("waive-sheet")).toBeNull());
    expect(text(screen.getByTestId("find-coverage-status"))).toBe("Not covered");
  });

  it("says when the shift is gone", async () => {
    get.mockImplementation(async () => { throw apiError(404, "gap_not_found"); });
    const screen = render(wrap(<FindCoverageScreen gapId="g1" />));
    await settle();
    await screen.findByTestId("find-coverage-gone");
  });
});

/* ─── Open Shifts ─────────────────────────────────────────────────────────── */

describe("Open Shifts", () => {
  const open = async () => {
    const screen = render(wrap(<OpenShiftsScreen initialDate={null} />));
    await settle();
    return screen;
  };

  it("lists the shifts that still need a person, with the call-out behind each", async () => {
    world.gaps = [wireGap(), wireGap({ id: "g2", source: "open_shift", absence_id: null, absent_user_id: null, absent_user_name: null, absence_kind: null, shift_name: "Evening", pending_offer_count: 2 })];
    const screen = await open();
    await screen.findByTestId("open-shift-g1");
    expect(screen.getByTestId("open-shift-g2")).toBeTruthy();
    expect(allStrings(screen).join(" ")).toContain("Pending offers: 2");
    fireEvent.press(screen.getByTestId("open-shift-find-g1"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/team-schedule/coverage", params: { gapId: "g1" } });
    fireEvent.press(screen.getByTestId("open-shifts-filter-open"));
    await waitFor(() => expect(screen.queryByTestId("open-shift-g1")).toBeNull());
    expect(screen.getByTestId("open-shift-g2")).toBeTruthy();
  });

  it("says coverage could not be loaded instead of 'nothing needs cover'", async () => {
    world.gapsFail = true;
    const screen = await open();
    await screen.findByTestId("open-shifts-failed");
    expect(screen.queryByTestId("open-shifts-empty")).toBeNull();
  });

  it("says so when nothing needs cover", async () => {
    const screen = await open();
    await screen.findByTestId("open-shifts-empty");
  });

  it("does not read coverage while offline and says why", async () => {
    mockAppState.isOnline = false;
    const screen = await open();
    expect(screen.getByTestId("open-shifts-offline-empty")).toBeTruthy();
    expect(get.mock.calls.filter(([url]) => String(url).startsWith("/schedules/gaps"))).toHaveLength(0);
  });

  it("posts an open shift for a chosen template and day, supervisor-managed (not claimable)", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/schedules/shifts")) return { data: [{ id: "sh1", name: "Morning", department_id: "d1", start_time: "07:00:00", end_time: "15:00:00", is_active: true, archived_at: null, version: 1 }] };
      return { data: [] };
    });
    const screen = await open();
    fireEvent.press(await screen.findByTestId("open-shifts-post"));
    await screen.findByTestId("post-open-sheet");
    expect(screen.getByTestId("post-open-confirm").props.accessibilityState?.disabled).toBe(true);   // no template yet
    fireEvent.press(await screen.findByTestId("post-open-template-sh1"));
    post.mockResolvedValue({ data: wireGap({ id: "g9", source: "open_shift", absence_id: null }) });
    fireEvent.press(screen.getByTestId("post-open-confirm"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/open-shifts", expect.objectContaining({ shift_id: "sh1", work_date: TODAY, claimable: false, idempotency_key: expect.stringMatching(/^open-/) })));
    await screen.findByTestId("open-shifts-notice");
  });
});

/* ─── The Team Schedule hosting them ─────────────────────────────────────── */

describe("Team Schedule integration", () => {
  const at = (h: number, m: number) => (zonedTimeToInstant(TODAY, h, m, ZONE) as Date).toISOString();
  const STAFF = [wirePerson("u1", "Ana Torres"), wirePerson("u2", "Ben Ruiz")];

  const serveSchedule = () => {
    const base = get.getMockImplementation() as (url: string) => Promise<unknown>;
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/schedules/team")) {
        const attendance = url.includes("include_attendance=true");
        const statuses: Record<string, string> = { u1: "working", u2: "not_clocked_in" };
        return wirePage({
          staff: STAFF.map((p) => (attendance ? { ...p, workforce_status: statuses[p.user_id as string] } : p)),
          assignments: ["u1", "u2"].map((u, i) => wireShift({ id: `t${i + 1}`, user_id: u, work_date: TODAY, shift_name: "Day", start_time: "00:00:00", end_time: "23:59:00", starts_at: at(0, 0), ends_at: at(23, 59), ...(attendance ? { workforce_status: statuses[u] } : {}) })),
          requested: attendance, verified: attendance, asOf: attendance ? new Date().toISOString() : null, dateFrom: TODAY, dateTo: TODAY,
        });
      }
      return base(url);
    });
  };

  const openSchedule = async () => {
    const screen = render(wrap(<TeamScheduleRoute />));
    await settle();
    await waitFor(() => expect(screen.queryByTestId("team-schedule-skeleton")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("team-schedule-person-u2")).toBeTruthy());
    return screen;
  };

  it("shows uncovered shifts for the day, a count of open shifts and a way into Find Coverage", async () => {
    world.gaps = [wireGap({ work_date: TODAY })];
    serveSchedule();
    const screen = await openSchedule();
    await screen.findByTestId("team-schedule-gap-g1");
    expect(screen.getByTestId("team-schedule-open-shifts")).toBeTruthy();
    expect(allStrings(screen).join(" ")).toContain("Open shifts (1)");
    fireEvent.press(screen.getByTestId("team-schedule-gap-g1"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/team-schedule/coverage", params: { gapId: "g1" } });
  });

  it("says coverage could not be loaded when it could not be, without hiding the schedule", async () => {
    world.gapsFail = true;
    serveSchedule();
    const screen = await openSchedule();
    await screen.findByTestId("team-schedule-coverage-failed");
    expect(screen.getByTestId("team-schedule-person-u2")).toBeTruthy();
  });

  it("records a call-out from a shift, shows the verified impact and offers Find replacement", async () => {
    serveSchedule();
    const screen = await openSchedule();
    fireEvent.press(screen.getByTestId("team-schedule-person-u2"));
    await screen.findByTestId("team-schedule-detail-sheet");
    fireEvent.press(screen.getByTestId("shift-action-call-out"));
    await screen.findByTestId("call-out-sheet");
    expect(text(screen.getByTestId("call-out-attendance"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("call-out-kind-emergency"));
    fireEvent.changeText(screen.getByTestId("call-out-note"), "Phoned in");
    post.mockResolvedValue({ data: { absence: { id: "ab1" }, gap: wireGap({ work_date: TODAY, original_assignment_id: "t2", absent_user_id: "u2", absent_user_name: "Ben Ruiz" }), impact: wireImpact(), replayed: false } });
    fireEvent.press(screen.getByTestId("call-out-confirm"));
    await settle();
    await screen.findByTestId("call-out-done");
    expect(post).toHaveBeenCalledWith("/schedules/absences", expect.objectContaining({ assignment_id: "t2", expected_version: 1, kind: "emergency", note: "Phoned in", idempotency_key: expect.stringMatching(/^callout-/) }));
    expect(text(screen.getByTestId("call-out-impact-rooms"))).toBe("9 of 12 assigned rooms are not finished.");
    expect(screen.getByTestId("call-out-rooms-stay")).toBeTruthy();
    fireEvent.press(screen.getByTestId("call-out-review-rooms"));
    expect(openSupervisorHref).toHaveBeenCalledWith({ pathname: "/(app)/assignments", params: { staffId: "u2" } });
  });

  it("says the impact cannot be assessed when the workload could not be read", async () => {
    serveSchedule();
    const screen = await openSchedule();
    fireEvent.press(screen.getByTestId("team-schedule-person-u2"));
    await screen.findByTestId("team-schedule-detail-sheet");
    fireEvent.press(screen.getByTestId("shift-action-call-out"));
    await screen.findByTestId("call-out-sheet");
    post.mockResolvedValue({ data: { absence: { id: "ab1" }, gap: wireGap({ work_date: TODAY }), impact: { verified: false, reason: "workload_unavailable", minutes_left_in_shift: 30 }, replayed: false } });
    fireEvent.press(screen.getByTestId("call-out-confirm"));
    await screen.findByTestId("call-out-impact-unassessed");
    expect(screen.queryByTestId("call-out-impact")).toBeNull();
    expect(screen.queryByTestId("call-out-review-rooms")).toBeNull();
    fireEvent.press(screen.getByTestId("call-out-find-replacement"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/team-schedule/coverage", params: { gapId: "g1" } });
  });

  it("shows a duplicate call-out as a plain refusal, keeps the form, and does not claim success", async () => {
    serveSchedule();
    const screen = await openSchedule();
    fireEvent.press(screen.getByTestId("team-schedule-person-u2"));
    await screen.findByTestId("team-schedule-detail-sheet");
    fireEvent.press(screen.getByTestId("shift-action-call-out"));
    await screen.findByTestId("call-out-sheet");
    post.mockRejectedValue(apiError(409, "duplicate_absence"));
    fireEvent.press(screen.getByTestId("call-out-confirm"));
    await settle();
    await screen.findByTestId("call-out-failure");
    expect(text(screen.getByTestId("call-out-failure"))).toBe(tr("teamSchedule.coverage.failure.duplicate_absence"));
    expect(screen.queryByTestId("call-out-done")).toBeNull();
  });

  it("checks the time for an early departure before sending anything", async () => {
    serveSchedule();
    const screen = await openSchedule();
    fireEvent.press(screen.getByTestId("team-schedule-person-u2"));
    await screen.findByTestId("team-schedule-detail-sheet");
    fireEvent.press(screen.getByTestId("shift-action-call-out"));
    await screen.findByTestId("call-out-sheet");
    fireEvent.press(screen.getByTestId("call-out-kind-leaving_early"));
    fireEvent.changeText(screen.getByTestId("call-out-leaving"), "banana");
    fireEvent.press(screen.getByTestId("call-out-confirm"));
    await waitFor(() => expect(allStrings(screen).join(" ")).toContain(tr("teamSchedule.coverage.callOut.leavingInvalid")));
    expect(post).not.toHaveBeenCalled();
  });
});
