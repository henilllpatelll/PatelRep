import { useCallback, useEffect, useRef, useState } from "react";
import { fetchInspectionDetail, type InspectionDetail } from "@/lib/api/inspections";
import { fetchEvidenceUrl, fetchInspectionTimeline, type InspectionTimeline } from "@/lib/api/inspectionHistory";
import { useAppStore } from "@/stores/appStore";

/* One recorded inspection: its detail, and (only when it belongs to a correction cycle) the timeline.

   - Both are read for ONE inspection id; an answer for an earlier id, or for another hotel / account, is dropped.
   - The server's refusal is kept apart from "nothing found": a missing record, a permission problem, no connection
     and a server error each say something different, and none of them is shown as an empty record.
   - A refresh that fails keeps the record already on screen, marked stale; it never blanks verified history. */

export type LoadFailure = "not_found" | "forbidden" | "offline" | "error";

export type Load<T> = { status: "idle" } | { status: "loading" } | { status: "failed"; failure: LoadFailure } | { status: "ready"; data: T; stale: boolean };

export function classifyLoadFailure(error: unknown, online: boolean): LoadFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 404) return "not_found";
  if (status === 401 || status === 403) return "forbidden";
  if (!online) return "offline";
  return "error";
}

export interface RecordFetchers {
  detail: (id: string) => Promise<InspectionDetail>;
  timeline: (id: string) => Promise<InspectionTimeline>;
  evidence: (inspectionId: string, itemId: string) => Promise<{ url: string; expiresIn: number }>;
}

const DEFAULT_FETCHERS: RecordFetchers = { detail: fetchInspectionDetail, timeline: fetchInspectionTimeline, evidence: fetchEvidenceUrl };

/** Does this record belong to a correction cycle that has a story to tell? */
export function hasCycle(detail: InspectionDetail | null): boolean {
  return Boolean(detail && (detail.reinspection_of || detail.correction));
}

export interface UseInspectionRecord {
  detail: Load<InspectionDetail>;
  timeline: Load<InspectionTimeline>;
  reload: () => void;
  loadTimeline: () => void;
  /** A fresh short-lived photo link, or null when the photo is gone. */
  refreshEvidence: (templateItemId: string) => Promise<string | null>;
}

export function useInspectionRecord(inspectionId: string | null, fetchers: RecordFetchers = DEFAULT_FETCHERS): UseInspectionRecord {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const scopeKey = user?.tenant_id && user?.id ? `${user.tenant_id}:${user.id}` : null;

  const [detail, setDetail] = useState<{ scope: string | null; id: string | null; load: Load<InspectionDetail> }>({ scope: scopeKey, id: inspectionId, load: { status: "idle" } });
  const [timeline, setTimeline] = useState<{ scope: string | null; id: string | null; load: Load<InspectionTimeline> }>({ scope: scopeKey, id: inspectionId, load: { status: "idle" } });

  const fetchersRef = useRef(fetchers);
  fetchersRef.current = fetchers;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;
  const idRef = useRef(inspectionId);
  idRef.current = inspectionId;
  const detailSeq = useRef(0);
  const timelineSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailSeq.current += 1;
      timelineSeq.current += 1;
    };
  }, []);

  const loadDetail = useCallback(() => {
    const id = idRef.current;
    const scope = scopeRef.current;
    if (!id || !scope) return;
    const mine = ++detailSeq.current;
    fetchersRef.current.detail(id).then(
      (data) => {
        if (!mounted.current || mine !== detailSeq.current || scopeRef.current !== scope || idRef.current !== id) return;
        setDetail({ scope, id, load: { status: "ready", data, stale: false } });
      },
      (error) => {
        if (!mounted.current || mine !== detailSeq.current || scopeRef.current !== scope || idRef.current !== id) return;
        const failure = classifyLoadFailure(error, onlineRef.current);
        setDetail((previous) =>
          previous.scope === scope && previous.id === id && previous.load.status === "ready" && failure !== "not_found" && failure !== "forbidden"
            ? { ...previous, load: { ...previous.load, stale: true } }
            : { scope, id, load: { status: "failed", failure } },
        );
      },
    );
  }, []);

  const loadTimeline = useCallback(() => {
    const id = idRef.current;
    const scope = scopeRef.current;
    if (!id || !scope) return;
    const mine = ++timelineSeq.current;
    setTimeline((previous) => (previous.scope === scope && previous.id === id && previous.load.status === "ready" ? previous : { scope, id, load: { status: "loading" } }));
    fetchersRef.current.timeline(id).then(
      (data) => {
        if (!mounted.current || mine !== timelineSeq.current || scopeRef.current !== scope || idRef.current !== id) return;
        setTimeline({ scope, id, load: { status: "ready", data, stale: false } });
      },
      (error) => {
        if (!mounted.current || mine !== timelineSeq.current || scopeRef.current !== scope || idRef.current !== id) return;
        const failure = classifyLoadFailure(error, onlineRef.current);
        setTimeline((previous) =>
          previous.scope === scope && previous.id === id && previous.load.status === "ready"
            ? { ...previous, load: { ...previous.load, stale: true } }
            : { scope, id, load: { status: "failed", failure } },
        );
      },
    );
  }, []);

  // A new inspection id (following a related inspection) or a new hotel / person starts clean.
  useEffect(() => {
    detailSeq.current += 1;
    timelineSeq.current += 1;
    setDetail({ scope: scopeKey, id: inspectionId, load: inspectionId && scopeKey ? { status: "loading" } : { status: "idle" } });
    setTimeline({ scope: scopeKey, id: inspectionId, load: { status: "idle" } });
    if (inspectionId && scopeKey) loadDetail();
  }, [inspectionId, scopeKey, loadDetail]);

  const reload = useCallback(() => {
    loadDetail();
    if (timeline.load.status !== "idle") loadTimeline();
  }, [loadDetail, loadTimeline, timeline.load.status]);

  const refreshEvidence = useCallback(async (templateItemId: string): Promise<string | null> => {
    const id = idRef.current;
    const scope = scopeRef.current;
    if (!id || !scope) return null;
    try {
      const fresh = await fetchersRef.current.evidence(id, templateItemId);
      return scopeRef.current === scope && idRef.current === id ? fresh.url : null;
    } catch {
      return null;
    }
  }, []);

  const currentDetail: Load<InspectionDetail> = detail.scope === scopeKey && detail.id === inspectionId ? detail.load : { status: "loading" };
  const currentTimeline: Load<InspectionTimeline> = timeline.scope === scopeKey && timeline.id === inspectionId ? timeline.load : { status: "idle" };
  return { detail: currentDetail, timeline: currentTimeline, reload, loadTimeline, refreshEvidence };
}
