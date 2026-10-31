import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { parseForecast, parseForecastDay } from "@/lib/api/schedulingForecast";
import { parseTeamScheduleParams, teamScheduleParams } from "@/lib/navigation/teamScheduleLink";
import { capacityAssumption, dayIndex, durationText, heroFor, limitationText, metricsFor, outlookRow, reasonText, recommendationText, targetFor } from "@/lib/scheduling/forecastModel";
import { makeTranslator } from "../helpers/i18n";
import { recommendation, wireDay, wireForecast } from "../helpers/forecastFixtures";

const t = makeTranslator("en");
const day = (over: Parameters<typeof wireDay>[0]) => parseForecastDay(wireDay(over))!;

describe("forecast response parsing", () => {
  it("keeps what the server said and nothing else", () => {
    const parsed = day({ date: "2026-10-28", isToday: true, status: "short", gap: 90, demand: 570, capacity: 480 });
    expect(parsed.status).toBe("short");
    expect(parsed.demand.minutes).toMatchObject({ value: 570, quality: "estimate" });
    expect(parsed.capacity.productive.assumptions).toEqual(["paid_shift_minutes_no_break_policy"]);
    expect(parsed.current).toMatchObject({ verified: true, working: 1 });
  });

  it("never turns an unknown figure into zero", () => {
    const parsed = day({ date: "2026-10-29", status: "unknown", demand: null, capacity: 480, reason: "pms_not_connected", rooms: null });
    expect(parsed.demand.minutes).toMatchObject({ value: null, quality: "unavailable", reason: "pms_not_connected" });
    expect(parsed.demand.rooms).toBeNull();
    expect(parsed.gap.minutes).toBeNull();
    expect(parsed.capacity.productive.value).toBe(480);
  });

  it("treats an unrecognised or untrustworthy status as unknown, never as sufficient", () => {
    expect(parseForecastDay({ ...wireDay({ date: "2026-10-28" }), status: "great" })!.status).toBe("unknown");
    expect(parseForecastDay({ ...wireDay({ date: "2026-10-28" }), forecast_quality: "unavailable" })!.status).toBe("unknown");
    expect(parseForecastDay({ ...wireDay({ date: "2026-10-28" }), forecast_quality: "bogus" })!.quality).toBe("unavailable");
  });

  it("drops a value with no matching quality and an unknown action, and counts a day it cannot read", () => {
    const body = wireForecast([
      wireDay({ date: "2026-10-28", isToday: true, recommendations: [recommendation({ action: { type: "delete_everything", date: "2026-10-28" } }), { nope: true }] }),
      { date: "not-a-date" },
      "garbage",
    ]);
    const forecast = parseForecast(body);
    expect(forecast.days).toHaveLength(1);
    expect(forecast.unreadableDays).toBe(2);
    expect(forecast.days[0].recommendations).toHaveLength(1);
    expect(forecast.days[0].recommendations[0].action).toBeNull();
    expect(forecast).toMatchObject({ hotelName: "Fossil Creek Inn", revision: "abc123", hotelToday: "2026-10-28" });
  });

  it("refuses a body that is not a forecast, or whose days are all unreadable", () => {
    expect(() => parseForecast({ data: {} })).toThrow();
    expect(() => parseForecast(null)).toThrow();
    expect(() => parseForecast(wireForecast([{ date: "x" }]))).toThrow();
    expect(parseForecast(wireForecast([])).days).toEqual([]);
  });
});

