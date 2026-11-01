import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createWorkOrderDetailed, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { getActiveRoomPeriod, listAvailabilityReasons } from "@/lib/api/engineeringRooms";
import { enqueueAction } from "@/lib/offline/db";
import { prepareForUpload } from "@/lib/housekeeping/photo";
import { discardLocalPhoto } from "@/lib/housekeeping/photoAsset";
import { newClientRequestId } from "@/lib/engineering/requestId";
import { REPORT_QUEUE_MARK } from "@/lib/engineering/pendingReports";
import { markAssetListStale } from "@/lib/engineering/useAssetBrowse";
import { markRoomBoardStale } from "@/lib/engineering/useRoomBoard";
import type { AvailabilityDraft, AvailabilityReason } from "@/lib/engineering/roomAvailability";
import {
  EMPTY_REPORT_DRAFT,
  MAX_REPORT_PHOTOS,
  buildReportPayload,
  failedPhotos,
  isDefinitiveRefusal,
  isQueueable,
  isReportDirty,
  isReportValid,
  pushRecentLocation,
  setPriority as applyPriority,
  validateReport,
  withAsset,
  type PhotoResult,
  type RecentLocation,
  type ReportAsset,
  type ReportDraft,
  type ReportLocation,
  type ReportOutcome,
  type ReportPhoto,
} from "@/lib/engineering/reportIssue";
import type { WorkOrderPriority } from "@/lib/engineering/workOrders";

const DRAFT_KEY = "@patelrep/eng_report_draft";
const RECENT_KEY = "@patelrep/eng_report_recent";
const SAVE_DELAY_MS = 400;

interface StoredDraft {
  draft: Omit<ReportDraft, "roomDown"> & { roomDown: (Omit<AvailabilityDraft, "returnAt"> & { returnAt: string | null }) | null };
  savedAt: string;
}

function serialize(draft: ReportDraft): StoredDraft["draft"] {
  return { ...draft, roomDown: draft.roomDown ? { ...draft.roomDown, returnAt: draft.roomDown.returnAt?.toISOString() ?? null } : null };
}

function revive(stored: StoredDraft["draft"]): ReportDraft {
  const roomDown = stored.roomDown ? { ...stored.roomDown, returnAt: stored.roomDown.returnAt ? new Date(stored.roomDown.returnAt) : null } : null;
  // A saved "emergency, confirmed" must be confirmed again: the situation may have changed since it was typed.
  return { ...EMPTY_REPORT_DRAFT, ...stored, emergencyConfirmed: false, roomDown };
}

export async function loadStoredDraft(scope: string): Promise<ReportDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(`${DRAFT_KEY}:${scope}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    return parsed?.draft ? revive(parsed.draft) : null;
  } catch {
    return null;
  }
}

export async function clearStoredDraft(scope: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${DRAFT_KEY}:${scope}`);
  } catch {
    // A draft that cannot be removed is only a stale convenience.
  }
}

