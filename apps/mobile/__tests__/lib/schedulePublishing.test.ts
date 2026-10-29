import { classifyPublishFailure, parseChange, parseNotificationStatus, parseReview, parseRevision, type Revision } from "@/lib/api/schedulingRevisions";
import type { AppNotification } from "@/lib/api/notifications";
import type { TeamSchedule, TeamShift } from "@/lib/api/schedulingTeam";
import { resolveNotificationLink } from "@/lib/housekeeping/notificationLinks";
import { resolveNotificationTarget, routeForTarget } from "@/lib/notifications/deepLink";
import { kindOf } from "@/lib/notifications/feed";
import { localizeNotification } from "@/lib/notifications/scheduleCopy";
import { applyDraftOverlay, countDraft, overlaySource } from "@/lib/scheduling/draftOverlay";
import { eventLabel, impactLine, issueText, notificationHeadline, pushLines } from "@/lib/scheduling/publishText";
import { resolveScheduleTarget } from "@/lib/scheduling/scheduleLink";
import { makeTranslator } from "../helpers/i18n";

const tr = makeTranslator(() => "en");
const trEs = makeTranslator(() => "es");
const ID = "b0000001-0000-4000-8000-000000000001";
const GAP = "b0000002-0000-4000-8000-000000000002";

function shift(over: Partial<TeamShift> = {}): TeamShift {
  return {
    id: "s1", userId: "u1", shiftId: "t1", workDate: "2030-01-08", name: "Morning", departmentId: "d1", startTime: "07:00:00", endTime: "15:00:00",
    startsAt: "2030-01-08T13:00:00Z", endsAt: "2030-01-08T21:00:00Z", publication: "published", notes: null, carriedFromPreviousDay: false, status: "scheduled", version: 1, ...over,
  };
}
function schedule(shifts: TeamShift[], people = [{ userId: "u1", name: "Ana", roles: [], departmentId: "d1", departmentCode: "HK", scheduled: true, status: null }, { userId: "u2", name: "Ben", roles: [], departmentId: "d1", departmentCode: "HK", scheduled: false, status: null }]): TeamSchedule {
  return { dateFrom: "2030-01-07", dateTo: "2030-01-13", hotelToday: null, generatedAt: null, people, shifts, attendance: { requested: false, verified: false, asOf: null }, totalPeople: people.length, complete: true, serverTruncated: false, unreadableShifts: 0, revision: null };
}
const proposed = (over: Record<string, unknown> = {}) => ({
  userId: "u2", shiftId: "t1", shiftName: "Morning", workDate: "2030-01-09", startTime: "08:00:00", endTime: "16:00:00", startsAt: "2030-01-09T14:00:00Z", endsAt: "2030-01-09T22:00:00Z", departmentId: "d1", notes: null, ...over,
});
function draft(changes: Revision["changes"]): Revision {
  return { id: "r1", departmentId: "d1", status: "draft", version: 3, correctsRevisionId: null, createdAt: null, updatedAt: null, publishedAt: null, publishedByName: null, result: null, changes };
}

