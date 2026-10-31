import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchGaps, type CoverageGap } from "@/lib/api/schedulingCoverage";

/* The gaps still to cover (open or offered). Kept apart from the schedule read so a coverage failure never hides the
   schedule: `status: "failed"` means "coverage is UNKNOWN", and callers show that instead of an empty list. The last
   good answer is kept (and marked stale) when a refresh fails. */

export type CoverageState = "loading" | "ready" | "stale" | "failed";

export interface CoverageGaps {
  /** Work still to do (open or offered) followed by recently filled gaps. */
  gaps: readonly CoverageGap[];
  /** Open or offered only. */
  todo: readonly CoverageGap[];
  status: CoverageState;
  refresh: () => Promise<void>;
  /** Gaps by hotel-local day, for the week view and the day's attention list. */
  byDate: ReadonlyMap<string, readonly CoverageGap[]>;
  /** The gap a called-out shift opened, if any. */
  forAssignment: (assignmentId: string | null | undefined) => CoverageGap | null;
}

const isTodo = (gap: CoverageGap) => gap.status === "open" || gap.status === "offered";

export function useCoverageGaps(enabled: boolean): CoverageGaps {
  const [gaps, setGaps] = useState<readonly CoverageGap[]>([]);
  const [status, setStatus] = useState<CoverageState>("loading");
  const seq = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      // Work still to do is the answer; recently filled gaps only let a shift say "covered by …" (their failure is not fatal).
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const [todo, filled] = await Promise.all([fetchGaps(), fetchGaps({ status: "filled", dateFrom: since }).catch(() => [] as CoverageGap[])]);
      if (mine !== seq.current || !mounted.current) return;
      setGaps([...todo, ...filled]);
      setStatus("ready");
    } catch {
      if (mine !== seq.current || !mounted.current) return;
      setStatus((held) => (held === "ready" || held === "stale" ? "stale" : "failed"));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (enabled) void refresh();
    return () => {
      mounted.current = false;
      seq.current += 1;
    };
  }, [enabled, refresh]);

  const byDate = useMemo(() => {
    const map = new Map<string, CoverageGap[]>();
    for (const gap of gaps.filter(isTodo)) map.set(gap.workDate, [...(map.get(gap.workDate) ?? []), gap]);
    return map;
  }, [gaps]);

  const forAssignment = useCallback(
    (assignmentId: string | null | undefined) => (assignmentId ? (gaps.find((gap) => gap.originalAssignmentId === assignmentId) ?? null) : null),
    [gaps],
  );

  const todo = useMemo(() => gaps.filter(isTodo), [gaps]);
  return { gaps, todo, status, refresh, byDate, forAssignment };
}
