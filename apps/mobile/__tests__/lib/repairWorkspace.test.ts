import {
  buildCompletionBody,
  buildTimeline,
  deriveRepairActions,
  emptyCompletionDraft,
  estimateClockSkewMs,
  formatStopwatch,
  interpretCompletionError,
  offlineCompletionBlock,
  stagePart,
  stagedPartIssue,
  summarizeLabor,
  validateCompletion,
  type CompletionDraft,
  type LaborSession,
  type RepairCode,
  type StagedPart,
} from "@/lib/engineering/repairWorkspace";

const ME = "u1";
const OTHER = "u2";

const session = (over: Partial<LaborSession> = {}): LaborSession => ({
  id: "s1",
  work_order_id: "wo-1",
  staff_user_id: ME,
  started_at: "2026-10-31T10:00:00.000Z",
  ended_at: null,
  duration_minutes: null,
  ...over,
});

const wo = (over: Record<string, unknown> = {}) =>
  ({ status: "in_progress", assigned_to: ME, acknowledged_at: null, arrived_at: null, ...over }) as Parameters<typeof deriveRepairActions>[0]["wo"];

const actions = (order: ReturnType<typeof wo>, role = "engineer", sessions: LaborSession[] = [], userId = ME) =>
  deriveRepairActions({ wo: order, role, userId, sessions });

describe("deriveRepairActions — the status/assignment/role state machine", () => {
  it("offers Claim on an unassigned open order and nothing that needs ownership", () => {
    const a = actions(wo({ status: "open", assigned_to: null }));
    expect(a.primary).toBe("claim");
    expect(a.can.claim).toBe(true);
    expect(a.can.complete).toBe(false);
    expect(a.can.arrive).toBe(false);
    expect(a.can.diagnose).toBe(false);
    // An engineer may escalate or add evidence on a claimable order, but not hold one that is not in progress.
    expect(a.can.escalate).toBe(true);
    expect(a.can.hold).toBe(false);
  });

  it("leads an open order assigned to me with Start Repair, and offers Acknowledge until it is acknowledged", () => {
    const a = actions(wo({ status: "open" }));
    expect(a.primary).toBe("start");
    expect(a.can.acknowledge).toBe(true);
    expect(actions(wo({ status: "open", acknowledged_at: "2026-10-31T10:00:00Z" })).can.acknowledge).toBe(false);
  });

  it("an order in progress leads with Review Completion and offers arrival once", () => {
    const a = actions(wo());
    expect(a.primary).toBe("complete");
    expect(a.can).toMatchObject({ arrive: true, startLabor: true, hold: true, escalate: true, complete: true, parts: true, diagnose: true });
    expect(actions(wo({ arrived_at: "2026-10-31T10:05:00Z" })).can.arrive).toBe(false);
  });

  it("labor: Start before any session, Resume after one, Pause only while MY session runs", () => {
    expect(actions(wo()).laborVerb).toBe("start");
    const paused = [session({ ended_at: "2026-10-31T10:30:00Z", duration_minutes: 30 })];
    const afterPause = actions(wo(), "engineer", paused);
    expect(afterPause.laborVerb).toBe("resume");
    expect(afterPause.can.startLabor).toBe(true);
    expect(afterPause.can.pauseLabor).toBe(false);

    const running = actions(wo(), "engineer", [session()]);
    expect(running.can.pauseLabor).toBe(true);
    expect(running.can.startLabor).toBe(false);

    // Someone else's running session is not mine to pause.
    expect(actions(wo(), "engineer", [session({ staff_user_id: OTHER })]).can.pauseLabor).toBe(false);
  });

  it("an on-hold or escalated order leads with Resume Work and cannot be held or completed", () => {
    for (const status of ["on_hold", "escalated"]) {
      const a = actions(wo({ status }));
      expect(a.primary).toBe("resumeWork");
      expect(a.can.complete).toBe(false);
      expect(a.can.startLabor).toBe(false);
    }
    // Already escalated is not escalated twice; an on-hold order can still be escalated.
    expect(actions(wo({ status: "escalated" })).can.escalate).toBe(false);
    expect(actions(wo({ status: "on_hold" })).can.escalate).toBe(true);
  });

  it("completed and cancelled orders are read-only", () => {
    for (const status of ["completed", "cancelled"]) {
      const a = actions(wo({ status }));
      expect(a.block).toBe("closed");
      expect(a.primary).toBeNull();
      expect(Object.values(a.can).some(Boolean)).toBe(false);
    }
  });

  it("an order held by a colleague is view-only for an engineer but still actionable for the GM", () => {
    const theirs = wo({ assigned_to: OTHER });
    const engineer = actions(theirs);
    expect(engineer.block).toBe("claimedElsewhere");
    expect(engineer.can.complete).toBe(false);
    expect(engineer.can.note).toBe(true);
    expect(actions(theirs, "gm").can.complete).toBe(true);
  });

  it("roles the API refuses (chief engineer, housekeeping) only read", () => {
    for (const role of ["chief_engineer", "housekeeper", "front_desk"]) {
      const a = actions(wo(), role);
      expect(a.block).toBe("viewOnly");
      expect(a.can.complete).toBe(false);
      expect(a.can.claim).toBe(false);
    }
  });
});

