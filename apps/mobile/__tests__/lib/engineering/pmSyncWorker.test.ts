import { adaptPmTemplates, newDraft } from "@/lib/engineering/pmChecklist";
import { freezeCompletion, isIntact, type QueuedPmCompletion } from "@/lib/engineering/pmCompletionQueue";
import { PmCompletionBlockedError, type PmCompletionPayload, type PmCompletionResult } from "@/lib/engineering/pmCompletion";
import { buildReplayPayload, createBackoff, replayCompletion, retryDelayMs, stopForCompletionError, type SyncDeps } from "@/lib/engineering/pmSyncWorker";

const template = adaptPmTemplates([{ id: "t1", name: "Boiler", version: 3, items: { checklist: [{ key: "leak", label: "Leaks", requires_evidence: true }, { label: "Gauge" }] } }])[0];

function frozen(extra: { photos?: boolean } = {}): QueuedPmCompletion {
  const draft = newDraft("s1", template, new Date("2026-03-01T08:00:00Z"));
  draft.items.i0 = { result: "passed", note: "", evidence: [{ id: "local:aa", uri: "file:///docs/pm-evidence/t1_u1/aa.jpg", local: { bytes: 100 } }] };
  draft.items.i1 = { result: "passed", note: "", evidence: [] };
  if (extra.photos) draft.photos = [{ id: "local:bb", uri: "file:///docs/pm-evidence/t1_u1/bb.jpg", local: { bytes: 90 } }];
  return freezeCompletion({ draft, template, meters: [], schedule: { id: "s1", assetId: "a1", name: "Boiler PM" }, submissionId: "11111111-2222-3333-4444-555555555555", now: new Date("2026-03-01T09:00:00Z") });
}

const apiError = (status: number, detail?: unknown) => Object.assign(new Error(`HTTP ${status}`), { status, detail });
const netError = () => new TypeError("Network request failed");

/** A tiny fake server plus the phone's stored row, so a replay can be run again from whatever the last one saved. */
function world(over: Partial<SyncDeps> = {}) {
  const state = { owner: "t1:u1" as string | null, row: frozen({ photos: true }), records: new Map<string, { storage_path?: string | null; related_entity_id?: string }>(), nextId: 1, posted: [] as PmCompletionPayload[], created: 0, uploaded: [] as string[], deleted: [] as string[], logs: [] as string[], files: new Set<string>(), completions: [] as Array<{ id: string; technician_id: string | null; completed_at: string }> };
  state.files.add("file:///docs/pm-evidence/t1_u1/aa.jpg").add("file:///docs/pm-evidence/t1_u1/bb.jpg");
  const result: PmCompletionResult = { id: "c1", pm_schedule_id: "s1", completed_at: "2026-03-01T10:00:00Z" };
  const deps: SyncDeps = {
    owner: () => state.owner,
    currentUserId: () => "u1",
    createEvidence: async () => {
      state.created += 1;
      const id = `ev${state.nextId++}`;
      state.records.set(id, { related_entity_id: "a1" });
      return id;
    },
    uploadFile: async (id) => {
      state.uploaded.push(id);
      state.records.get(id)!.storage_path = `evidence/${id}.jpg`;
    },
    getEvidence: async (id) => {
      const r = state.records.get(id);
      if (!r) throw apiError(404);
      return r;
    },
    deleteEvidence: async (id) => void state.deleted.push(id),
    complete: async (_s, payload) => {
      state.posted.push(payload);
      return result;
    },
    listCompletions: async () => state.completions,
    fileReadable: async (uri) => state.files.has(uri),
    save: async (_id, current, change) => {
      state.row = { ...current, ...change };
      return state.row;
    },
    log: (e) => void state.logs.push(e),
    ...over,
  };
  return { state, deps, run: () => replayCompletion(7, state.row, deps) };
}

describe("freezing a completion", () => {
  it("keeps local ids in the body, lists the photos once, and fingerprints the content", () => {
    const q = frozen({ photos: true });
    expect(q.body.items[0].evidence).toEqual(["local:aa"]);
    expect(q.body.photos).toEqual(["local:bb"]);
    expect(q.evidence.map((e) => e.localId)).toEqual(["local:aa", "local:bb"]);
    expect(q.phase).toBe("queued");
    expect(isIntact(q)).toBe(true);
    expect(isIntact({ ...q, body: { ...q.body, notes: "changed" } })).toBe(false);
  });

  it("still blocks an incomplete inspection (nothing defaults to a pass)", () => {
    const draft = newDraft("s1", template);
    expect(() => freezeCompletion({ draft, template, meters: [], schedule: { id: "s1", assetId: "a1", name: "x" }, submissionId: "id" })).toThrow(PmCompletionBlockedError);
  });

  it("can never be sent while a photo is still only on the phone", () => {
    expect(() => buildReplayPayload(frozen())).toThrow();
  });
});

