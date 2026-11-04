import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSyncActivity } from "@/lib/offline/sync";
import { loadClaimConflicts, useClaimConflicts } from "@/lib/engineering/claimConflicts";
import { loadReportRecords, useReportRecords } from "@/lib/engineering/pendingReports";
import { usePendingActions } from "@/lib/engineering/usePendingActions";
import { buildPmQueuedItems, countPmSync } from "@/lib/engineering/pmSyncItems";
import { buildEngineeringSyncCounts, type EngineeringSyncCounts } from "@/lib/engineering/homeModel";
import type { usePmSyncItems } from "@/lib/engineering/usePmSyncItems";

export interface EngineeringSyncSummary extends EngineeringSyncCounts {
  /** A sync run is sending queued changes right now. */
  sending: boolean;
  /** Re-read every queue (pull-to-refresh, screen focus). */
  refresh: () => Promise<void>;
}

/**
 * One answer to "what has this person saved that the server has not confirmed?" for the Engineering Home header. It reads the
 * same sources as the Engineering Sync screen (queued work-order actions and reports, PM inspections, refused reports and
 * claim conflicts) so the two can never disagree. Saved drafts are deliberately not counted: a draft is unfinished work on
 * this phone, not something waiting to upload. The PM source is passed in because the Home already reads it.
 */
export function useEngineeringSyncSummary(pm: ReturnType<typeof usePmSyncItems>): EngineeringSyncSummary {
  return useEngineeringSyncSummaryFrom(pm, usePendingActions());
}

/**
 * Same summary, built from a pending-actions hook the caller already owns (the Sync Center lists and mutates that same
 * hook, so the header counts move the moment a change is retried or discarded instead of waiting for another read).
 */
export function useEngineeringSyncSummaryFrom(pm: ReturnType<typeof usePmSyncItems>, pending: ReturnType<typeof usePendingActions>): EngineeringSyncSummary {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const sending = useSyncActivity((s) => s.active);
  const claimConflicts = useClaimConflicts(userId);
  const records = useReportRecords();
  const { refresh: refreshPending } = pending;
  const { refresh: refreshPm } = pm;
  // Refused claims and reports live in AsyncStorage and start empty: until they were read once, "none" is unknown.
  const [auxRead, setAuxRead] = useState<{ scope: string | null; done: boolean }>({ scope: null, done: false });
  useEffect(() => {
    let live = true;
    void Promise.all([loadClaimConflicts(), loadReportRecords()])
      .then(() => live && setAuxRead({ scope: userId, done: true }))
      .catch(() => live && setAuxRead({ scope: userId, done: false }));
    return () => {
      live = false;
    };
  }, [userId]);
  const auxLoaded = auxRead.done && auxRead.scope === userId;

  const counts = useMemo(() => {
    const pmCounts = pm.loaded ? countPmSync(buildPmQueuedItems(pm.rows, pm.active, ""), pm.drafts) : null;
    return buildEngineeringSyncCounts({
      actions: pending.loaded ? pending.actions : null,
      pm: pmCounts,
      refusedReports: auxLoaded ? records.filter((r) => r.kind === "refused").length : null,
      claimConflicts: claimConflicts.length,
    });
  }, [pending.loaded, pending.actions, pm.loaded, pm.rows, pm.active, pm.drafts, records, claimConflicts.length, auxLoaded]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshPending(), refreshPm(), loadClaimConflicts(), loadReportRecords()]);
  }, [refreshPending, refreshPm]);

  return { ...counts, sending, refresh };
}