describe("the draft preview is a view over the published schedule", () => {
  it("marks proposed creates, edits and cancellations and leaves the published schedule untouched", () => {
    const published = schedule([shift(), shift({ id: "s2", userId: "u1", workDate: "2030-01-10" })]);
    const frozen = JSON.stringify(published);
    const result = applyDraftOverlay(published, [draft([
      { id: "c1", kind: "create", assignmentId: null, baseVersion: null, before: null, proposed: proposed(), reason: null },
      { id: "c2", kind: "update", assignmentId: "s1", baseVersion: 1, before: null, proposed: proposed({ userId: "u1", workDate: "2030-01-08", startTime: "09:00:00", endTime: "17:00:00", startsAt: "2030-01-08T15:00:00Z", endsAt: "2030-01-08T23:00:00Z" }), reason: null },
      { id: "c3", kind: "cancel", assignmentId: "s2", baseVersion: 1, before: null, proposed: null, reason: "x" },
    ])]);
    expect(JSON.stringify(published)).toBe(frozen);
    const byId = new Map(result.shifts.map((s) => [s.id, s]));
    expect(byId.get("draft:c1")).toMatchObject({ proposal: { kind: "new", changeId: "c1" }, publication: "draft", userId: "u2", version: 0 });
    expect(byId.get("s1")).toMatchObject({ proposal: { kind: "changed" }, startTime: "09:00:00", status: null });
    expect(byId.get("s2")).toMatchObject({ proposal: { kind: "cancelled" }, workDate: "2030-01-10" });
    expect(result.people.find((p) => p.userId === "u2")?.scheduled).toBe(true);
  });

  it("drops a shift moved out of the loaded week and adds one moved into it", () => {
    const moved = applyDraftOverlay(schedule([shift()]), [draft([{ id: "c1", kind: "update", assignmentId: "s1", baseVersion: 1, before: null, proposed: proposed({ userId: "u1", workDate: "2030-02-01" }), reason: null }])]);
    expect(moved.shifts).toHaveLength(0);
    const into = applyDraftOverlay(schedule([]), [draft([{ id: "c1", kind: "update", assignmentId: "far", baseVersion: 4, before: null, proposed: proposed({ userId: "u1" }), reason: null }])]);
    expect(into.shifts[0]).toMatchObject({ id: "far", proposal: { kind: "changed" } });
  });

  it("returns the same object when there is no draft, and keeps loading/failed states as they are", () => {
    const base = schedule([shift()]);
    expect(applyDraftOverlay(base, [])).toBe(base);
    expect(applyDraftOverlay(base, null)).toBe(base);
    expect(overlaySource({ status: "loading" }, [draft([])])).toEqual({ status: "loading" });
    expect(overlaySource({ status: "failed", failure: { kind: "error", status: 500 } }, [draft([])])).toEqual({ status: "failed", failure: { kind: "error", status: 500 } });
    const stale = overlaySource({ status: "stale", data: base, fetchedAt: 1, reason: "offline", failure: null }, [draft([{ id: "c1", kind: "cancel", assignmentId: "s1", baseVersion: 1, before: null, proposed: null, reason: null }])]);
    expect(stale.status === "stale" && stale.data?.shifts[0].proposal?.kind).toBe("cancelled");
  });

  it("counts changes by kind", () => {
    expect(countDraft([draft([
      { id: "a", kind: "create", assignmentId: null, baseVersion: null, before: null, proposed: proposed(), reason: null },
      { id: "b", kind: "cancel", assignmentId: "s", baseVersion: 1, before: null, proposed: null, reason: null },
    ])])).toEqual({ total: 2, created: 1, changed: 0, cancelled: 1 });
    expect(countDraft(null)).toEqual({ total: 0, created: 0, changed: 0, cancelled: 0 });
  });
});

describe("reading the server's draft, review and failure shapes", () => {
  it("refuses a malformed change instead of guessing", () => {
    expect(parseChange({ id: "c", kind: "teleport" })).toBeNull();
    expect(parseChange({ id: "c", kind: "update", proposed: { user_id: "u" } })).toBeNull();
    expect(parseChange({ id: "c", kind: "cancel", assignment_id: "s", base_version: 2 })).toMatchObject({ kind: "cancel", baseVersion: 2, proposed: null });
    expect(parseRevision({ id: "r", status: "weird", version: 1 })).toBeNull();
  });

  it("reads the review counts and keeps the honest forecast answer", () => {
    const review = parseReview({ data: {
      revision: { id: "r1", status: "draft", version: 4, department_id: "d1" }, department: "HK", can_publish: false,
      summary: { new: 2, modified: 1, cancelled: 0, reassigned: 1, employees_affected: 3, total_changes: 4 }, date_range: { from: "2030-01-08", to: "2030-01-09" },
      impact: [{ user_id: "u1", name: "Ana", items: [{ kind: "changed", change_id: "c1", work_date: "2030-01-08", before: { user_id: "u1", shift_id: "t", work_date: "2030-01-08", start_time: "07:00:00", end_time: "15:00:00" }, after: null, reason: null }] }],
      blocking: [{ code: "stale_shift", change_id: "c1", current: { user_id: "u1", shift_id: "t", work_date: "2030-01-08", start_time: "09:00:00", end_time: "17:00:00" }, current_version: 3 }],
      warnings: [], forecast: { available: false, reason: "future_demand_unknown" },
    } });
    expect(review.summary).toEqual({ created: 2, modified: 1, cancelled: 0, reassigned: 1, employeesAffected: 3, totalChanges: 4 });
    expect(review.canPublish).toBe(false);
    expect(review.forecast).toEqual({ available: false, reason: "future_demand_unknown" });
    expect(review.blocking[0]).toMatchObject({ code: "stale_shift", currentVersion: 3, current: { startTime: "09:00:00" } });
  });

  it("classifies publish failures; no answer means 'maybe committed', never 'failed'", () => {
    expect(classifyPublishFailure(new Error("Network request failed")).kind).toBe("unconfirmed");
    expect(classifyPublishFailure({ status: 503 }).kind).toBe("unconfirmed");
    expect(classifyPublishFailure({ status: 401 }).kind).toBe("signed_out");
    expect(classifyPublishFailure({ status: 409, body: { code: "stale_shift" } }).kind).toBe("stale");
    expect(classifyPublishFailure({ status: 409, body: { code: "revision_changed" } }).kind).toBe("draft_changed");
    const blocked = classifyPublishFailure({ status: 409, body: { code: "publish_blocked", blocking: [{ code: "overlapping_shift", change_id: "c1" }] } });
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blocking[0].code).toBe("overlapping_shift");
    expect(classifyPublishFailure({ status: 403 }).kind).toBe("forbidden");
  });

  it("reads notification status and never invents delivery", () => {
    const status = parseNotificationStatus({ data: { state: "in_app_available", total: 3, by_status: { sent: 3, queued: 0 }, in_app_available: 3, push: { accepted: 2, no_device: 1 }, failed: [] } });
    expect(status).toMatchObject({ state: "in_app_available", inApp: 3, pushAccepted: 2, noDevice: 1 });
    expect(parseNotificationStatus({ data: { state: "something-new" } }).state).toBe("none");
  });
});