async function loadRecent(scope: string): Promise<RecentLocation[]> {
  try {
    const raw = await AsyncStorage.getItem(`${RECENT_KEY}:${scope}`);
    const parsed = raw ? (JSON.parse(raw) as RecentLocation[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

async function rememberRecent(scope: string, next: ReportLocation): Promise<void> {
  try {
    await AsyncStorage.setItem(`${RECENT_KEY}:${scope}`, JSON.stringify(pushRecentLocation(await loadRecent(scope), next)));
  } catch {
    // Recent places are a convenience; losing one never blocks a report.
  }
}

interface Options {
  scope: string | null;
  userId: string | null;
  isOnline: boolean;
  /** What the entry point already knows (room, equipment). It wins over a saved draft and is not "unsaved work". */
  prefill?: Partial<ReportDraft>;
  /** Test seam. */
  submitOverride?: typeof createWorkOrderDetailed;
}

/** A report the server accepted or this phone saved for later (never a refusal). */
type Accepted = Exclude<ReportOutcome, { kind: "failed" }>;

export interface ReportIssue {
  draft: ReportDraft;
  photos: ReportPhoto[];
  recent: RecentLocation[];
  reasons: readonly AvailabilityReason[];
  reasonsFailed: boolean;
  dirty: boolean;
  /** Draft restore has finished (a restored draft may change what is on screen). */
  ready: boolean;
  restored: boolean;
  submitting: boolean;
  outcome: Accepted | null;
  /** The latest attempt was refused or never answered; the draft and request id are kept so Try again is safe. */
  failure: Extract<ReportOutcome, { kind: "failed" }> | null;
  /** Photos that did not upload after the order was created; retry targets only these and never creates another order. */
  photosPending: ReportPhoto[];
  retryingPhotos: boolean;
  showErrors: boolean;
  validation: ReturnType<typeof validateReport>;
  update: (patch: Partial<ReportDraft>) => void;
  setLocation: (location: ReportLocation | null) => void;
  setAsset: (asset: ReportAsset | null) => void;
  setPriority: (priority: WorkOrderPriority) => void;
  setRoomDown: (next: AvailabilityDraft | null) => void;
  addPhoto: (uri: string, caption?: string) => boolean;
  removePhoto: (id: string) => void;
  setPhotoCaption: (id: string, caption: string) => void;
  submit: () => Promise<ReportOutcome | null>;
  retryPhotos: () => Promise<void>;
  discard: () => Promise<void>;
  reset: () => void;
}

export function useReportIssue({ scope, userId, isOnline, prefill, submitOverride }: Options): ReportIssue {
  const base = useMemo<ReportDraft>(() => {
    let next: ReportDraft = { ...EMPTY_REPORT_DRAFT, ...prefill };
    if (prefill?.asset) next = withAsset({ ...next, asset: null }, prefill.asset);
    return next;
    // The prefill is route-derived and fixed for the life of the screen.
  }, []);
  const hasPrefill = Boolean(prefill && Object.keys(prefill).length > 0);
  const [draft, setDraft] = useState<ReportDraft>(base);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [recent, setRecent] = useState<RecentLocation[]>([]);
  const [reasons, setReasons] = useState<readonly AvailabilityReason[]>([]);
  const [reasonsFailed, setReasonsFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryingPhotos, setRetryingPhotos] = useState(false);
  const [outcome, setOutcome] = useState<Accepted | null>(null);
  const [failure, setFailure] = useState<Extract<ReportOutcome, { kind: "failed" }> | null>(null);
  const [photosPending, setPhotosPending] = useState<ReportPhoto[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  // One key per logical report: a retry after a lost answer returns the first work order instead of a second.
  const requestId = useRef(newClientRequestId());
  const busy = useRef(false);
  const created = useRef<{ id: string; photos: ReportPhoto[] } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  // Restore a saved draft only when no entry point supplied its own context.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!scope) return setReady(true);
      const [stored, recents] = await Promise.all([hasPrefill ? Promise.resolve(null) : loadStoredDraft(scope), loadRecent(scope)]);
      if (cancelled) return;
      setRecent(recents);
      if (stored && isReportDirty(stored, [])) {
        setDraft(stored);
        setRestored(true);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, hasPrefill]);

  // Keep the draft on this device while the person types. Photos are not saved (the files are not ours to keep).
  const dirty = isReportDirty(draft, photos, base);
  useEffect(() => {
    if (!ready || !scope || outcome) return;
    const id = setTimeout(() => {
      const payload: StoredDraft = { draft: serialize(draft), savedAt: new Date().toISOString() };
      const write = isReportDirty(draft, [], base)
        ? AsyncStorage.setItem(`${DRAFT_KEY}:${scope}`, JSON.stringify(payload))
        : AsyncStorage.removeItem(`${DRAFT_KEY}:${scope}`);
      write.catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [draft, ready, scope, outcome, base]);

  // The hotel's own reason list, only needed once the person opts into a room-down request.
  const wantsReasons = draft.roomDown != null;
  useEffect(() => {
    if (!wantsReasons || reasons.length > 0 || !isOnline) return;
    const abort = new AbortController();
    listAvailabilityReasons(abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) {
          setReasons(list);
          setReasonsFailed(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setReasonsFailed(true);
      });
    return () => abort.abort();
  }, [wantsReasons, reasons.length, isOnline]);

  const update = useCallback((patch: Partial<ReportDraft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const setLocation = useCallback((location: ReportLocation | null) => setDraft((d) => ({ ...d, location, roomDown: location?.kind === "room" ? d.roomDown : null })), []);
  const setAsset = useCallback((asset: ReportAsset | null) => setDraft((d) => withAsset(d, asset)), []);
  const setPriority = useCallback((priority: WorkOrderPriority) => setDraft((d) => applyPriority(d, priority)), []);
  const setRoomDown = useCallback((roomDown: AvailabilityDraft | null) => setDraft((d) => ({ ...d, roomDown })), []);

  // The list is kept in a ref as well as state: several photos added in one tick must still respect the limit.
  const writePhotos = useCallback((next: ReportPhoto[]) => {
    photosRef.current = next;
    setPhotos(next);
  }, []);
  const addPhoto = useCallback(
    (uri: string, caption = "") => {
      if (photosRef.current.length >= MAX_REPORT_PHOTOS) return false;
      writePhotos([...photosRef.current, { id: newClientRequestId(), uri, caption }]);
      return true;
    },
    [writePhotos],
  );
  const removePhoto = useCallback((id: string) => writePhotos(photosRef.current.filter((p) => p.id !== id)), [writePhotos]);
  const setPhotoCaption = useCallback((id: string, caption: string) => writePhotos(photosRef.current.map((p) => (p.id === id ? { ...p, caption } : p))), [writePhotos]);

  const uploadPhotos = useCallback(async (workOrderId: string, list: readonly ReportPhoto[]): Promise<PhotoResult[]> => {
    const results: PhotoResult[] = [];
    for (const photo of list) {
      let prepared: string | null = null;
      try {
        prepared = await prepareForUpload(photo.uri);
        await uploadWorkOrderPhoto(workOrderId, prepared, { photoType: "before", caption: photo.caption });
        results.push({ id: photo.id, ok: true });
      } catch (err) {
        results.push({ id: photo.id, ok: false, message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (prepared && prepared !== photo.uri) discardLocalPhoto(prepared);
      }
    }
    return results;
  }, []);

  const finish = useCallback(
    (next: Accepted) => {
      if (!mounted.current) return;
      setOutcome(next);
      const location = draftRef.current.location;
      if (scope) {
        void clearStoredDraft(scope);
        if (location) void rememberRecent(scope, location);
      }
      markAssetListStale();
      markRoomBoardStale();
    },
    [scope],
  );

  const submit = useCallback(async (): Promise<ReportOutcome | null> => {
    // A ref, not state: two taps in one tick both pass a state check.
    if (busy.current) return null;
    const current = draftRef.current;
    const validation = validateReport(current);
    if (!isReportValid(validation)) {
      setShowErrors(true);
      return null;
    }
    const payload = buildReportPayload(current, { requestId: requestId.current, userId, reasons });
    if (!payload) {
      setShowErrors(true);
      return null;
    }
    busy.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      if (!isOnline) {
        if (!isQueueable(current)) {
          const failed = { kind: "failed", message: "needs_connection", ambiguous: false, status: null } as const;
          setFailure(failed);
          return failed;
        }
        await enqueueAction("work_order", "create", payload, `${REPORT_QUEUE_MARK}${requestId.current}`);
        const queued: Accepted = { kind: "queued", photosDropped: photosRef.current.length };
        requestId.current = newClientRequestId();
        finish(queued);
        return queued;
      }
      let result;
      try {
        result = await (submitOverride ?? createWorkOrderDetailed)(payload);
      } catch (err) {
        const status = (err as { status?: unknown } | null)?.status;
        const numeric = typeof status === "number" ? status : null;
        // A refusal is final for this request id; anything without an answer keeps the id so a retry cannot duplicate.
        if (isDefinitiveRefusal(numeric)) requestId.current = newClientRequestId();
        const failed = { kind: "failed", message: err instanceof Error ? err.message : String(err), ambiguous: numeric == null || numeric >= 500, status: numeric } as const;
        if (mounted.current) setFailure(failed);
        return failed;
      }
      if (result.id) created.current = { id: result.id, photos: [...photosRef.current] };
      const results = result.id && photosRef.current.length ? await uploadPhotos(result.id, photosRef.current) : [];
      const failedIds = new Set(failedPhotos(results));
      const stillPending = photosRef.current.filter((p) => failedIds.has(p.id));
      if (mounted.current) setPhotosPending(stillPending);

      let roomDown: "confirmed" | "unconfirmed" | null = null;
      if (current.roomDown && current.location?.kind === "room") {
        // The create answer for a replay never says whether the first attempt took the room down: ask the room.
        try {
          const period = await getActiveRoomPeriod(current.location.roomId);
          roomDown = period ? "confirmed" : "unconfirmed";
        } catch {
          roomDown = "unconfirmed";
        }
      }
      requestId.current = newClientRequestId();
      const done: Accepted = {
        kind: "created",
        workOrderId: result.id,
        workOrderNumber: result.workOrderNumber,
        status: result.status,
        replayed: result.replayed,
        roomDown,
      };
      finish(done);
      return done;
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }, [finish, isOnline, reasons, submitOverride, uploadPhotos, userId]);

  const retryPhotos = useCallback(async () => {
    const target = created.current;
    if (!target || retryingPhotos) return;
    setRetryingPhotos(true);
    try {
      const results = await uploadPhotos(target.id, photosPending);
      const failedIds = new Set(failedPhotos(results));
      if (mounted.current) setPhotosPending((list) => list.filter((p) => failedIds.has(p.id)));
    } finally {
      if (mounted.current) setRetryingPhotos(false);
    }
  }, [photosPending, retryingPhotos, uploadPhotos]);

  const reset = useCallback(() => {
    setDraft(base);
    writePhotos([]);
    setOutcome(null);
    setFailure(null);
    setPhotosPending([]);
    setShowErrors(false);
    created.current = null;
    requestId.current = newClientRequestId();
  }, [base, writePhotos]);

  const discard = useCallback(async () => {
    if (scope) await clearStoredDraft(scope);
    reset();
  }, [reset, scope]);

  const validation = useMemo(() => validateReport(draft), [draft]);

  return {
    draft,
    photos,
    recent,
    reasons,
    reasonsFailed,
    dirty,
    ready,
    restored,
    submitting,
    outcome,
    failure,
    photosPending,
    retryingPhotos,
    showErrors,
    validation,
    update,
    setLocation,
    setAsset,
    setPriority,
    setRoomDown,
    addPhoto,
    removePhoto,
    setPhotoCaption,
    submit,
    retryPhotos,
    discard,
    reset,
  };
}