describe("what the screen says", () => {
  it("states a projected gap from the server's number, and a minimum as a minimum", () => {
    const short = heroFor(day({ date: "2026-10-28", status: "short", gap: 90 }), t);
    expect(short).toMatchObject({ tone: "warn", title: "Projected staffing gap" });
    expect(short.body).toBe("About 1 h 30 min of cleaning work is not covered by scheduled labour.");
    expect(heroFor(day({ date: "2026-10-28", status: "short", gap: 90, isMinimum: true }), t).body).toMatch(/^At least 1 h 30 min/);
  });

  it("says sufficient only for a sufficient result, with the figures behind it", () => {
    const hero = heroFor(day({ date: "2026-10-28", status: "sufficient", demand: 300, capacity: 480 }), t);
    expect(hero).toMatchObject({ tone: "ok", title: "Coverage appears sufficient" });
    expect(hero.body).toBe("8 h of scheduled labour for about 5 h of cleaning work.");
  });

  it("explains why it cannot assess instead of guessing", () => {
    const hero = heroFor(day({ date: "2026-10-29", status: "unknown", demand: null, reason: "pms_not_connected" }), t);
    expect(hero.title).toBe("Cannot assess coverage");
    expect(hero.body).toMatch(/not connected/);
    expect(hero.badge).toBe("Not enough data to assess");
  });

  it("shows a missing figure as missing, not as 0", () => {
    const metrics = metricsFor(day({ date: "2026-10-29", status: "unknown", demand: null, rooms: null }), t);
    expect(metrics.find((m) => m.key === "demand")!.value).toBeNull();
    expect(metrics.find((m) => m.key === "gap")!.value).toBeNull();
    expect(metrics.find((m) => m.key === "rooms")!.value).toBeNull();
    expect(metrics.find((m) => m.key === "capacity")!.value).toBe("8 h");
  });

  it("labels a lower-bound demand and the denominator of the capacity figure", () => {
    const metrics = metricsFor(day({ date: "2026-10-28", isToday: true, status: "short", demand: 600, capacity: 360, gap: 240, isMinimum: true, complete: false }), t);
    expect(metrics.find((m) => m.key === "demand")!.note).toMatch(/At least/);
    expect(metrics.find((m) => m.key === "gap")!.value).toBe("4 h short");
    expect(metrics.find((m) => m.key === "capacity")!.note).toBe("From now to the end of each shift");
  });

  it("rows the outlook by status and keeps unknown days neutral", () => {
    const unknown = outlookRow(day({ date: "2026-10-29", status: "unknown", demand: null }), t);
    expect(unknown).toMatchObject({ tone: "neutral", statusLabel: "Not enough data", isShort: false });
    expect(unknown.detail).toBe("Workload not available · 8 h scheduled");
    const short = outlookRow(day({ date: "2026-10-28", status: "short", gap: 60, openGaps: [{ gap_id: "g1", shift_name: "AM", start_time: "07:00:00", end_time: "15:00:00" }] }), t);
    expect(short).toMatchObject({ tone: "warn", isShort: true, openShifts: 1 });
    expect(short.detail).toContain("1 h short");
  });

  it("formats durations plainly", () => {
    expect([0, 45, 60, 90, 125.6].map((m) => durationText(m, t))).toEqual(["0 min", "45 min", "1 h", "1 h 30 min", "2 h 6 min"]);
  });

  it("describes the break assumption honestly", () => {
    expect(capacityAssumption(day({ date: "2026-10-28" }), t)).toMatch(/No break policy is set/);
    expect(capacityAssumption({ ...day({ date: "2026-10-28" }), capacity: { ...day({ date: "2026-10-28" }).capacity, breakPolicy: "scenario" } }, t)).toMatch(/what-if/);
  });

  it("indexes days by date", () => {
    const forecast = parseForecast(wireForecast([wireDay({ date: "2026-10-28", isToday: true }), wireDay({ date: "2026-10-29" })]));
    expect(Object.keys(dayIndex(forecast))).toEqual(["2026-10-28", "2026-10-29"]);
    expect(dayIndex(null)).toEqual({});
  });
});

describe("recommendations", () => {
  const parsed = (over: Record<string, unknown>) => day({ date: "2026-10-28", recommendations: [recommendation(over)] }).recommendations[0];

  it("explains what, why and from where, for every kind the server can send", () => {
    const kinds: Array<[string, Record<string, unknown>, RegExp]> = [
      ["uncovered_shift", { shift_name: "Morning" }, /Morning has no one assigned/],
      ["unresolved_callout", { count: 2 }, /2 call-outs are not confirmed/],
      ["shortfall", { additional_shifts: 2 }, /Add about 2 more shifts/],
      ["leave_conflict", { count: 1 }, /1 shift overlaps approved time off/],
      ["missing_estimates", { rooms: 3 }, /3 rooms have no cleaning time/],
      ["unassigned_rooms", { rooms: 1 }, /1 room is not assigned yet/],
      ["pending_leave", { count: 2 }, /2 shifts overlap pending time off/],
    ];
    for (const [kind, params, title] of kinds) {
      const text = recommendationText(parsed({ kind, params, id: `${kind}:x` }), t)!;
      expect(text.title).toMatch(title);
      expect(text.why.length).toBeGreaterThan(20);
      expect(text.basis).toMatch(/records|Estimated/);
    }
  });

  it("separates verified records from estimates", () => {
    expect(recommendationText(parsed({ basis: "verified" }), t)!.basis).toBe("From your records");
    expect(recommendationText(parsed({ basis: "estimate" }), t)!.basis).toBe("Estimated");
  });

  it("never shows a recommendation it cannot explain", () => {
    expect(recommendationText(parsed({ kind: "mystery" }), t)).toBeNull();
  });

  it("deep-links to existing screens with the right date and ids, and never to an unknown screen", () => {
    expect(targetFor({ type: "find_coverage", gapId: "g1", date: "2026-10-28" })).toEqual({ screen: "coverage", gapId: "g1" });
    expect(targetFor({ type: "find_coverage", gapId: null, date: "2026-10-28" })).toBeNull();
    expect(targetFor({ type: "add_shift", date: "2026-10-29", gapId: null })).toEqual({ screen: "schedule", view: "today", date: "2026-10-29", compose: "add" });
    expect(targetFor({ type: "view_week", date: "2026-10-29", gapId: null })).toEqual({ screen: "schedule", view: "week", date: "2026-10-29", compose: null });
    expect(targetFor({ type: "review_time_off", date: "2026-10-29", gapId: null })).toEqual({ screen: "requests" });
    expect(targetFor({ type: "view_assignments", date: "2026-10-29", gapId: null })).toEqual({ screen: "assignments" });
  });

  it("an action's words come from the same table that names the screens it opens", () => {
    for (const type of ["find_coverage", "add_shift", "view_week", "review_time_off", "view_assignments"]) {
      expect(t(`teamSchedule.forecast.actions.${type}`)).not.toContain("teamSchedule.");
    }
  });
});

