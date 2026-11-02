import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deletePmEvidence, listAssetMeters, listPmTemplates, submitPmCompletion, uploadPmEvidence, type PmCompletionResult } from "@/lib/api/pm";
import { useAppStore } from "@/stores/appStore";
import {
  adaptPmTemplates,
  buildCompletionPayload,
  draftCompatibility,
  draftHasContent,
  isLocalPhoto,
  localPhotoRefs,
  newDraft,
  pmProgress,
  rebaseDraft,
  validateInspection,
  type DraftCompatibility,
  type PmDraft,
  type PmDraftItem,
  type PmEvidenceRef,
  type PmInspectionIssue,
  type PmProgress,
  type PmTemplate,
} from "./pmChecklist";
import { adaptPmMeters, type PmMeter } from "./pmReadings";
import { UNASSIGNED_CHECKLIST, checklistNeedsAttention, type PmChecklistBinding } from "./engineeringContracts";
import { resolveSubmission } from "./pmSubmission";
import { clearPmDraft, loadPmDraft, savePmDraft } from "./pmDraftStore";
import { enqueueCompletion, freezeCompletion, queuedCompletionFor, type QueuedPmRow } from "./pmCompletionQueue";
import { localPhotoReadable, persistPmPhoto, removeLocalPhoto, type LocalPhotoFailure } from "./pmLocalEvidence";
import { flushPmCompletions } from "./pmSyncRunner";
import { classifyLoadFailure, type LoadFailure } from "./loadState";
import type { PmItemResult } from "./pmCompletion";
import type { PmScheduleView } from "./pmSchedules";

const AUTOSAVE_MS = 400;

/** "idle" = nothing worth keeping yet; "failed" = the phone could not store it (it is still on screen). */
export type DraftSaveState = "idle" | "saving" | "saved" | "failed";

export type SubmitOutcome =
  | { kind: "recorded"; result: PmCompletionResult }
  /** The request may or may not have landed and could not be confirmed either way. */
  | { kind: "unknown"; error: unknown }
  | { kind: "refused"; error: unknown }
  | { kind: "blocked"; issues: PmInspectionIssue[] }
  /** Frozen and saved on this phone for a later send. NOT recorded: the server has not seen it. */
  | { kind: "queued" }
  /** A photo file on this phone is gone or unreadable, so the inspection cannot be sent with its evidence. */
  | { kind: "photo_missing" }
  /** This schedule already has a saved inspection waiting; a second one would be a second logical completion. */
  | { kind: "already_queued" }
  | { kind: "queue_failed" };

/** A photo could not be kept on this phone (thrown by attachPhoto; the draft is unchanged). */
export class LocalPhotoError extends Error {
  readonly reason: LocalPhotoFailure;
  constructor(reason: LocalPhotoFailure) {
    super(`local photo not saved: ${reason}`);
    this.name = "LocalPhotoError";
    this.reason = reason;
  }
}

/** A failure with no HTTP answer: the phone could not reach the server (as opposed to the server refusing). */
const isUnreachable = (err: unknown): boolean => {
  if ((err as { name?: string } | null)?.name === "AbortError") return false;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status !== "number" || status === 0;
};

export interface PmInspection {
  loading: boolean;
  failure: LoadFailure | null;
  templates: PmTemplate[];
  template: PmTemplate | null;
  meters: PmMeter[];
  draft: PmDraft | null;
  compatibility: DraftCompatibility;
  progress: PmProgress | null;
  issues: PmInspectionIssue[];
  /**
   * Set when the schedule is bound to a checklist that cannot be used (missing, retired, wrong kind) and no draft is
   * under way. The inspection cannot start; a manager has to fix the binding. Never replaced by a guessed checklist.
   */
  checklistIssue: PmChecklistBinding | null;
  submitting: boolean;
  /** A completion already frozen for this schedule and waiting to be sent (or needing review). Null when none. */
  queued: QueuedPmRow | null;
  /** Whether the latest edit is safely stored on this phone. Local only: never a statement about the server. */
  saveState: DraftSaveState;
  /** Evidence slots currently uploading (`itemId` or `"general"`). */
  uploading: ReadonlySet<string>;
  reload: () => void;
  chooseTemplate: (templateId: string) => void;
  useCurrentChecklist: () => void;
  discard: () => Promise<void>;
  patch: (fn: (draft: PmDraft) => PmDraft) => void;
  setResult: (itemId: string, result: PmItemResult | null) => void;
  patchItem: (itemId: string, patch: Partial<PmDraftItem>) => void;
  attachPhoto: (slot: string, uri: string, label: string, signal?: AbortSignal) => Promise<void>;
  removePhoto: (slot: string, evidenceId: string) => Promise<void>;
  submit: () => Promise<SubmitOutcome>;
}

