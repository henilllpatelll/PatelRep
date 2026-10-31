import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/* Team Scheduling Phase 5 words. Every English string has a Spanish twin with the same placeholders, every key a Phase 5
   screen asks for exists in both languages, every code the server can send has words, and nothing claims what the system
   does not do (notify, confirm, call someone available). */

type Tree = { [key: string]: string | Tree };

function flatten(node: string | Tree, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  return Object.entries(node).reduce<Record<string, string>>((all, [key, value]) => ({ ...all, ...flatten(value, prefix ? `${prefix}.${key}` : key) }), {});
}

const root = (lang: unknown) => lang as { teamSchedule: Tree & { availability: Tree; requests: Tree; coverage: Tree }; scheduling: Tree };
const SUBTREES: Array<[string, (tree: ReturnType<typeof root>) => Tree]> = [
  ["teamSchedule.availability", (r) => r.teamSchedule.availability],
  ["teamSchedule.requests", (r) => r.teamSchedule.requests],
  ["teamSchedule.coverage", (r) => r.teamSchedule.coverage],
  ["scheduling", (r) => r.scheduling],
];
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe.each(SUBTREES)("%s locale files", (_name, pick) => {
  const english = flatten(pick(root(en)));
  const spanish = flatten(pick(root(es)));

  it("has the same keys in English and Spanish, the same placeholders, and no empty text", () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      expect({ key, placeholders: placeholders(spanish[key]) }).toEqual({ key, placeholders: placeholders(text) });
      expect(text.trim()).not.toBe("");
      expect(spanish[key].trim()).not.toBe("");
    }
  });
});

const english = flatten(root(en) as unknown as Tree);
const spanish = flatten(root(es) as unknown as Tree);