describe("compose=add deep link", () => {
  it("round-trips and ignores anything else", () => {
    expect(teamScheduleParams({ date: "2026-10-29", compose: "add" })).toEqual({ date: "2026-10-29", compose: "add" });
    expect(parseTeamScheduleParams({ compose: "add", date: "2026-10-29" })).toMatchObject({ compose: "add", date: "2026-10-29" });
    expect(parseTeamScheduleParams({ compose: "delete" }).compose).toBeNull();
    expect(parseTeamScheduleParams({}).compose).toBeNull();
  });
});

describe("EN/ES parity and coverage of server codes", () => {
  type Tree = { [key: string]: string | Tree };
  const flatten = (node: string | Tree, prefix = ""): Record<string, string> =>
    typeof node === "string" ? { [prefix]: node } : Object.entries(node).reduce<Record<string, string>>((all, [k, v]) => ({ ...all, ...flatten(v, prefix ? `${prefix}.${k}` : k) }), {});
  const english = flatten((en as unknown as { teamSchedule: { forecast: Tree } }).teamSchedule.forecast);
  const spanish = flatten((es as unknown as { teamSchedule: { forecast: Tree } }).teamSchedule.forecast);
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it("has the same keys and placeholders in both languages, and no empty text", () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      expect({ key, placeholders: placeholders(spanish[key]) }).toEqual({ key, placeholders: placeholders(text) });
      expect(text.trim()).not.toBe("");
      expect(spanish[key].trim()).not.toBe("");
    }
  });

  it("words every reason, limitation, status and quality the server can send", () => {
    const python = fs.readFileSync(path.join(__dirname, "..", "..", "..", "api", "services", "staffing_forecast.py"), "utf8");
    const limitations = [...python.matchAll(/limitations\.append\("(\w+)"\)/g)].map((m) => m[1]);
    const reasons = ["room_board_unreadable", "pms_not_connected", "future_demand_unavailable", "unestimated_rooms", "capacity_unavailable", "absences_unreadable", "leave_unreadable", "demand_incomplete"];
    expect(limitations.length).toBeGreaterThanOrEqual(3);
    for (const code of limitations) expect(limitationText(code, t)).toBeTruthy();
    for (const code of reasons) expect(reasonText(code, t)).not.toContain("teamSchedule.");
    for (const lang of [makeTranslator("en"), makeTranslator("es")]) {
      for (const status of ["short", "sufficient", "unknown"]) expect(lang(`teamSchedule.forecast.outlook.${status}`)).not.toContain("teamSchedule.");
      for (const quality of ["estimated", "partial", "unavailable"]) expect(lang(`teamSchedule.forecast.quality.${quality}`)).not.toContain("teamSchedule.");
      for (const kind of ["uncovered_shift", "unresolved_callout", "shortfall", "leave_conflict", "missing_estimates", "unassigned_rooms", "pending_leave"]) {
        expect(lang(`teamSchedule.forecast.rec.${kind}.why`)).not.toContain("teamSchedule.");
      }
    }
  });

  it("does not expose database or implementation names to the user", () => {
    for (const text of Object.values(english)) {
      expect(text).not.toMatch(/hk_shift_sessions|room_status|opera_|shift_assignments|coverage_gaps|supabase|_id\b/i);
    }
  });

  it("makes no claim the forecast cannot back up", () => {
    for (const text of Object.values(english)) {
      expect(text).not.toMatch(/guarantee|AI-powered|machine learning|automatically (assign|publish|move)/i);
    }
  });
});
