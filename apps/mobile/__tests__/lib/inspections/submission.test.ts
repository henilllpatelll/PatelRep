import { ApiError } from "@/lib/api/client";
import type { InspectionDetail } from "@/lib/api/inspections";
import {
  buildSubmission,
  classifySubmissionError,
  classifySubmissionResponse,
  newSubmissionId,
  parseCompletionResponse,
  resolveUncertain,
  submissionEligibility,
} from "@/lib/inspections/submission";
import type { AnswerMap } from "@/lib/inspections/types";
import { rawItem, readyRoom, template } from "../../helpers/inspectionFixtures";

const checklist = template("t", {
  fingerprint: "fp-live",
  items: [
    rawItem("bed", { description: "Bed made", sort_order: 1 }),
    rawItem("mirror", { description: "Mirror clean", sort_order: 2, requires_photo_on_fail: true }),
  ],
});
const ID = "7d3e3b1e-6d57-4a26-9d3e-6f2f4f7c1111";
const HOTEL = "hotel-uuid";
const pass: AnswerMap = { bed: { result: "pass" }, mirror: { result: "pass" } };

function plan(overrides: Partial<Parameters<typeof buildSubmission>[0]> = {}) {
  return buildSubmission({ submissionId: ID, hotelId: HOTEL, room: readyRoom("r204"), template: checklist, answers: pass, ...overrides });
}

