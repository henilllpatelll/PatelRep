jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

import { api } from "@/lib/api/client";
import {
  assignGap, classifyCoverageFailure, createOffer, fetchCandidates, fetchGaps, newCallOutKey, parseCandidate, parseGap, parseImpact, recordAbsence, withdrawOffer,
} from "@/lib/api/schedulingCoverage";
import { warningsToAcknowledge } from "@/lib/scheduling/coverageText";
import { wireCandidate, wireGap, wireImpact } from "../helpers/coverageFixtures";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("reading what the server sent", () => {
  it("reads a gap and refuses one it cannot trust", () => {
    const gap = parseGap(wireGap({ pending_offer_count: 2, offers: [{ id: "o1", user_id: "u2", user_name: "Bea", status: "pending", delivery: "not_sent" }] }));
    expect(gap).toMatchObject({ id: "g1", status: "open", workDate: "2030-01-08", pendingOffers: 2, absentUserName: "Ana Torres", absenceKind: "called_out" });
    expect(gap?.offers[0]).toMatchObject({ userName: "Bea", delivery: "not_sent" });
    expect(parseGap(wireGap({ status: "covered" }))).toBeNull();   // not a status the server has
    expect(parseGap(wireGap({ starts_at: null }))).toBeNull();
    expect(parseGap("nope")).toBeNull();
  });

  it("never turns an unreadable workload into a number", () => {
    expect(parseImpact(wireImpact())).toMatchObject({ verified: true, roomsRemaining: 9, estimatedMinutesRemaining: 270 });
    const blind = parseImpact({ verified: false, reason: "workload_unavailable", minutes_left_in_shift: 90, rooms_assigned: 99 });
    expect(blind).toMatchObject({ verified: false, roomsAssigned: null, roomsRemaining: null, estimatedMinutesRemaining: null, minutesLeftInShift: 90 });
  });

  it("never calls anyone available: availability is always unknown", () => {
    expect(parseCandidate(wireCandidate("u2", "Bea", { availability: "available" }))?.availability).toBe("unknown");
    expect(parseCandidate({ name: "no id" })).toBeNull();
  });

  it("knows which warnings need an explicit acknowledgement", () => {
    expect(warningsToAcknowledge({ warnings: ["availability_unknown", "insufficient_rest", "pending_offer_elsewhere"] })).toEqual(["insufficient_rest", "pending_offer_elsewhere"]);
    expect(warningsToAcknowledge({ warnings: ["availability_unknown"] })).toEqual([]);
  });
});

describe("calls", () => {
  it("lists the work still to do, skipping rows it cannot read", async () => {
    get.mockResolvedValue({ data: [wireGap(), { id: "bad" }] });
    expect((await fetchGaps()).map((g) => g.id)).toEqual(["g1"]);
    expect(get).toHaveBeenCalledWith("/schedules/gaps");
    await fetchGaps({ status: "filled", dateFrom: "2030-01-01" });
    expect(get).toHaveBeenLastCalledWith("/schedules/gaps?status=filled&date_from=2030-01-01");
  });

  it("searches candidates on the server and carries the gap version back", async () => {
    get.mockResolvedValue({ data: [wireCandidate("u2", "Bea")], meta: { gap_version: 4, eligible: 1 } });
    const list = await fetchCandidates("g1", { q: " be a ", filter: "eligible" });
    expect(get).toHaveBeenCalledWith("/schedules/gaps/g1/candidates?q=be%20a&filter=eligible");
    expect(list).toMatchObject({ gapVersion: 4, eligibleCount: 1 });
    expect(list.candidates[0].userId).toBe("u2");
  });

  it("records a call-out with its idempotency key and only sends the leaving time for an early departure", async () => {
    post.mockResolvedValue({ data: { absence: { id: "ab1" }, gap: wireGap(), impact: wireImpact(), replayed: false } });
    const key = newCallOutKey();
    const done = await recordAbsence({ assignmentId: "s1", expectedVersion: 3, kind: "emergency", leavingAt: "2030-01-08T18:00:00Z", note: "  phoned  ", idempotencyKey: key });
    expect(post).toHaveBeenCalledWith("/schedules/absences", { assignment_id: "s1", expected_version: 3, kind: "emergency", idempotency_key: key, note: "phoned" });
    expect(done).toMatchObject({ absenceId: "ab1", replayed: false });
    expect(done.gap?.id).toBe("g1");
    await recordAbsence({ assignmentId: "s1", expectedVersion: 3, kind: "leaving_early", leavingAt: "2030-01-08T18:00:00Z", idempotencyKey: key });
    expect(post.mock.calls[1][1]).toMatchObject({ kind: "leaving_early", leaving_at: "2030-01-08T18:00:00Z" });
    expect(newCallOutKey()).not.toBe(key);
  });

  it("creating an offer reports that nothing was delivered, and sends the version it was looking at", async () => {
    post.mockResolvedValue({ data: wireGap({ status: "offered" }), meta: { delivered: false } });
    const result = await createOffer("g1", "u2", 5);
    expect(post).toHaveBeenCalledWith("/schedules/gaps/g1/offers", { user_id: "u2", expected_version: 5 });
    expect(result.delivered).toBe(false);
    expect(result.gap.status).toBe("offered");
  });

  it("assigns with the acknowledgement flag and withdraws an offer", async () => {
    post.mockResolvedValue({ data: wireGap({ status: "filled", filled_user_id: "u2" }) });
    expect((await assignGap("g1", "u2", 2, true)).status).toBe("filled");
    expect(post).toHaveBeenCalledWith("/schedules/gaps/g1/assign", { user_id: "u2", expected_version: 2, acknowledge_warnings: true });
    await withdrawOffer("g1", "o1");
    expect(post).toHaveBeenLastCalledWith("/schedules/gaps/g1/offers/o1/withdraw", {});
  });

  it("refuses a response that is not the shape it was promised", async () => {
    post.mockResolvedValue({ data: { nope: true } });
    await expect(assignGap("g1", "u2", 1, false)).rejects.toThrow(/expected shape/);
  });
});

describe("failures", () => {
  const apiError = (status: number, code?: string) => Object.assign(new Error("x"), { status, code, body: code ? { code } : undefined });

  it("sorts a refusal into 'reload and look again' or a plain message", () => {
    expect(classifyCoverageFailure(apiError(409, "version_conflict"))).toMatchObject({ key: "version_conflict", stale: true, unconfirmed: false });
    expect(classifyCoverageFailure(apiError(409, "gap_not_fillable"))).toMatchObject({ key: "gap_not_fillable", stale: true });
    expect(classifyCoverageFailure(apiError(409, "duplicate_absence"))).toMatchObject({ key: "duplicate_absence", stale: false });
    expect(classifyCoverageFailure(apiError(409, "candidate_ineligible"))).toMatchObject({ stale: true });
    expect(classifyCoverageFailure(apiError(403))).toMatchObject({ key: "forbidden" });
    expect(classifyCoverageFailure(apiError(404))).toMatchObject({ key: "gap_not_found", stale: true });
    expect(classifyCoverageFailure(apiError(409, "something_new"))).toMatchObject({ key: "other" });
  });

  it("treats a missing answer as 'may have saved', never as a clean failure", () => {
    expect(classifyCoverageFailure(new Error("Network request failed"))).toMatchObject({ key: "unconfirmed", unconfirmed: true });
    expect(classifyCoverageFailure(apiError(502))).toMatchObject({ key: "unconfirmed", unconfirmed: true });
    expect(classifyCoverageFailure(apiError(401))).toMatchObject({ key: "signed_out", unconfirmed: true });
  });
});
