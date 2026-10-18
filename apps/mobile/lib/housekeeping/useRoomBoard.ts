import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { fetchLateCheckoutsVerified } from "@/lib/api/housekeepingSupervisor";
import type { LateCheckoutRecord } from "@/lib/housekeeping/roomBoardModel";
import {
  composeRoomBoard,
  evaluateMutationGate,
  type MutationGate,
  type RoomBoardModel,
} from "@/lib/housekeeping/roomBoardState";
import { subscribeSupervisorRealtime } from "@/lib/housekeeping/supervisorRealtime";
import { loadingSource, offlineSource, settleSource, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { useSupervisorToday, type UseSupervisorTodayOptions } from "@/lib/housekeeping/useSupervisorToday";
import { useAppStore } from "@/stores/appStore";

/* The Room Board's data. Board, staff and roster come from the SAME snapshot Supervisor Today uses (one
   fetch path, one Realtime channel, counts that cannot disagree); late checkouts are the board's own
   independent source, so a failure there never blanks the board. Everything is scoped to `tenant:user`:
   switching hotel or account throws away the previous answers, and a response that lands after the scope
   changed (or after a newer request started) is discarded. */

type LateState = { scope: string | null; state: SourceState<LateCheckoutRecord[]> };

export interface UseRoomBoardOptions extends Pick<UseSupervisorTodayOptions, "fetchers" | "enabled"> {
  fetchLateCheckouts?: () => Promise<LateCheckoutRecord[]>;
}

export interface UseRoomBoard {
  model: RoomBoardModel;
  /** Whether operational mutations may run right now (fresh, verified, online). */
  gate: MutationGate;
  isOnline: boolean;
  /** True while a refresh is in flight. Existing data stays on screen meanwhile. */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useRoomBoard({
  enabled = true,
  fetchers,
  fetchLateCheckouts = fetchLateCheckoutsVerified,
}: UseRoomBoardOptions = {}): UseRoomBoard {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const timeZone = useAppStore((state) => state.hotelTimezone ?? null);
  const tenantId = user?.tenant_id ?? null;
  const userId = user?.id ?? null;
  const scopeKey = tenantId && userId ? `${tenantId}:${userId}` : null;

  // Without a signed-in hotel and person there is no scope to hold an answer for, so nothing is fetched.
  const active = enabled && scopeKey !== null;
  const { today, refresh: refreshToday, refreshing } = useSupervisorToday({
    enabled: active,
    ...(fetchers ? { fetchers } : {}),
    viewerId: userId,
    scopeKey,
    reuseFresh: true,
  });

  // The latest fetcher is read at call time, so an inline function from a caller can never retrigger the loads.
  const fetchLateRef = useRef(fetchLateCheckouts);
  fetchLateRef.current = fetchLateCheckouts;

  const [late, setLate] = useState<LateState>({ scope: scopeKey, state: loadingSource() });
  const lateSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lateSeq.current += 1;
    };
  }, []);

  // A different hotel or person: nothing in flight for the old one may land.
  useEffect(() => {
    lateSeq.current += 1;
  }, [scopeKey]);

  const loadLate = useCallback(async () => {
    if (!active || !scopeKey) return;
    const mine = (lateSeq.current += 1);
    const previousOf = (held: LateState) => (held.scope === scopeKey ? held.state : loadingSource<LateCheckoutRecord[]>());
    if (!isOnline) {
      setLate((held) => {
        const next = offlineSource(previousOf(held));
        return held.scope === scopeKey && held.state === next ? held : { scope: scopeKey, state: next };
      });
      return;
    }
    const [result] = await Promise.allSettled([fetchLateRef.current()]);
    // Superseded by a newer request, or the screen/scope moved on: drop this answer.
    if (mine !== lateSeq.current || !mounted.current) return;
    setLate((held) => ({ scope: scopeKey, state: settleSource(result, previousOf(held), Date.now()) }));
  }, [active, scopeKey, isOnline]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshToday(), loadLate()]);
  }, [refreshToday, loadLate]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Late checkouts load with the board and again whenever connectivity returns.
  useEffect(() => {
    void loadLate();
  }, [loadLate]);

  // The hotel's day rolled over: the board refreshes itself (useSupervisorToday); late checkouts follow.
  const seenDate = useRef<string | null>(null);
  useEffect(() => {
    const previous = seenDate.current;
    seenDate.current = today.hotelDate;
    if (previous !== null && previous !== today.hotelDate) void loadLate();
  }, [today.hotelDate, loadLate]);

  // Back from the background: late checkouts are not part of the shared snapshot, so refresh them here.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadLate();
    });
    return () => subscription.remove();
  }, [loadLate]);

  // The one shared Realtime channel per hotel; bursts are coalesced and a reconnect catches up (see supervisorRealtime).
  useEffect(() => {
    if (!active || !tenantId) return;
    return subscribeSupervisorRealtime(tenantId, () => refreshRef.current());
  }, [active, tenantId]);

  const lateSource = late.scope === scopeKey ? late.state : loadingSource<LateCheckoutRecord[]>();
  const model = useMemo(
    () =>
      composeRoomBoard(
        {
          board: today.sources.board,
          staff: today.sources.staff,
          roster: today.sources.roster,
          lateCheckouts: lateSource,
        },
        { now: today.generatedAt, timeZone },
      ),
    [today.sources, today.generatedAt, lateSource, timeZone],
  );
  const gate = useMemo(() => evaluateMutationGate(model.availability, isOnline), [model.availability, isOnline]);

  return { model, gate, isOnline, refreshing, refresh };
}