describe("building the request", () => {
  it("carries every guard the server checks and nothing it should not", () => {
    const result = plan({ room: readyRoom("r204", { clean_cycle_id: "cycle-9" }), notes: "  all good " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.body).toEqual({
      room_id: "r204",
      template_id: "t",
      overall_result: "passed",
      items: [
        { template_item_id: "bed", result: "pass" },
        { template_item_id: "mirror", result: "pass" },
      ],
      client_submission_id: ID,
      expected_hotel_id: HOTEL,
      template_fingerprint: "fp-live",
      expected_clean_cycle_id: "cycle-9",
      notes: "all good",
    });
    expect(result.plan.photos).toEqual([]);
  });

  it("links a reinspection to the failure the queue row named", () => {
    const failure = { inspection_id: "insp-1", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "touch_up" as const, items: [] };
    const result = plan({ room: readyRoom("r204", { previous_failure: failure }) });
    expect(result.ok && result.plan.body.reinspection_of).toBe("insp-1");
  });

  it("omits guards it does not have instead of sending nulls", () => {
    const result = plan({ room: readyRoom("r204", { clean_cycle_id: null }), template: template("t", { fingerprint: undefined, items: checklist.items.map((i) => rawItem(i.id)) }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.body).not.toHaveProperty("expected_clean_cycle_id");
    expect(result.plan.body).not.toHaveProperty("template_fingerprint");
    expect(result.plan.body).not.toHaveProperty("notes");
  });

  it("sends severity and photos only for failed items, and drops orphaned photos", () => {
    const answers: AnswerMap = { bed: { result: "pass" }, mirror: { result: "fail", severity: "major", note: "streaked" } };
    const result = plan({ answers, photos: { mirror: "file:///m.jpg", bed: "file:///stale.jpg" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.body.items[1]).toEqual({ template_item_id: "mirror", result: "fail", severity: "major", note: "streaked" });
    expect(result.plan.photos).toEqual([{ itemId: "mirror", uri: "file:///m.jpg" }]);
    expect(result.plan.outcome).toBe("failed");
    expect(result.plan.correctionKind).toBe("reclean");
  });

  it("never builds a request for an incomplete or evidence-less inspection", () => {
    const unanswered = plan({ answers: { bed: { result: "pass" } } });
    expect(unanswered.ok).toBe(false);
    expect(!unanswered.ok && unanswered.blocker.code).toBe("required_items_unanswered");
    const noPhoto = plan({ answers: { bed: { result: "pass" }, mirror: { result: "fail" } } });
    expect(!noPhoto.ok && noPhoto.blocker.code).toBe("required_photos_missing");
  });

  it("ignores answers for items that are not on the checklist", () => {
    const result = plan({ answers: { ...pass, ghost: { result: "fail" } } });
    expect(result.ok && result.plan.body.items.map((i) => i.template_item_id)).toEqual(["bed", "mirror"]);
    expect(result.ok && result.plan.outcome).toBe("passed");
  });

  it("mints distinct, uuid-shaped submission ids", () => {
    const a = newSubmissionId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newSubmissionId()).not.toBe(a);
  });
});

describe("reading the reply", () => {
  const ok = (data: Record<string, unknown>) => ({ data: { id: ID, overall_result: "passed", ...data } });

  it("accepts only a receipt for this submission with a definite result", () => {
    expect(parseCompletionResponse(ok({}), ID)).toMatchObject({ id: ID, outcome: "passed", replayed: false, followUpComplete: true });
    expect(parseCompletionResponse(ok({ id: "someone-else" }), ID)).toBeNull();
    expect(parseCompletionResponse(ok({ overall_result: "conditional" }), ID)).toBeNull();
    expect(parseCompletionResponse(ok({ overall_result: undefined }), ID)).toBeNull();
    expect(parseCompletionResponse({}, ID)).toBeNull();
    expect(parseCompletionResponse(null, ID)).toBeNull();
    expect(parseCompletionResponse("ok", ID)).toBeNull();
  });

  it("a failed inspection is only fully done when the server says its follow-up completed", () => {
    const created = parseCompletionResponse(
      ok({ overall_result: "failed", followup_complete: true, correction_kind: "touch_up", correction: { status: "created", task: { id: "task-1" } } }),
      ID,
    );
    expect(created).toMatchObject({ outcome: "failed", correctionKind: "touch_up", followUpComplete: true, correction: { status: "created", taskId: "task-1" } });
    const missing = parseCompletionResponse(ok({ overall_result: "failed", followup_complete: false, correction: { status: "failed", task: null } }), ID);
    expect(missing).toMatchObject({ followUpComplete: false, correction: { status: "failed", taskId: null } });
    // an older body that does not say is not assumed complete
    expect(parseCompletionResponse(ok({ overall_result: "failed" }), ID)?.followUpComplete).toBe(false);
  });

  it("a 200 with an unexpected body is uncertain, not success", () => {
    expect(classifySubmissionResponse({ data: { id: "other", overall_result: "passed" } }, ID)).toEqual({
      kind: "uncertain",
      reason: "ambiguous_response",
      submissionId: ID,
    });
  });

  it("separates committed from committed-with-follow-up-pending", () => {
    expect(classifySubmissionResponse(ok({}), ID).kind).toBe("committed");
    expect(classifySubmissionResponse(ok({ overall_result: "failed", followup_complete: false }), ID).kind).toBe("needs_follow_up");
    expect(classifySubmissionResponse(ok({ replayed: true }), ID)).toMatchObject({ kind: "committed", receipt: { replayed: true } });
  });
});

describe("classifying a failed request", () => {
  const apiError = (status: number, code?: string, message = "msg") => new ApiError(message, status, code);

  it.each([
    ["room_not_awaiting_inspection", "room_changed", "queue"],
    ["room_changed_since_review", "room_changed", "queue"],
    ["correction_changed", "room_changed", "queue"],
    ["template_changed", "template_changed", "templates"],
    ["template_not_applicable", "template_changed", "templates"],
    ["no_checklist", "template_changed", "templates"],
    ["hotel_mismatch", "account_changed", "none"],
    ["submission_conflict", "id_conflict", "none"],
  ])("409/422 %s means nothing was recorded (%s)", (code, reason, refresh) => {
    const outcome = classifySubmissionError(apiError(code === "no_checklist" ? 422 : 409, code), ID);
    expect(outcome).toMatchObject({ kind: "rejected", reason, refresh, sameSubmissionOk: false, code });
  });

  it("a photo upload failure recorded nothing and the same submission may be resent", () => {
    expect(classifySubmissionError(apiError(502, "photo_upload_failed"), ID)).toMatchObject({
      kind: "rejected",
      reason: "evidence_upload_failed",
      sameSubmissionOk: true,
    });
  });

  it("no reply at all is uncertain (offline, timeout): it may have landed", () => {
    expect(classifySubmissionError(new Error("Request timed out. Please try again."), ID)).toEqual({ kind: "uncertain", reason: "no_response", submissionId: ID });
  });

  it("a 5xx is uncertain; a partial commit and an in-flight duplicate are named", () => {
    expect(classifySubmissionError(apiError(503), ID)).toMatchObject({ kind: "uncertain", reason: "server_error" });
    expect(classifySubmissionError(apiError(500, "inspection_incomplete"), ID)).toMatchObject({ kind: "uncertain", reason: "partial_commit" });
    expect(classifySubmissionError(apiError(409, "submission_in_progress"), ID)).toMatchObject({ kind: "uncertain", reason: "in_progress" });
  });

  it("other refusals are rejections with the right meaning", () => {
    expect(classifySubmissionError(apiError(403), ID)).toMatchObject({ kind: "rejected", reason: "forbidden" });
    expect(classifySubmissionError(apiError(422, "required_items_unanswered"), ID)).toMatchObject({ kind: "rejected", reason: "invalid", refresh: "none" });
    expect(classifySubmissionError(apiError(409), ID)).toMatchObject({ kind: "rejected", reason: "room_changed", refresh: "queue" });
    expect(classifySubmissionError(apiError(404), ID)).toMatchObject({ kind: "rejected", reason: "not_found" });
  });

  it("keeps the server's message for the screen", () => {
    expect(classifySubmissionError(apiError(409, "template_changed", "The checklist changed"), ID)).toMatchObject({ message: "The checklist changed" });
  });
});

describe("settling an uncertain submission", () => {
  const detail = (overrides: Partial<InspectionDetail> = {}): InspectionDetail => ({
    id: ID, room_id: "r204", room_number: "204", floor: 2, room_type_id: null, template_id: "t", template_name: "T",
    overall_result: "passed", notes: null, completed_at: null, inspected_by: "u", inspector_name: null, correction_kind: null,
    reinspection_of: null, correction: null,
    items: [{ template_item_id: "bed", section: "Bed", description: "Bed", is_required: true, requires_photo_on_fail: false, result: "pass", note: null, severity: null, photo_url: null }],
    ...overrides,
  });

  it("found means it landed — settled by reading back, never by resending", () => {
    expect(resolveUncertain({ status: "found", detail: detail() }, "passed")).toMatchObject({ kind: "recorded", matchesIntent: true });
    expect(resolveUncertain({ status: "found", detail: detail() }, "failed")).toMatchObject({ kind: "recorded", matchesIntent: false });
  });

  it("found without answers is an incomplete commit to finish with the same id", () => {
    expect(resolveUncertain({ status: "found", detail: detail({ items: [] }) }, "passed").kind).toBe("incomplete");
  });

  it("not found means it is safe to resend the same id; an unreadable answer stays uncertain", () => {
    expect(resolveUncertain({ status: "not_found" }, "passed")).toEqual({ kind: "not_recorded" });
    expect(resolveUncertain("unknown", "passed")).toEqual({ kind: "still_uncertain" });
  });
});

describe("whether Submit may act", () => {
  const base = {
    evaluation: { canSubmit: true },
    submitting: false,
    online: true,
    identityMatches: true,
    templateChange: "same" as const,
    roomStillAwaiting: true as boolean | null,
  };

  it("allows a complete, current, online submission", () => {
    expect(submissionEligibility(base)).toEqual({ ok: true });
  });

  it.each([
    [{ submitting: true }, "busy"],
    [{ identityMatches: false }, "account_changed"],
    [{ templateChange: "changed" as const }, "template_changed"],
    [{ templateChange: "removed" as const }, "template_changed"],
    [{ roomStillAwaiting: false }, "room_not_awaiting"],
    [{ evaluation: { canSubmit: false } }, "checklist_incomplete"],
    [{ online: false }, "offline"],
  ])("refuses %j with %s", (override, reason) => {
    expect(submissionEligibility({ ...base, ...override })).toEqual({ ok: false, reason });
  });

  it("an unverified queue does not block: the server decides", () => {
    expect(submissionEligibility({ ...base, roomStillAwaiting: null })).toEqual({ ok: true });
  });
});
