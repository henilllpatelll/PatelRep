import fs from "fs";
import path from "path";
import { parseTeamScheduleParams, teamScheduleParams } from "@/lib/navigation/teamScheduleLink";
import { HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import { SUPERVISOR_ROUTES, isSupervisorSafePath, supervisorHref, teamScheduleHref } from "@/lib/navigation/supervisorRoutes";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { makeTranslator } from "../helpers/i18n";
import { attentionBody, attentionTitle, personA11y, roleLabel, sinceText, STATUS_PRESENTATION, statusLabel, windowText } from "@/lib/scheduling/teamScheduleText";
import { buildDayRoster, type AttentionKind, type DisplayStatus } from "@/lib/scheduling/teamScheduleModel";
import { CTX, TODAY, person, schedule, shift } from "../helpers/teamScheduleFixtures";

describe("deep link contract", () => {
  it("defaults to today with no params", () => {
    expect(parseTeamScheduleParams({})).toEqual({ view: "today", date: null, userId: null, compose: null });
    expect(parseTeamScheduleParams(null)).toEqual({ view: "today", date: null, userId: null, compose: null });
  });

  it("reads view, date and person; arrays take their first value", () => {
    expect(parseTeamScheduleParams({ view: "week", date: "2026-11-02", userId: "abc-123" })).toEqual({ view: "week", date: "2026-11-02", userId: "abc-123", compose: null });
    expect(parseTeamScheduleParams({ view: ["week"], date: ["2026-11-02"] })).toMatchObject({ view: "week", date: "2026-11-02" });
  });

  it.each([{ view: "month" }, { date: "2026-02-30" }, { date: "tomorrow" }, { userId: "../../etc" }, { userId: "a b" }, { userId: "x".repeat(65) }])("drops malformed params %j instead of guessing", (raw) => {
    expect(parseTeamScheduleParams(raw)).toEqual({ view: "today", date: null, userId: null, compose: null });
  });

  it("round-trips an intent into route params", () => {
    expect(teamScheduleParams({ view: "week", date: "2026-11-02", userId: "u1" })).toEqual({ view: "week", date: "2026-11-02", userId: "u1" });
    expect(teamScheduleParams({ view: "today" })).toEqual({});
    expect(teamScheduleParams({ date: "nope", userId: "bad id" })).toEqual({});
  });
});

describe("routes and navigation", () => {
  it("registers the Team Schedule as a supervisor-safe secondary route backed by a real screen file", () => {
    expect(SUPERVISOR_ROUTES.schedule.pathname).toBe("/(app)/team-schedule");
    expect(isSupervisorSafePath("/(app)/team-schedule")).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "..", "..", "app", "(app)", SUPERVISOR_ROUTES.schedule.screenFile))).toBe(true);
    expect(supervisorHref({ screen: "schedule" })).toEqual({ pathname: "/(app)/team-schedule" });
    expect(teamScheduleHref({ view: "week", userId: "u1" })).toEqual({ pathname: "/(app)/team-schedule", params: { view: "week", userId: "u1" } });
  });

  it("keeps it OUT of the bottom tab bar: the supervisor still has exactly the five existing tabs", () => {
    const tabs = getTabsForRole("housekeeping_supervisor");
    expect(tabs.map((tab) => tab.key)).toEqual(["home", "board", "assignments", "inspect", "me"]);
    expect(tabs.some((tab) => tab.name.includes("team-schedule"))).toBe(false);
    expect(HIDDEN_APP_ROUTES).toContain("team-schedule/index");
  });

  it("leaves the personal My Schedule route alone", () => {
    expect(HIDDEN_APP_ROUTES).toContain("scheduling/index");
    expect(SUPERVISOR_ROUTES.schedule.pathname).not.toBe("/(app)/scheduling");
    expect(fs.existsSync(path.join(__dirname, "..", "..", "app", "(app)", "scheduling", "index.tsx"))).toBe(true);
  });

  it("is reachable only by the housekeeping supervisor", () => {
    expect(canViewTeamSchedule("housekeeping_supervisor")).toBe(true);
    for (const role of ["housekeeper", "inspector", "engineer", "chief_engineer", "front_desk", "gm", "", null, undefined]) {
      expect(canViewTeamSchedule(role as string | null | undefined)).toBe(false);
    }
  });
});

