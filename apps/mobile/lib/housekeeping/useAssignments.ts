import { useCallback, useMemo } from "react";
import { fetchScheduledShifts, fetchWorkloadSettings } from "@/lib/api/housekeepingSupervisor";
import {
  SCHEDULE_STALE_AFTER_MS,
  SETTINGS_STALE_AFTER_MS,
  composeAssignments,
  type AssignmentsModel,
} from "@/lib/housekeeping/assignmentModel";
import type { ScheduledShift } from "@/lib/housekeeping/assignmentSchedule";
import type { WorkloadSettings } from "@/lib/housekeeping/assignmentWorkload";
import type { LearnedLookup } from "@/lib/housekeeping/roomAssignment";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";
import { lookupLearned, useEstimateVersion } from "@/lib/housekeeping/estimateTable";
import { useRoomBoard, type UseRoomBoardOptions } from "@/lib/housekeeping/useRoomBoard";
import { useScopedSource } from "@/lib/housekeeping/useScopedSource";
import { useAppStore } from "@/stores/appStore";

/* The Supervisor Assignments data.

   The board, staff and roster are NOT fetched here: they come from `useRoomBoard`, i.e. the one shared
   Supervisor Today snapshot (one fetch path, one Realtime channel per hotel, hotel-day rollover and foreground
   refresh included), so Assignments, Today and the Room Board cannot disagree and nothing is requested twice.

   Two sources are Assignments-only and independent of that snapshot — the property's workload settings and
   today's schedule. Each is scoped to `tenant:user` (the schedule also to the hotel date), discards late
   answers, and fails alone: if either is unavailable every room, owner and estimate is still shown and only
   what depends on it (credit figures, "scheduled", shift time left) is withheld. */

/** The same learned-estimate lookup the Room Board's assignment flow uses, so both screens give the same minutes. */
const defaultLearned: LearnedLookup = (code, cleanType) => lookupLearned(code, cleanType);

export interface UseAssignmentsOptions extends UseRoomBoardOptions {
  fetchSettings?: (hotelId: string) => Promise<WorkloadSettings>;
  fetchSchedule?: (date: string) => Promise<ScheduledShift[]>;
  /** Room ids with a guest waiting, when a source for it exists; undefined = unknown. */
  guestWaiting?: ReadonlySet<string> | null;
  /** Test seam: a learned-estimate lookup. Defaults to this phone's cached table. */
  learned?: LearnedLookup;
}

export interface UseAssignments {
  model: AssignmentsModel;
  /** Whether assignment writes may run right now (fresh, verified, online). Same gate as the Room Board. */
  gate: MutationGate;
  isOnline: boolean;
  refreshing: boolean;
  /** `tenant:user` while signed in; drafts are bound to it. */
  scopeKey: string | null;
  refresh: () => Promise<void>;
}

export function useAssignments({
  enabled = true,
  fetchers,
  fetchLateCheckouts,
  fetchSettings = fetchWorkloadSettings,
  fetchSchedule = fetchScheduledShifts,
  guestWaiting = null,
  learned = defaultLearned,
}: UseAssignmentsOptions = {}): UseAssignments {
  const board = useRoomBoard({
    enabled,
    ...(fetchers ? { fetchers } : {}),
    ...(fetchLateCheckouts ? { fetchLateCheckouts } : {}),
  });
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const tenantId = user?.tenant_id ?? null;
  const userId = user?.id ?? null;
  const scopeKey = tenantId && userId ? `${tenantId}:${userId}` : null;
  const active = enabled && scopeKey !== null;
  const hotelDate = board.model.hotelDate;
  // The learned-estimate table loads after first render; recompute the minutes when it changes.
  const estimateVersion = useEstimateVersion();

  const settings = useScopedSource<WorkloadSettings>({
    scopeKey,
    active,
    isOnline,
    load: () => fetchSettings(tenantId as string),
    staleAfterMs: SETTINGS_STALE_AFTER_MS,
  });
  const schedule = useScopedSource<ScheduledShift[]>({
    scopeKey,
    active,
    isOnline,
    key: hotelDate,
    load: () => fetchSchedule(hotelDate),
    isEmpty: (shifts) => shifts.length === 0,
    staleAfterMs: SCHEDULE_STALE_AFTER_MS,
  });

  const model = useMemo(
    () =>
      composeAssignments(
        board.model,
        { settings: settings.state, schedule: schedule.state },
        { guestWaiting, learned },
      ),
    // `estimateVersion` is the signal that the table `learned` reads has changed.
    [board.model, settings.state, schedule.state, guestWaiting, learned, estimateVersion],
  );

  const { refresh: refreshBoard } = board;
  const { reload: reloadSettings } = settings;
  const { reload: reloadSchedule } = schedule;
  const refresh = useCallback(async () => {
    await Promise.all([refreshBoard(), reloadSettings(), reloadSchedule()]);
  }, [refreshBoard, reloadSettings, reloadSchedule]);

  return { model, gate: board.gate, isOnline, refreshing: board.refreshing, scopeKey, refresh };
}