describe("summarizeLabor — server sessions only", () => {
  const T0 = new Date("2026-10-31T10:00:00.000Z").getTime();

  it("sums closed sessions and does not count paused time", () => {
    const sessions = [
      session({ id: "a", started_at: "2026-10-31T08:00:00Z", ended_at: "2026-10-31T08:30:00Z", duration_minutes: 30 }),
      // gap 08:30 → 09:00 is a pause: not counted
      session({ id: "b", started_at: "2026-10-31T09:00:00Z", ended_at: "2026-10-31T09:12:30Z", duration_minutes: 12.5 }),
    ];
    const summary = summarizeLabor(sessions, ME, T0);
    expect(summary.recordedMinutes).toBe(42.5);
    expect(summary.active).toBeNull();
    expect(summary.totalMinutes).toBe(42.5);
  });

  it("adds the running session's elapsed time from its server start", () => {
    const summary = summarizeLabor(
      [session({ id: "a", started_at: "2026-10-31T08:00:00Z", ended_at: "2026-10-31T08:30:00Z", duration_minutes: 30 }), session()],
      ME,
      T0 + 24 * 60_000 + 16_000
    );
    expect(summary.active?.id).toBe("s1");
    expect(summary.activeIsMine).toBe(true);
    expect(summary.activeSeconds).toBe(24 * 60 + 16);
    expect(formatStopwatch(summary.activeSeconds)).toBe("00:24:16");
    expect(summary.totalMinutes).toBeCloseTo(30 + (24 * 60 + 16) / 60, 1);
  });

  it("recovers the same value after the app was backgrounded (derived from now, not from ticks)", () => {
    const sessions = [session()];
    const before = summarizeLabor(sessions, ME, T0 + 60_000);
    const afterLongBackground = summarizeLabor(sessions, ME, T0 + 3 * 3_600_000);
    expect(before.activeSeconds).toBe(60);
    expect(afterLongBackground.activeSeconds).toBe(3 * 3600);
  });

  it("never goes negative when the phone clock is behind, and corrects a known skew", () => {
    expect(summarizeLabor([session()], ME, T0 - 5 * 60_000).activeSeconds).toBe(0);
    // Phone is 10 minutes slow: the server clock is 10 minutes ahead of the device.
    const skew = estimateClockSkewMs("2026-10-31T10:10:00.000Z", T0);
    expect(skew).toBe(-10 * 60_000);
    expect(summarizeLabor([session({ started_at: "2026-10-31T10:10:00.000Z" })], ME, T0 + 60_000, skew).activeSeconds).toBe(60);
  });

  it("ignores small clock differences and bad input when estimating skew", () => {
    expect(estimateClockSkewMs("2026-10-31T10:00:30.000Z", new Date("2026-10-31T10:00:00Z").getTime())).toBe(0);
    expect(estimateClockSkewMs(null, 0)).toBe(0);
    expect(estimateClockSkewMs("nope", 0)).toBe(0);
  });

  it("does not invent history when there are no sessions", () => {
    const summary = summarizeLabor([], ME, T0);
    expect(summary).toMatchObject({ recordedMinutes: 0, totalMinutes: 0, active: null, activeSeconds: 0 });
  });

  it("marks a colleague's running session as not mine", () => {
    expect(summarizeLabor([session({ staff_user_id: OTHER })], ME, T0 + 1000).activeIsMine).toBe(false);
  });
});

