import { useCallback, useEffect, useMemo, useRef } from "react";
import { fetchTeamOverview, fetchTechnicians, type Technician, type TeamOverview } from "@/lib/api/engineeringTeam";
import { onAssignmentChanged } from "@/lib/engineering/teamEvents";
import { useAsyncResource, type AsyncResource } from "@/lib/engineering/useAsyncResource";
import { FOCUS_FRESH_MS, createRefreshGate, type RefreshReason } from "@/lib/engineering/refreshGate";

export interface TeamOverviewResource extends AsyncResource<TeamOverview> {
  /** Ask for a re-read through the gate: a read already running is joined, a focus hint right after a read is skipped. */
  request: (reason: RefreshReason) => Promise<void>;
}

/**
 * The team overview for one hotel + person. Re-reads after any assignment; a failed refresh keeps the last good figures.
 * Focus, realtime, assignment and Retry all use `request`, so the same overview is never fetched twice at once.
 */
export function useTeamOverview(scope: string | null, enabled = true): TeamOverviewResource {
  const resource = useAsyncResource((signal) => fetchTeamOverview(signal), { scope, key: "overview", enabled });
  const reloadRef = useRef(resource.reload);
  reloadRef.current = resource.reload;
  // A new hotel or person gets a new gate, so it can never join a read that was started for the previous one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gate = useMemo(() => createRefreshGate(() => reloadRef.current()), [scope, enabled]);
  // The first read happens inside useAsyncResource, not through the gate, so a focus hint is also skipped while that
  // read is running or when the overview it returned is still fresh.
  const stateRef = useRef({ loading: resource.loading, syncedAt: resource.syncedAt });
  stateRef.current = { loading: resource.loading, syncedAt: resource.syncedAt };
  const request = useCallback(
    (reason: RefreshReason) => {
      if (reason === "focus") {
        const { loading, syncedAt } = stateRef.current;
        if (loading || (syncedAt && Date.now() - syncedAt.getTime() < FOCUS_FRESH_MS)) return Promise.resolve();
      }
      return gate.request(reason);
    },
    [gate],
  );
  useEffect(() => onAssignmentChanged(() => void request("realtime")), [request]);
  return { ...resource, request };
}

/** The people work can be assigned to (loaded only while the sheet is open). */
export function useTechnicians(scope: string | null, enabled: boolean): AsyncResource<Technician[]> {
  return useAsyncResource((signal) => fetchTechnicians(signal), { scope, key: "technicians", enabled });
}