describe("words for the publish flow", () => {
  it("never says delivered, and keeps queued, in-app and provider-accepted apart", () => {
    const states = [
      parseNotificationStatus({ data: { state: "processing", total: 3, by_status: { queued: 3 }, push: {} } }),
      parseNotificationStatus({ data: { state: "in_app_available", total: 3, by_status: { sent: 3 }, in_app_available: 3, push: { accepted: 2, failed: 1, no_device: 1, opted_out: 1 } } }),
      parseNotificationStatus({ data: { state: "failed", total: 3, by_status: { failed: 2, sent: 1 }, in_app_available: 1, push: {} } }),
      parseNotificationStatus({ data: { state: "none", total: 0, by_status: {}, push: {} } }),
    ];
    for (const status of states) {
      for (const t of [tr, trEs]) {
        const words = [notificationHeadline(status, false, t), ...pushLines(status, t)].join(" ").toLowerCase();
        expect(words).not.toMatch(/delivered|entregad/);
        expect(words).not.toMatch(/\bread\b|leíd/);
      }
    }
    expect(notificationHeadline(states[0], false, tr)).toContain("queued");
    expect(notificationHeadline(states[1], false, tr)).toContain("in the app");
    expect(pushLines(states[1], tr).join(" ")).toContain("accepted by the provider");
    expect(notificationHeadline(null, true, tr)).toContain("Couldn't read");
  });

  it("describes issues by code in both languages and falls back to the server's words only for an unknown one", () => {
    const issue = (code: string, detail: string | null = null) => ({ code, changeId: null, userId: null, workDate: null, detail, current: null, currentVersion: null });
    expect(issueText(issue("overlapping_shift"), tr)).toBe("This would double-book someone.");
    expect(issueText(issue("overlapping_shift"), trEs)).toBe("Esto dejaría a alguien con turnos superpuestos.");
    expect(issueText(issue("brand_new_rule", "Server words"), tr)).toBe("Server words");
    expect(issueText(issue("brand_new_rule"), tr)).toBe("Something needs attention.");
  });

  it("writes before/after lines and labels history events", () => {
    const face = (start: string, end: string) => ({ userId: "u1", shiftId: "t", shiftName: "Morning", workDate: "2030-01-08", startTime: start, endTime: end });
    const line = impactLine({ kind: "changed", changeId: "c", workDate: "2030-01-08", before: face("07:00:00", "15:00:00"), after: face("09:00:00", "17:00:00"), reason: null }, "America/Chicago", "en", tr);
    expect(line).toContain("7:00 AM");
    expect(line).toContain("9:00 AM");
    expect(eventLabel("publication_succeeded", tr)).toBe("Publication succeeded");
    expect(eventLabel("from_the_future", tr)).toBe("from_the_future");
  });
});