describe("buildTimeline — only server records", () => {
  it("merges timing, audit, notes and photos oldest first and labels machine rows", () => {
    const items = buildTimeline({
      createdAt: "2026-10-31T09:00:00Z",
      viewerId: ME,
      timing: [
        { id: "e1", event_type: "arrived", occurred_at: "2026-10-31T09:10:00Z", actor_user_id: ME },
        { id: "e2", event_type: "work_started", occurred_at: "2026-10-31T09:11:00Z", actor_user_id: ME },
      ],
      audit: [
        { id: "a1", action: "work_order.transitioned", created_at: "2026-10-31T09:30:00Z", new_state: { status: "on_hold" }, old_state: { status: "in_progress" }, reason_code: "awaiting_parts", reason_note: "Compressor ordered", actor_name: "Eli" },
        { id: "a2", action: "work_order.diagnosis_updated", created_at: "2026-10-31T09:20:00Z", new_state: {} },
      ],
      comments: [
        { id: "c1", comment: "Checked the breaker", user_id: ME, created_at: "2026-10-31T09:15:00Z", is_system: false },
        { id: "c2", comment: "Status changed", created_at: "2026-10-31T09:16:00Z", is_system: true },
      ],
      photos: [{ id: "p1", storage_path: "x", photo_type: "before", caption: "Unit", created_at: "2026-10-31T09:12:00Z" }],
    });
    expect(items.map((i) => i.id)).toEqual(["created", "timing-e1", "timing-e2", "photo-p1", "note-c1", "note-c2", "audit-a2", "audit-a1"]);
    const held = items.find((i) => i.id === "audit-a1")!;
    expect(held).toMatchObject({ labelKey: "held", text: "Compressor ordered", actorName: "Eli", machine: true });
    expect(held.params).toEqual({ reason: "awaiting_parts" });
    const mine = items.find((i) => i.id === "note-c1")!;
    expect(mine).toMatchObject({ kind: "note", machine: false, mine: true });
    expect(items.find((i) => i.id === "note-c2")!.machine).toBe(true);
  });

  it("shows resume and escalation from the audit but does not duplicate the claim or completion events", () => {
    const items = buildTimeline({
      timing: [],
      comments: [],
      photos: [],
      audit: [
        { id: "claim", action: "work_order.transitioned", created_at: "2026-10-31T09:00:00Z", old_state: { status: "open" }, new_state: { status: "in_progress" } },
        { id: "done", action: "work_order.transitioned", created_at: "2026-10-31T09:05:00Z", old_state: { status: "in_progress" }, new_state: { status: "completed" } },
        { id: "resume", action: "work_order.transitioned", created_at: "2026-10-31T09:10:00Z", old_state: { status: "on_hold" }, new_state: { status: "in_progress" } },
        { id: "esc", action: "work_order.transitioned", created_at: "2026-10-31T09:20:00Z", old_state: { status: "in_progress" }, new_state: { status: "escalated" }, reason_note: "Needs vendor" },
        { id: "other", action: "work_order.something_else", created_at: "2026-10-31T09:30:00Z" },
      ],
    });
    expect(items.map((i) => [i.id, i.labelKey])).toEqual([
      ["audit-resume", "resumedWork"],
      ["audit-esc", "escalated"],
    ]);
  });

  it("is empty, not invented, when nothing was recorded", () => {
    expect(buildTimeline({ timing: [], audit: [], comments: [], photos: [] })).toEqual([]);
  });
});

describe("parts staging", () => {
  const part = (over: Partial<StagedPart> = {}): StagedPart => ({ partId: "p1", name: "Capacitor", locationId: "l1", quantity: 1, available: 6, ...over });

  it("merges the same part at the same location instead of listing it twice", () => {
    const merged = stagePart([part({ quantity: 1 })], part({ quantity: 2 }));
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(3);
    expect(stagePart(merged, part({ locationId: "l2" }))).toHaveLength(2);
  });

  it("flags bad quantities, missing locations and more than is on hand — but unknown stock is not an error", () => {
    expect(stagedPartIssue(part())).toBeNull();
    expect(stagedPartIssue(part({ quantity: 0 }))).toBe("quantity");
    expect(stagedPartIssue(part({ quantity: Number.NaN }))).toBe("quantity");
    expect(stagedPartIssue(part({ quantity: 7 }))).toBe("overStock");
    expect(stagedPartIssue(part({ locationId: "" }))).toBe("noLocation");
    expect(stagedPartIssue(part({ quantity: 700, available: null }))).toBeNull();
  });
});