describe("words: every status, role and attention kind has English and Spanish text", () => {
  const STATUSES = Object.keys(STATUS_PRESENTATION) as DisplayStatus[];
  const KINDS: AttentionKind[] = ["not_clocked_in", "ended_early", "unscheduled_on_shift", "attendance_unavailable", "stale_data", "incomplete", "unreadable"];

  it.each(["en", "es"] as const)("%s covers all keys the screens ask for", (lang) => {
    const t = makeTranslator(lang);
    const roster = buildDayRoster(schedule({ people: [person("u1", "Ana", "not_clocked_in")], shifts: [shift()] }), TODAY, "verified", CTX);
    for (const status of STATUSES) {
      expect(statusLabel(status, t)).not.toMatch(/^teamSchedule\./);
      expect(t(`teamSchedule.detail.statusHint.${status}`)).not.toMatch(/^teamSchedule\./);
    }
    for (const role of ["housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm"]) expect(roleLabel(role, t)).not.toMatch(/^teamSchedule\./);
    for (const kind of KINDS) {
      const item = { id: kind, kind, severity: "warning" as const, userId: "u1", name: "Ana", atMs: CTX.nowMs - 35 * 60_000, count: 2 };
      for (const text of [attentionTitle(item, t), attentionBody(item, { nowMs: CTX.nowMs, zone: CTX.zone, language: lang }, t)]) {
        expect(text).not.toMatch(/teamSchedule\./);
        expect(text).not.toMatch(/\{\{/);
      }
    }
    expect(windowText(roster.shifts[0], t)).toMatch(/7:00/);
    expect(personA11y(roster.people[0], t)).toContain("Ana");
    expect(sinceText(CTX.nowMs - 125 * 60_000, CTX.nowMs, t)).toMatch(/2/);
  });

  it("never calls anyone absent or a no-show", () => {
    // The coverage words (Phase 4) describe a call-out a supervisor explicitly RECORDED, so they are checked on their own below;
    // every other word must still never call anyone absent from a missing clock-in.
    const drop = ({ coverage: _coverage, ...rest }: Record<string, unknown>) => rest;
    const strings = JSON.stringify([drop((en as { teamSchedule: Record<string, unknown> }).teamSchedule), drop((es as { teamSchedule: Record<string, unknown> }).teamSchedule)]).toLowerCase();
    const coverageStrings = JSON.stringify([(en as { teamSchedule: { coverage: unknown } }).teamSchedule.coverage, (es as { teamSchedule: { coverage: unknown } }).teamSchedule.coverage]).toLowerCase();
    expect(strings + coverageStrings).not.toMatch(/no-show|no show|absent without|confirmed absent|falta injustificada/);
    // "absent" appears only to say a missing clock-in does NOT mean absent.
    for (const match of strings.matchAll(/absent|ausente/g)) {
      const around = strings.slice(Math.max(0, match.index - 40), match.index + 20);
      expect(around).toMatch(/doesn't|no significa|not/);
    }
  });

  it("shows an unrecognised role tidied instead of dropping it", () => {
    expect(roleLabel("night_auditor", makeTranslator("en"))).toBe("Night auditor");
  });

  it("keeps the English and Spanish teamSchedule trees identical in shape", () => {
    const keys = (tree: unknown, prefix = ""): string[] =>
      typeof tree === "object" && tree !== null ? Object.entries(tree).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];
    const enKeys = keys((en as Record<string, unknown>).teamSchedule).sort();
    const esKeys = keys((es as Record<string, unknown>).teamSchedule).sort();
    expect(esKeys).toEqual(enKeys);
    expect(keys((en as Record<string, unknown>).teamSchedule).length).toBeGreaterThan(100);
  });

  it("leaves no raw English in the Spanish tree", () => {
    const flat = JSON.stringify((es as Record<string, unknown>).teamSchedule);
    for (const word of ["Team Schedule", "Not clocked in", "Needs a look", "Try again", "Back to today"]) expect(flat).not.toContain(word);
  });

  it("is pluralised with the project's _plural convention", () => {
    const t = makeTranslator("en");
    expect(t("teamSchedule.summary.scheduled", { count: 1 })).toBe("1 person scheduled");
    expect(t("teamSchedule.summary.scheduled", { count: 5 })).toBe("5 people scheduled");
    expect(makeTranslator("es")("teamSchedule.summary.scheduled", { count: 5 })).toBe("5 personas programadas");
  });
});