describe("replaying a queued completion", () => {
  it("uploads photos first, swaps local ids for record ids, and posts once under the frozen submission id", async () => {
    const w = world();
    const outcome = await w.run();
    expect(outcome.kind).toBe("recorded");
    expect(w.state.created).toBe(2);
    expect(w.state.posted).toHaveLength(1);
    const sent = w.state.posted[0];
    expect(sent.submission_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(sent.items[0].evidence).toEqual(["ev1"]);
    expect(sent.photos).toEqual(["ev2"]);
    expect(JSON.stringify(sent)).not.toContain("local:");
    expect(w.state.logs).toEqual(expect.arrayContaining(["evidence_upload_confirmed", "completion_submitted", "queue_item_resolved"]));
  });

  it("a lost reply to the completion is retried under the same id and never uploads a photo twice", async () => {
    let calls = 0;
    const w = world();
    w.deps.complete = async (_s, payload) => {
      w.state.posted.push(payload);
      if (++calls === 1) throw netError();
      return { id: "c1", pm_schedule_id: "s1", completed_at: "x", replayed: true };
    };
    const first = await w.run();
    expect(first.kind).toBe("retry");
    expect(w.state.row.phase).toBe("unknown");
    expect(w.state.logs).toContain("completion_outcome_unknown");
    const createdBefore = w.state.created;
    const second = await replayCompletion(7, w.state.row, w.deps);
    expect(second.kind).toBe("recorded");
    expect(w.state.created).toBe(createdBefore);
    expect(w.state.uploaded).toHaveLength(2);
    expect(w.state.posted.map((p) => p.submission_id)).toEqual(Array(2).fill("11111111-2222-3333-4444-555555555555"));
    expect(w.state.logs).toContain("completion_reconciled");
  });

  it("after a crash between creating a record and sending its file, the same record is reused", async () => {
    const w = world();
    let fail = true;
    const realUpload = w.deps.uploadFile;
    w.deps.uploadFile = async (id, uri) => {
      if (fail) throw netError();
      return realUpload(id, uri);
    };
    expect((await w.run()).kind).toBe("retry");
    expect(w.state.row.evidence[0].serverId).toBe("ev1");
    fail = false;
    expect((await replayCompletion(7, w.state.row, w.deps)).kind).toBe("recorded");
    expect(w.state.created).toBe(2);
  });

  it("when the file did land but the reply was lost, it is recognised and not sent again", async () => {
    const w = world();
    const realUpload = w.deps.uploadFile;
    let first = true;
    w.deps.uploadFile = async (id, uri) => {
      await realUpload(id, uri);
      if (first) {
        first = false;
        throw netError();
      }
    };
    expect((await w.run()).kind).toBe("retry");
    expect((await replayCompletion(7, w.state.row, w.deps)).kind).toBe("recorded");
    expect(w.state.uploaded.filter((id) => id === "ev1")).toHaveLength(1);
  });

  it("never reuses an evidence record that belongs to a different asset", async () => {
    const w = world();
    w.state.row = { ...w.state.row, evidence: w.state.row.evidence.map((e, i) => (i === 0 ? { ...e, serverId: "foreign" } : e)) };
    w.state.records.set("foreign", { related_entity_id: "other-asset" });
    expect((await w.run()).kind).toBe("recorded");
    expect(w.state.uploaded).not.toContain("foreign");
  });

  it("stops for review - before uploading anything - when another technician already recorded it", async () => {
    const w = world();
    w.state.completions = [{ id: "c0", technician_id: "someone-else", completed_at: "2026-03-01T08:30:00Z" }];
    const outcome = await w.run();
    expect(outcome).toEqual({ kind: "stopped", code: "conflict_completed" });
    expect(w.state.created).toBe(0);
    expect(w.state.posted).toHaveLength(0);
    expect(w.state.row.stop).toBe("conflict_completed");
    expect(w.state.row.evidence).toHaveLength(2);
    expect(w.state.logs).toContain("conflict_detected");
  });

  it("an earlier completion, or the person's own, is not a conflict; acknowledging one lets it through", async () => {
    const earlier = world();
    earlier.state.completions = [{ id: "c0", technician_id: "x", completed_at: "2026-02-01T00:00:00Z" }, { id: "c1", technician_id: "u1", completed_at: "2026-03-01T09:30:00Z" }];
    expect((await earlier.run()).kind).toBe("recorded");
    const acked = world();
    acked.state.completions = [{ id: "c0", technician_id: "x", completed_at: "2026-03-01T08:30:00Z" }];
    acked.state.row = { ...acked.state.row, conflictAcknowledged: true };
    expect((await acked.run()).kind).toBe("recorded");
  });

  it("flags a missing photo file instead of sending a completion without its evidence", async () => {
    const w = world();
    w.state.files.delete("file:///docs/pm-evidence/t1_u1/bb.jpg");
    expect(await w.run()).toEqual({ kind: "stopped", code: "evidence_missing" });
    expect(w.state.posted).toHaveLength(0);
  });

  it("pauses without touching anything when the person or hotel changes", async () => {
    const w = world();
    w.state.owner = null;
    expect(await w.run()).toEqual({ kind: "paused", reason: "signed_out" });
    const switched = world();
    const real = switched.deps.createEvidence;
    switched.deps.createEvidence = async (i) => {
      const id = await real(i);
      switched.state.owner = "t2:u1";
      return id;
    };
    expect(await switched.run()).toEqual({ kind: "paused", reason: "owner_changed" });
    expect(switched.state.posted).toHaveLength(0);
  });

  it("refuses to replay a body that no longer matches what was confirmed", async () => {
    const w = world();
    w.state.row = { ...w.state.row, body: { ...w.state.row.body, notes: "edited after the fact" } };
    expect(await w.run()).toEqual({ kind: "stopped", code: "invalid" });
    expect(w.state.posted).toHaveLength(0);
  });

  it("maps definitive refusals to a stop and trouble to a retry", async () => {
    const cases: Array<[unknown, string]> = [
      [apiError(403), "forbidden"],
      [apiError(404), "schedule_gone"],
      [apiError(409, { code: "checklist_unavailable" }), "checklist_unavailable"],
      [apiError(409, { code: "schedule_inactive" }), "schedule_gone"],
      [apiError(409, { code: "submission_conflict" }), "invalid"],
      [apiError(409), "conflict_changed"],
      [apiError(422), "invalid"],
    ];
    for (const [err, code] of cases) {
      const w = world({ complete: async () => Promise.reject(err) });
      expect(await w.run()).toEqual({ kind: "stopped", code });
      expect(w.state.row.stop).toBe(code);
    }
    for (const err of [apiError(500), apiError(502), apiError(503), netError()]) {
      const w = world({ complete: async () => Promise.reject(err) });
      expect((await w.run()).kind).toBe("retry");
      expect(w.state.row.phase).toBe("unknown");
      expect(w.state.row.stop ?? null).toBeNull();
    }
    expect(await world({ complete: async () => Promise.reject(apiError(401)) }).run()).toEqual({ kind: "paused", reason: "session" });
  });

  it("drops a photo the server will never accept and keeps everything else", async () => {
    const w = world({ uploadFile: async () => Promise.reject(apiError(413)) });
    expect(await w.run()).toEqual({ kind: "stopped", code: "evidence_rejected" });
    expect(w.state.deleted).toContain("ev1");
    expect(w.state.posted).toHaveLength(0);
  });

  it("starts a photo over on a new record after repeated server errors", async () => {
    const w = world({ uploadFile: async () => Promise.reject(apiError(500)) });
    await w.run();
    expect(w.state.row.evidence[0].failures).toBe(1);
    await replayCompletion(7, w.state.row, w.deps);
    expect(w.state.deleted).toContain("ev1");
    expect(w.state.row.evidence[0].serverId).toBeUndefined();
  });
});

describe("error mapping and backoff", () => {
  it("never treats a 5xx or a network failure as a stop", () => {
    expect(stopForCompletionError(apiError(500))).toBeNull();
    expect(stopForCompletionError(netError())).toBeNull();
    expect(stopForCompletionError(apiError(401))).toBe("session");
  });

  it("backs off exponentially, with bounded jitter and a ceiling", () => {
    expect(retryDelayMs(0, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(1, () => 0.5)).toBe(60_000);
    expect(retryDelayMs(20, () => 0.5)).toBe(30 * 60_000);
    expect(retryDelayMs(2, () => 0)).toBe(96_000);
    expect(retryDelayMs(2, () => 1)).toBe(144_000);
  });

  it("holds a failed item until its time, and a reconnect burst finds it not due", () => {
    let t = 1_000;
    const backoff = createBackoff(() => t, () => 0.5);
    expect(backoff.due(1)).toBe(true);
    backoff.failed(1, 0);
    expect(backoff.due(1)).toBe(false);
    t += 29_999;
    expect(backoff.due(1)).toBe(false);
    t += 2;
    expect(backoff.due(1)).toBe(true);
    backoff.failed(1, 3);
    backoff.clear(1);
    expect(backoff.due(1)).toBe(true);
  });
});
