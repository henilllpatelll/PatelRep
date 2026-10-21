import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { fetchReadyForInspectionVerified, listInspectionTemplates, type ReadyRoom } from "@/lib/api/inspections";
import { hotelTodayKey } from "@/lib/housekeeping/supervisorToday";
import {
  ageSource,
  loadingSource,
  offlineSource,
  settleSource,
  type SourceState,
} from "@/lib/housekeeping/supervisorSources";
import { buildQueue, queueFreshness, queueRooms, type QueueFreshness, type QueueItem } from "@/lib/inspections/queue";
import { normalizeTemplates, selectTemplate, type TemplateSelection } from "@/lib/inspections/templates";
import type { ChecklistTemplate } from "@/lib/inspections/types";
import { useAppStore } from "@/stores/appStore";

/* The inspection queue's data: the rooms awaiting inspection and the hotel's checklists, each tracked on its own so
   one failing endpoint never blanks the other and a failed request is never an empty queue. Everything is scoped to
   `tenant:user`: switching hotel or account throws away the previous answers, and a response that lands after the
   scope changed (or after a newer request began) is discarded. */

export interface TemplatesData {
  templates: ChecklistTemplate[];
  /** Templates the server sent that could not be read safely; they are never used. */
  unreadable: number;
}

export interface InspectionFetchers {
  queue: (date: string) => Promise<ReadyRoom[]>;
  templates: () => Promise<{ data: unknown }>;
}

const DEFAULT_FETCHERS: InspectionFetchers = {
  queue: fetchReadyForInspectionVerified,
  templates: listInspectionTemplates,
};

/** Re-evaluate freshness this often so an untouched screen cannot keep calling old data "live". */
const AGE_TICK_MS = 30_000;

type Snapshot = {
  scope: string | null;
  queue: SourceState<ReadyRoom[]>;
  templates: SourceState<TemplatesData>;
};

const emptySnapshot = (scope: string | null): Snapshot => ({ scope, queue: loadingSource(), templates: loadingSource() });

export interface UseInspectionQueue {
  /** The hotel's calendar day (hotel time zone), which the queue was requested for. */
  businessDate: string;
  queue: SourceState<ReadyRoom[]>;
  templates: SourceState<TemplatesData>;
  /** null until a queue has been verified — never an empty array standing in for "unknown". */
  items: QueueItem[] | null;
  freshness: QueueFreshness;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** The checklist for a room type, or null while the checklists have not loaded. */
  selectionFor: (roomTypeId: string | null | undefined) => TemplateSelection | null;
}

export function useInspectionQueue({
  enabled = true,
  fetchers = DEFAULT_FETCHERS,
}: { enabled?: boolean; fetchers?: InspectionFetchers } = {}): UseInspectionQueue {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const timeZone = useAppStore((state) => state.hotelTimezone ?? null);
  const scopeKey = user?.tenant_id && user?.id ? `${user.tenant_id}:${user.id}` : null;
  const active = enabled && scopeKey !== null;

  const [snapshot, setSnapshot] = useState<Snapshot>(() => emptySnapshot(scopeKey));
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // Latest values read at call time, so an inline fetcher or a re-render can never retrigger the loads.
  const fetchersRef = useRef(fetchers);
  fetchersRef.current = fetchers;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const zoneRef = useRef(timeZone);
  zoneRef.current = timeZone;
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current += 1;
    };
  }, []);

  // A different hotel or person: nothing in flight for the old one may land.
  useEffect(() => {
    seq.current += 1;
  }, [scopeKey]);

  const businessDate = hotelTodayKey(now, timeZone);

  const load = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope) return;
    const mine = ++seq.current;
    const date = hotelTodayKey(Date.now(), zoneRef.current);
    const [queueResult, templatesResult] = await Promise.allSettled([
      fetchersRef.current.queue(date),
      fetchersRef.current.templates(),
    ]);
    if (!mounted.current || mine !== seq.current || scopeRef.current !== scope) return;
    const at = Date.now();
    const templates: PromiseSettledResult<TemplatesData> =
      templatesResult.status === "fulfilled"
        ? { status: "fulfilled", value: parseTemplates(templatesResult.value) }
        : templatesResult;
    setNow(at);
    setSnapshot((previous) => {
      const base = previous.scope === scope ? previous : emptySnapshot(scope);
      return {
        scope,
        queue: settleSource(queueResult, base.queue, at),
        // A checklist list is always "available" — an empty one is reported by selection, not hidden as a true zero.
        templates: settleSource(templates, base.templates, at, () => false),
      };
    });
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    if (active && isOnline) void load();
  }, [active, isOnline, scopeKey, businessDate, load]);

  // Offline: keep what is on screen but stop calling it verified.
  useEffect(() => {
    if (isOnline) return;
    setSnapshot((previous) => ({ ...previous, queue: offlineSource(previous.queue), templates: offlineSource(previous.templates) }));
  }, [isOnline]);

  // Back from the background the queue may have moved a lot.
  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && useAppStore.getState().isOnline) void load();
    });
    return () => subscription.remove();
  }, [active, load]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  // Answers from another scope are never shown.
  const current = snapshot.scope === scopeKey ? snapshot : emptySnapshot(scopeKey);
  const queue = useMemo(() => ageSource(current.queue, now), [current.queue, now]);
  const templates = useMemo(() => ageSource(current.templates, now), [current.templates, now]);

  const rooms = queueRooms(queue);
  const items = useMemo(() => (rooms === null ? null : buildQueue(rooms)), [rooms]);
  const freshness = queueFreshness(queue, now);

  const templatesKnown = templates.status === "available" || templates.status === "stale" ? templates.data : null;
  const selectionFor = useCallback(
    (roomTypeId: string | null | undefined): TemplateSelection | null =>
      templatesKnown ? selectTemplate(templatesKnown.templates, roomTypeId, { unreadable: templatesKnown.unreadable }) : null,
    [templatesKnown],
  );

  return { businessDate, queue, templates, items, freshness, refreshing, refresh, selectionFor };
}

function parseTemplates(response: { data: unknown }): TemplatesData {
  const { templates, invalid } = normalizeTemplates(response?.data);
  return { templates, unreadable: invalid };
}