describe("every key the Phase 5 screens ask for exists", () => {
  const FILES = [
    "components/scheduling/MyAvailabilityScreen.tsx", "components/scheduling/TimeOffScreen.tsx", "components/scheduling/MyRequestsScreen.tsx",
    "components/scheduling/RequestsScreen.tsx", "components/scheduling/RequestSheet.tsx", "components/scheduling/RequestCard.tsx",
    "components/scheduling/SwapRequestSheet.tsx", "components/scheduling/TeamAvailabilityScreen.tsx", "components/scheduling/requestParts.tsx",
    "lib/scheduling/requestsModel.ts", "app/(app)/scheduling/index.tsx",
  ];
  const used = new Set<string>();
  for (const file of FILES) {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*["']([A-Za-z0-9_.]+)["']/g)) used.add(match[1]);
  }

  it("finds the keys (so this test cannot pass by scanning nothing)", () => {
    expect(used.size).toBeGreaterThan(120);
  });

  it("has every static key in English and Spanish", () => {
    const missing = [...used].filter((key) => !english[key] && !english[`${key}_plural`]);
    const missingEs = [...used].filter((key) => !spanish[key] && !spanish[`${key}_plural`]);
    expect({ missing, missingEs }).toEqual({ missing: [], missingEs: [] });
  });
});

describe("the dynamic keys", () => {
  const both = (key: string) => { expect(english[key]).toBeTruthy(); expect(spanish[key]).toBeTruthy(); };

  it("words every refusal and failure the request routes can send", () => {
    const codes = [
      "signed_out", "unconfirmed", "forbidden", "not_found", "conflict", "invalid", "version_conflict", "request_not_pending", "request_not_cancellable", "request_not_found",
      "leave_overlap", "leave_over", "reason_required", "cannot_decide_own", "not_active_staff", "swap_not_found", "swap_not_approvable", "swap_not_cancellable",
      "swap_not_proposed", "swap_expired", "swap_invalid", "shift_changed", "shift_missing", "shift_started", "employee_inactive", "different_departments", "shifts_overlap",
      "shift_has_callout", "shift_in_live_swap", "approved_time_off", "warnings_need_acknowledgement", "not_counterpart", "assignment_not_found", "schedule_conflict",
      "end_before_start", "dates_in_past", "range_too_long", "partial_must_be_one_day", "invalid_partial_times", "times_need_partial", "availability_changed", "exception_exists",
      "availability_not_found", "availability_not_active", "effective_in_past", "date_in_past", "windows_required", "windows_overlap", "too_many_windows", "windows_not_allowed",
      "duplicate_weekday", "other",
    ];
    for (const code of codes) both(`teamSchedule.requests.failure.${code}`);
  });

  it("words every finding the swap checks and the shift form can raise", () => {
    const findings = [
      "approved_time_off", "overlapping_shift", "shift_changed", "employee_inactive", "shifts_overlap", "different_departments", "same_person", "shift_too_soon", "shift_not_published",
      "shift_has_attendance", "shift_times_unknown", "insufficient_rest", "weekly_overtime", "long_shift", "marked_unavailable", "outside_availability", "pending_time_off", "past_date", "other",
    ];
    for (const code of findings) both(`teamSchedule.requests.finding.${code}`);
  });

  it("words every coverage candidate flag Phase 5 added, and every availability state", () => {
    for (const flag of ["approved_time_off", "marked_unavailable", "outside_availability", "pending_time_off", "within_availability"]) both(`teamSchedule.coverage.flag.${flag}`);
    for (const state of ["available", "outside", "unavailable", "unknown"]) both(`teamSchedule.coverage.availability.${state}`);
    both("teamSchedule.coverage.failure.approved_time_off");
  });

  it("words every status, reason, weekday, filter and timeline event", () => {
    for (const status of ["pending", "approved", "denied", "cancelled", "proposed", "accepted", "declined", "expired"]) both(`teamSchedule.requests.status.${status}`);
    for (const reason of ["vacation", "personal", "family", "appointment", "health", "other"]) both(`teamSchedule.requests.reason.${reason}`);
    for (let day = 0; day < 7; day += 1) { both(`teamSchedule.availability.day.long.${day}`); both(`teamSchedule.availability.day.short.${day}`); }
    for (const filter of ["pending", "approved", "denied", "all"]) both(`teamSchedule.requests.filter.${filter}`);
    for (const type of ["all", "time_off", "shift_swap"]) both(`teamSchedule.requests.type.${type}`);
    for (const range of ["all", "week", "month"]) both(`teamSchedule.requests.range.${range}`);
    for (const filter of ["all", "action", "pending", "approved", "denied", "cancelled"]) both(`scheduling.myRequests.filter.${filter}`);
    for (const filter of ["all", "submitted", "none", "stale"]) both(`teamSchedule.availability.filters.${filter}`);
    for (const state of ["available", "unavailable", "unset"]) both(`teamSchedule.availability.state.${state}`);
    for (const event of ["created", "approved", "denied", "cancelled", "proposed", "accepted", "declined", "expired", "swapped"]) both(`teamSchedule.requests.event.${event}`);
    for (const error of ["windows_overlap", "windows_required", "too_many_windows", "same_times"]) both(`scheduling.availabilityScreen.error.${error}`);
  });
});

describe("honesty", () => {
  const phase5 = Object.entries(flatten((en as unknown as { teamSchedule: Tree }).teamSchedule.requests)).concat(
    Object.entries(flatten((en as unknown as { scheduling: Tree }).scheduling)),
  );

  it("never says the supervisor or employee was notified", () => {
    for (const [key, text] of phase5) expect({ key, hit: /notified|we.ll tell|has been told|push notification/i.test(text) }).toEqual({ key, hit: false });
  });

  it("says pending is not approved, and that approving or accepting does not by itself change a schedule", () => {
    expect(english["scheduling.timeOffForm.intro"]).toMatch(/doesn't change your shifts/);
    expect(english["scheduling.timeOffForm.sentBody"]).toMatch(/isn't approved/);
    expect(english["teamSchedule.requests.detail.impactApproved"]).toMatch(/does not remove or move/);
    expect(english["teamSchedule.requests.swap.acceptNote"]).toMatch(/does not change your schedule/);
    expect(english["scheduling.availabilityScreen.intro"]).toMatch(/never changes a shift/);
    expect(english["teamSchedule.availability.note"]).toMatch(/blank day means nothing was submitted/);
  });
});