describe("completion", () => {
  const code = (over: Partial<RepairCode> = {}): RepairCode => ({ id: "c1", code_type: "resolution", code: "replaced_part", label: "Replaced part", ...over });
  const draft = (over: Partial<CompletionDraft> = {}): CompletionDraft => ({
    ...emptyCompletionDraft(),
    resolutionCodeId: "c1",
    verification: "passed",
    ...over,
  });

  it("is valid with a resolution and a verification result", () => {
    expect(validateCompletion(draft(), { resolution: code() })).toEqual({});
  });

  it("requires a resolution (code or text) and a verification result", () => {
    const errors = validateCompletion(draft({ resolutionCodeId: null, verification: null }), {});
    expect(errors).toMatchObject({ resolution: "resolution", verification: "verification" });
    expect(validateCompletion(draft({ resolutionCodeId: null, resolutionOtherText: "Reset the breaker" }), {})).toEqual({});
  });

  it("requires notes unless the repair simply passed", () => {
    expect(validateCompletion(draft({ verification: "failed" }), { resolution: code() }).verificationNotes).toBe("notes");
    expect(validateCompletion(draft({ verification: "follow_up_required" }), { resolution: code() }).verificationNotes).toBe("notes");
    expect(validateCompletion(draft({ verification: "failed", verificationNotes: "Still warm" }), { resolution: code() })).toEqual({});
  });

  it("requires a description when an Other code is chosen, mirroring the API", () => {
    const other = code({ id: "c9", code: "other_resolution" });
    expect(validateCompletion(draft({ resolutionCodeId: "c9" }), { resolution: other }).resolutionOther).toBe("other");
    expect(validateCompletion(draft({ resolutionCodeId: "c9", resolutionOtherText: "Custom fix" }), { resolution: other })).toEqual({});
  });

  it("blocks completion with a bad staged part", () => {
    const bad: StagedPart = { partId: "p", name: "x", locationId: "l", quantity: 9, available: 2 };
    expect(validateCompletion(draft({ parts: [bad] }), { resolution: code() }).parts).toBe("parts");
  });

  it("builds exactly the API body: structured parts, codes, verification — and drops empty fields", () => {
    const body = buildCompletionBody(
      draft({
        notes: "  Swapped the capacitor ",
        problemCodeId: "p1",
        causeCodeId: "k1",
        verification: "passed",
        assetRestoration: "restore",
        freeTextParts: "",
        parts: [{ partId: "part-1", name: "Cap", locationId: "loc-1", quantity: 2, available: 4 }],
      }),
      { hasAsset: true }
    );
    expect(body).toEqual({
      notes: "Swapped the capacitor",
      problem_code_id: "p1",
      cause_code_id: "k1",
      resolution_code_id: "c1",
      verification_result: "passed",
      asset_restoration: "restore",
      parts_consumed: [{ part_id: "part-1", location_id: "loc-1", quantity: 2 }],
    });
  });

  it("never sends asset_restoration without a linked asset, and never sends parts_consumed when none were chosen", () => {
    const body = buildCompletionBody(draft({ assetRestoration: "restore", freeTextParts: "zip ties" }), { hasAsset: false });
    expect(body).not.toHaveProperty("asset_restoration");
    expect(body).not.toHaveProperty("parts_consumed");
    expect(body.parts_used).toBe("zip ties");
  });

  it("keeps historical free-text parts when seeding a draft from an existing order", () => {
    expect(emptyCompletionDraft({ parts_used: "Belt A-4L360" }).freeTextParts).toBe("Belt A-4L360");
  });
});

describe("interpretCompletionError", () => {
  // ApiError is a plain Error carrying `status`; building it here keeps the Supabase client out of this pure test.
  const err = (status: number, message: string) => Object.assign(new Error(message), { status });

  it("treats the API's failed-verification 409 as a recorded outcome, not a success and not a crash", () => {
    expect(interpretCompletionError(err(409, "Repair verification failed. The work order remains in progress."), { verification: "failed" })).toEqual({ kind: "verification_failed" });
  });

  it("any other 409 is a conflict (someone changed the order)", () => {
    const outcome = interpretCompletionError(err(409, "Cannot transition a work order from completed to completed"), { verification: "passed" });
    expect(outcome.kind).toBe("conflict");
    // The failed-verification text only counts when the person chose Failed.
    expect(interpretCompletionError(err(409, "Repair verification failed."), { verification: "passed" }).kind).toBe("conflict");
  });

  it("maps 422 messages onto fields", () => {
    const outcome = interpretCompletionError(err(422, "Describe the selected Other resolution"), { verification: "passed" });
    expect(outcome).toMatchObject({ kind: "rejected", errors: { resolutionOther: "other" } });
    expect(interpretCompletionError(err(422, "Insufficient stock for Capacitor"), { verification: "passed" })).toMatchObject({ errors: { parts: "stock" } });
  });

  it("everything else is a plain failure that keeps the message", () => {
    expect(interpretCompletionError(new Error("Request timed out."), { verification: "passed" })).toEqual({ kind: "failed", message: "Request timed out." });
  });
});

describe("offlineCompletionBlock", () => {
  it("lets a plain completion queue", () => {
    expect(offlineCompletionBlock({ parts: [], verification: "passed" })).toBeNull();
    expect(offlineCompletionBlock({ parts: [], verification: "follow_up_required" })).toBeNull();
  });

  it("requires a connection when inventory moves or a test failed", () => {
    expect(offlineCompletionBlock({ parts: [{ partId: "p", name: "x", locationId: "l", quantity: 1, available: 1 }], verification: "passed" })).toBe("parts");
    expect(offlineCompletionBlock({ parts: [], verification: "failed" })).toBe("failedVerification");
  });
});
