import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deletePmEvidence, listAssetMeters, listPmTemplates, submitPmCompletion, uploadPmEvidence, type PmCompletionResult } from "@/lib/api/pm";
import { useAppStore } from "@/stores/appStore";
import {
  adaptPmTemplates,
  buildCompletionPayload,
  draftCompatibility,
  draftHasContent,
  newDraft,
  pmProgress,
  rebaseDraft,
  validateInspection,
  type DraftCompatibility,
  type PmDraft,
  type PmDraftItem,
  type PmInspectionIssue,
  type PmProgress,
  type PmTemplate,
} from "./pmChecklist";
import { adaptPmMeters, type PmMeter } from "./pmReadings";
import { clearPmDraft, loadPmDraft, savePmDraft } from "./pmDraftStore";
import { classifyLoadFailure, type LoadFailure } from "./loadState";
import type { PmItemResult } from "./pmCompletion";
import type { PmScheduleView } from "./pmSchedules";

const AUTOSAVE_MS = 400;

export type SubmitOutcome =
  | { kind: "recorded"; result: PmCompletionResult }
  /** The request may or may not have landed and could not be confirmed either way. */
  | { kind: "unknown"; error: unknown }
  | { kind: "refused"; error: unknown }
  | { kind: "blocked"; issues: PmInspectionIssue[] };

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
  submitting: boolean;
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

  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [templates, setTemplates] = useState<PmTemplate[]>([]);
  const [meters, setMeters] = useState<PmMeter[]>([]);
  const [draft, setDraft] = useState<PmDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);

  const draftRef = useRef<PmDraft | null>(null);
  draftRef.current = draft;
  const submitLock = useRef(false);
  /** Start time of an attempt whose outcome could not be confirmed; the next press checks it before posting again. */
  const unknownSince = useRef<number | null>(null);
  const uploadLocks = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removed = useRef(false);

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
    (async () => {
      const [tpl, met, saved] = await Promise.allSettled([
        listPmTemplates(),
        assetId ? listAssetMeters(assetId) : Promise.resolve([]),
        loadPmDraft(scheduleId),
      ]);
      if (cancelled) return;
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
      if (restored) setDraft(restored);
      else if (adapted.length === 1) setDraft(newDraft(scheduleId, adapted[0]));
      else setDraft(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleId, assetId, reloadTick]);

  // Autosave: an untouched draft is not stored; an emptied one is removed.
  useEffect(() => {
    if (!draft || !scheduleId) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (draftHasContent(draft) ? savePmDraft(draft) : clearPmDraft(scheduleId));
    }, AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, scheduleId]);

  // Leaving the screen flushes the latest draft immediately so nothing typed in the last moment is lost.
  useEffect(
    () => () => {
      const latest = draftRef.current;
      if (latest && draftHasContent(latest)) void savePmDraft(latest);
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
      const picked = templates.find((t) => t.id === templateId);
      if (picked && scheduleId) setDraft(newDraft(scheduleId, picked));
    },
    [templates, scheduleId],
  );

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
    setDraft(templates.length === 1 ? newDraft(scheduleId, templates[0]) : null);
    // Evidence the technician is walking away from should not linger unreferenced.
    if (abandoned) {
      const ids = [...abandoned.photos.map((p) => p.id), ...Object.values(abandoned.items).flatMap((i) => i.evidence.map((e) => e.id))];
      await Promise.all(ids.map((id) => deletePmEvidence(id)));
    }
  }, [scheduleId, templates]);

  const attachPhoto = useCallback(
    async (slot: string, uri: string, label: string, signal?: AbortSignal) => {
      if (!assetId) throw new Error("no asset");
      if (uploadLocks.current.has(slot)) return; // one upload per slot at a time: a double tap cannot attach twice
      uploadLocks.current.add(slot);
      setUploading(new Set(uploadLocks.current));
      try {
        const id = await uploadPmEvidence({ assetId, uri, label, signal });
        if (removed.current) return;
        const ref = { id, uri };
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
      if (slot === "general") patch((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== evidenceId) }));
      else patch((d) => ({ ...d, items: { ...d.items, [slot]: { ...d.items[slot], evidence: (d.items[slot]?.evidence ?? []).filter((e) => e.id !== evidenceId) } } }));
      await deletePmEvidence(evidenceId);
    },
    [patch],
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
      const payload = buildCompletionPayload(template, current, meters);
      const result = await submitPmCompletion(scheduleId, payload, { userId, attemptStartedAt, unknownSince: unknownSince.current });
      unknownSince.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await clearPmDraft(scheduleId);
      // The inspection is recorded: drop the in-memory copy too, or leaving the screen would re-save it as a draft.
      draftRef.current = null;
      if (!removed.current) setDraft(null);
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
  }, [template, scheduleId, userId, compatibility, meters]);

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
    submitting,
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