/**
 * One inspection session for a schedule: the checklist templates and the asset's meters from the API, the technician's
 * local draft (saved as they type, restored after a restart), evidence uploads, and the single guarded completion call.
 */
export function usePmInspection(schedule: PmScheduleView | null): PmInspection {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const scheduleId = schedule?.id ?? null;
  const assetId = schedule?.assetId ?? null;
  const scheduleCaption = schedule ? (schedule.assetName ? `${schedule.assetName} - ${schedule.name}` : schedule.name) : "";
  const binding = schedule?.checklist ?? UNASSIGNED_CHECKLIST;
  const bindingState = binding.state;
  const boundTemplateId = binding.templateId;

  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [templates, setTemplates] = useState<PmTemplate[]>([]);
  const [meters, setMeters] = useState<PmMeter[]>([]);
  const [draft, setDraft] = useState<PmDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState<QueuedPmRow | null>(null);
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");

  const draftRef = useRef<PmDraft | null>(null);
  draftRef.current = draft;
  const submitLock = useRef(false);
  /** Start time of an attempt whose outcome could not be confirmed; the next press checks it before posting again. */
  const unknownSince = useRef<number | null>(null);
  const uploadLocks = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removed = useRef(false);
  /** The person this draft was loaded for. A draft is never written under anyone else's name. */
  const draftOwner = useRef<string | null>(null);
  const sameOwner = () => draftOwner.current != null && draftOwner.current === useAppStore.getState().user?.id;

  useEffect(() => {
    removed.current = false;
    return () => {
      removed.current = true;
    };
  }, []);

  useEffect(() => {
    if (!scheduleId) return undefined;
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    // Another person (or property) signing in on this screen never sees, or saves over, the previous person's draft.
    draftOwner.current = userId;
    draftRef.current = null;
    setDraft(null);
    setSaveState("idle");
    (async () => {
      const [tpl, met, saved, waiting] = await Promise.allSettled([
        listPmTemplates(),
        assetId ? listAssetMeters(assetId) : Promise.resolve([]),
        loadPmDraft(scheduleId),
        queuedCompletionFor(scheduleId),
      ]);
      if (cancelled) return;
      setQueued(waiting.status === "fulfilled" ? waiting.value : null);
      // The checklist is the inspection: without it nothing can start. Meters are optional extras and fail softly.
      if (tpl.status === "rejected") {
        setFailure(classifyLoadFailure(tpl.reason));
        setLoading(false);
        return;
      }
      const adapted = adaptPmTemplates(tpl.value);
      setTemplates(adapted);
      setMeters(met.status === "fulfilled" ? adaptPmMeters(met.value) : []);
      const restored = saved.status === "fulfilled" ? saved.value : null;
      // A bound schedule opens its own procedure; only an unconfigured (legacy) one asks the technician to choose.
      const bound = bindingState === "ready" ? adapted.find((t) => t.id === boundTemplateId) : undefined;
      if (restored) setDraft(restored);
      else if (bound) setDraft(newDraft(scheduleId, bound));
      else if (bindingState === "unassigned" && adapted.length === 1) setDraft(newDraft(scheduleId, adapted[0]));
      else setDraft(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleId, assetId, reloadTick, bindingState, boundTemplateId, userId]);

  // Autosave: an untouched draft is not stored; an emptied one is removed.
  useEffect(() => {
    if (!draft || !scheduleId) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (draftHasContent(draft)) setSaveState("saving");
    saveTimer.current = setTimeout(() => {
      if (!sameOwner()) return;
      if (!draftHasContent(draft)) {
        void clearPmDraft(scheduleId);
        if (!removed.current) setSaveState("idle");
        return;
      }
      void savePmDraft(draft.label || !scheduleCaption ? draft : { ...draft, label: scheduleCaption }).then((stored) => {
        if (!removed.current && draftRef.current === draft) setSaveState(stored ? "saved" : "failed");
      });
    }, AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, scheduleId, scheduleCaption]);

  // Leaving the screen flushes the latest draft immediately so nothing typed in the last moment is lost.
  useEffect(
    () => () => {
      const latest = draftRef.current;
      if (latest && draftHasContent(latest) && sameOwner()) void savePmDraft(latest);
    },
    [],
  );

  const template = useMemo(() => (draft ? templates.find((t) => t.id === draft.templateId) ?? null : null), [templates, draft]);
  const compatibility: DraftCompatibility = draft ? draftCompatibility(draft, template ?? undefined) : "ok";
  const progress = useMemo(() => (draft && template ? pmProgress(template, draft) : null), [draft, template]);
  const issues = useMemo(() => (draft && template ? validateInspection(template, draft, meters) : []), [draft, template, meters]);

  const patch = useCallback((fn: (d: PmDraft) => PmDraft) => {
    setDraft((current) => (current ? { ...fn(current), updatedAt: new Date().toISOString() } : current));
  }, []);

  const patchItem = useCallback(
    (itemId: string, change: Partial<PmDraftItem>) =>
      patch((d) => ({ ...d, items: { ...d.items, [itemId]: { ...(d.items[itemId] ?? { result: null, note: "", evidence: [] }), ...change } } })),
    [patch],
  );

  const setResult = useCallback((itemId: string, result: PmItemResult | null) => patchItem(itemId, { result }), [patchItem]);

  const chooseTemplate = useCallback(
    (templateId: string) => {
      if (bindingState !== "unassigned") return; // a bound schedule's procedure is not the technician's choice
      const picked = templates.find((t) => t.id === templateId);
      if (picked && scheduleId) setDraft(newDraft(scheduleId, picked));
    },
    [templates, scheduleId, bindingState],
  );

  const checklistIssue = useMemo((): PmChecklistBinding | null => {
    if (draft || loading || failure) return null;
    if (checklistNeedsAttention(binding)) return binding;
    // Bound and "ready", yet not among the active templates: it was retired since the list loaded.
    if (binding.state === "ready" && !templates.some((t) => t.id === binding.templateId)) return { ...binding, state: "missing" };
    return null;
  }, [draft, loading, failure, binding, templates]);

  const useCurrentChecklist = useCallback(() => {
    setDraft((current) => {
      const fresh = current ? templates.find((t) => t.id === current.templateId) : undefined;
      return current && fresh ? rebaseDraft(current, fresh) : current;
    });
  }, [templates]);

  const discard = useCallback(async () => {
    if (!scheduleId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const abandoned = draftRef.current;
    await clearPmDraft(scheduleId);
    const bound = bindingState === "ready" ? templates.find((t) => t.id === boundTemplateId) : undefined;
    setDraft(bound ? newDraft(scheduleId, bound) : bindingState === "unassigned" && templates.length === 1 ? newDraft(scheduleId, templates[0]) : null);
    // Evidence the technician is walking away from should not linger unreferenced.
    if (abandoned) {
      const refs = [...abandoned.photos, ...Object.values(abandoned.items).flatMap((i) => i.evidence)];
      await Promise.all(refs.map((ref) => (isLocalPhoto(ref) ? (ref.uri ? removeLocalPhoto(ref.uri) : Promise.resolve(false)) : deletePmEvidence(ref.id))));
    }
  }, [scheduleId, templates, bindingState, boundTemplateId]);

  const attachPhoto = useCallback(
    async (slot: string, uri: string, label: string, signal?: AbortSignal) => {
      if (!assetId) throw new Error("no asset");
      if (uploadLocks.current.has(slot)) return; // one upload per slot at a time: a double tap cannot attach twice
      uploadLocks.current.add(slot);
      setUploading(new Set(uploadLocks.current));
      try {
        let ref: PmEvidenceRef | null = null;
        // Online: the server holds it at once. Offline - or when the server cannot be reached - the photo is copied into
        // the app's own folder and marked as living only on this phone (it is uploaded later, in order, by the sync).
        if (useAppStore.getState().isOnline !== false) {
          try {
            ref = { id: await uploadPmEvidence({ assetId, uri, label, signal }), uri };
          } catch (err) {
            if (!isUnreachable(err)) throw err;
          }
        }
        if (!ref) {
          const saved = await persistPmPhoto(uri);
          if (!saved.ok) throw new LocalPhotoError(saved.reason);
          ref = { id: saved.photo.id, uri: saved.photo.uri, local: { bytes: saved.photo.bytes } };
        }
        if (removed.current) return;
        if (slot === "general") patch((d) => ({ ...d, photos: [...d.photos, ref] }));
        else patch((d) => ({ ...d, items: { ...d.items, [slot]: { ...d.items[slot], evidence: [...(d.items[slot]?.evidence ?? []), ref] } } }));
      } finally {
        uploadLocks.current.delete(slot);
        if (!removed.current) setUploading(new Set(uploadLocks.current));
      }
    },
    [assetId, patch],
  );

  const removePhoto = useCallback(
    async (slot: string, evidenceId: string) => {
      const uri = (slot === "general" ? draftRef.current?.photos : draftRef.current?.items[slot]?.evidence)?.find((e) => e.id === evidenceId)?.uri;
      if (slot === "general") patch((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== evidenceId) }));
      else patch((d) => ({ ...d, items: { ...d.items, [slot]: { ...d.items[slot], evidence: (d.items[slot]?.evidence ?? []).filter((e) => e.id !== evidenceId) } } }));
      if (evidenceId.startsWith("local:")) {
        if (uri) await removeLocalPhoto(uri);
        return;
      }
      await deletePmEvidence(evidenceId);
    },
    [patch],
  );

  /** Freezes the validated draft into the shared offline queue. The draft is cleared only once the queue row exists. */
  const queueForSync = useCallback(
    async (current: PmDraft): Promise<SubmitOutcome> => {
      if (!template || !scheduleId || !assetId) return { kind: "queue_failed" };
      for (const ref of localPhotoRefs(current)) {
        if (!ref.uri || !(await localPhotoReadable(ref.uri))) return { kind: "photo_missing" };
      }
      const built = buildCompletionPayload(template, current, meters, { allowLocalEvidence: true });
      const submission = resolveSubmission(current.submission, built);
      const frozen = freezeCompletion({
        draft: current,
        template,
        meters,
        schedule: { id: scheduleId, assetId, name: scheduleCaption },
        submissionId: submission.id,
      });
      const saved = await enqueueCompletion(frozen);
      if (!saved.ok) return saved.reason === "already_queued" ? { kind: "already_queued" } : { kind: "queue_failed" };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await clearPmDraft(scheduleId); // photo files stay: the queued row now refers to them
      draftRef.current = null;
      const row = await queuedCompletionFor(scheduleId);
      if (!removed.current) {
        setDraft(null);
        setSaveState("idle");
        setQueued(row);
      }
      void flushPmCompletions(); // does nothing without a connection
      return { kind: "queued" };
    },
    [template, scheduleId, assetId, meters, scheduleCaption],
  );

  const submit = useCallback(async (): Promise<SubmitOutcome> => {
    const current = draftRef.current;
    if (!current || !template || !scheduleId || !userId) return { kind: "blocked", issues: [] };
    if (compatibility !== "ok") return { kind: "blocked", issues: [] };
    if (submitLock.current) return { kind: "blocked", issues: [] }; // a second press while one is in flight
    const found = validateInspection(template, current, meters);
    if (found.length > 0) return { kind: "blocked", issues: found };
    submitLock.current = true;
    setSubmitting(true);
    const attemptStartedAt = Date.now();
    try {
      // No connection, or a photo that is still only on this phone: the inspection is frozen and saved for the sync.
      // That is "waiting to sync", never "completed" - the server has not seen it.
      if (useAppStore.getState().isOnline === false || localPhotoRefs(current).length > 0) return await queueForSync(current);
      const built = buildCompletionPayload(template, current, meters);
      // The same content keeps the same submission id (even after a restart), so a retry can never record it twice.
      const submission = resolveSubmission(current.submission, built);
      if (current.submission?.id !== submission.id) {
        const stamped = { ...current, submission };
        draftRef.current = stamped;
        await savePmDraft(stamped);
        if (!removed.current) setDraft(stamped);
      }
      const payload = { ...built, submission_id: submission.id };
      const result = await submitPmCompletion(scheduleId, payload, { userId, attemptStartedAt, unknownSince: unknownSince.current });
      unknownSince.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await clearPmDraft(scheduleId);
      // The inspection is recorded: drop the in-memory copy too, or leaving the screen would re-save it as a draft.
      draftRef.current = null;
      if (!removed.current) {
        setDraft(null);
        setSaveState("idle");
      }
      return { kind: "recorded", result };
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      if (typeof status === "number" && status >= 400 && status < 500) return { kind: "refused", error: err };
      unknownSince.current = unknownSince.current ?? attemptStartedAt;
      return { kind: "unknown", error: err };
    } finally {
      submitLock.current = false;
      if (!removed.current) setSubmitting(false);
    }
  }, [template, scheduleId, userId, compatibility, meters, queueForSync]);

  return {
    loading,
    failure,
    templates,
    template,
    meters,
    draft,
    compatibility,
    progress,
    issues,
    checklistIssue,
    submitting,
    queued,
    saveState,
    uploading,
    reload: () => setReloadTick((n) => n + 1),
    chooseTemplate,
    useCurrentChecklist,
    discard,
    patch,
    setResult,
    patchItem,
    attachPhoto,
    removePhoto,
    submit,
  };
}