describe("schedule notification links", () => {
  const data = (over: Record<string, unknown>) => ({ kind: "schedule", screen: "my_schedule", ...over });

  it("opens the right screen with only well-formed ids", () => {
    expect(resolveScheduleTarget(data({}), "housekeeper")).toMatchObject({ pathname: "/(app)/scheduling" });
    expect(resolveScheduleTarget(data({ screen: "offers", offer_id: ID }), "housekeeper")).toEqual({ screen: "offers", pathname: "/(app)/scheduling/offers", params: { offerId: ID, tab: "offers" } });
    expect(resolveScheduleTarget(data({ screen: "open_shifts", gap_id: GAP }), "housekeeper")?.params).toEqual({ gapId: GAP, tab: "open" });
    expect(resolveScheduleTarget(data({ screen: "my_requests", swap_id: ID }), "housekeeper")?.params).toEqual({ requestId: ID });
    expect(resolveScheduleTarget(data({ params: { first_date: "2030-01-08" } }), "housekeeper")?.params).toEqual({ date: "2030-01-08" });
  });

  it("drops anything that is not a well-formed id instead of passing it on", () => {
    expect(resolveScheduleTarget(data({ screen: "offers", offer_id: "../../admin" }), "housekeeper")?.params).toEqual({ tab: "offers" });
    expect(resolveScheduleTarget(data({ params: { first_date: "tomorrow; drop" } }), "housekeeper")?.params).toEqual({});
  });

  it("refuses unknown screens, other kinds and a signed-out person", () => {
    expect(resolveScheduleTarget(data({ screen: "../../etc" }), "housekeeper")).toBeNull();
    expect(resolveScheduleTarget({ kind: "task", screen: "my_schedule" }, "housekeeper")).toBeNull();
    expect(resolveScheduleTarget(data({}), null)).toBeNull();
    expect(resolveScheduleTarget(null, "housekeeper")).toBeNull();
  });

  it("keeps manager screens away from employees, and coverage needs the gap it names", () => {
    expect(resolveScheduleTarget(data({ screen: "team_requests" }), "housekeeper")).toBeNull();
    expect(resolveScheduleTarget(data({ screen: "team_requests" }), "housekeeping_supervisor")).toMatchObject({ pathname: "/(app)/team-schedule/requests" });
    expect(resolveScheduleTarget(data({ screen: "coverage" }), "housekeeping_supervisor")).toBeNull();
    expect(resolveScheduleTarget(data({ screen: "coverage", gap_id: GAP }), "housekeeping_supervisor")?.params).toEqual({ gapId: GAP });
  });

  it("is reached from the inbox sheet and from a push tap, and both honour the role", () => {
    const note = { type: "schedule_offer_received", data: data({ screen: "offers", offer_id: ID }) };
    expect(resolveNotificationLink(note, [], "housekeeper")).toMatchObject({ kind: "schedule", target: { pathname: "/(app)/scheduling/offers" } });
    expect(resolveNotificationLink(note, [], null)).toEqual({ kind: "none" });
    const target = resolveNotificationTarget(data({ screen: "offers", offer_id: ID, type: "schedule_offer_received" }), "housekeeper");
    expect(target.kind).toBe("schedule");
    expect(routeForTarget(target)).toEqual({ pathname: "/(app)/scheduling/offers", params: { offerId: ID, tab: "offers" } });
    expect(routeForTarget(resolveNotificationTarget(data({ screen: "team_requests" }), "housekeeper"))).toBeNull();
  });

  it("files schedule messages under their own kind", () => {
    expect(kindOf("schedule_published")).toBe("schedule");
    expect(kindOf("task_assigned")).toBe("task");
  });
});

describe("schedule notification text", () => {
  const note = (over: Partial<AppNotification> = {}): AppNotification => ({
    id: "n1", type: "schedule_published", title: "Schedule updated", body: "Your schedule has changed.", is_read: false, created_at: "2030-01-01T00:00:00Z",
    data: { kind: "schedule", screen: "my_schedule", i18n: { key: "scheduleNotice.published", params: { added: 1, first_date: "2030-01-08" } } }, ...over,
  });

  it("is rendered in the person's language from the key, with the date from the payload", () => {
    expect(localizeNotification(note(), tr, "en").body).toContain("Your schedule changed starting");
    expect(localizeNotification(note(), trEs, "es")).toMatchObject({ title: "Horario actualizado" });
    expect(localizeNotification(note({ data: { kind: "schedule", i18n: { key: "scheduleNotice.published", params: {} } } }), tr, "en").body).toBe("Your schedule changed. Open it to see what is different.");
  });

  it("keeps the stored text for non-schedule messages, unknown keys and anything that is not a notice key", () => {
    const task = note({ type: "task_assigned", title: "Task", body: "Do it" });
    expect(localizeNotification(task, tr)).toBe(task);
    const unknown = localizeNotification(note({ data: { kind: "schedule", i18n: { key: "scheduleNotice.never_heard_of_it", params: {} } } }), tr, "en");
    expect(unknown).toMatchObject({ title: "Schedule updated", body: "Your schedule has changed." });
    const hostile = note({ data: { kind: "schedule", i18n: { key: "settings.notifications.title" } } });
    expect(localizeNotification(hostile, tr)).toBe(hostile);
  });
});
