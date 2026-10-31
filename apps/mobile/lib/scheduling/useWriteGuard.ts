import { useCallback, useEffect, useRef, useState } from "react";
import { classifyWriteFailure, type WriteFailure } from "@/lib/api/schedulingManage";

/* One schedule write at a time. A second press while one is in flight sends nothing and returns null (the guard is a
   ref, so it holds even before the button has re-rendered). A failure is classified, never swallowed; "unconfirmed"
   means no answer arrived, so the change MAY have been saved and the caller must verify instead of assuming. */

export type WriteResult<T> = { ok: true; value: T } | { ok: false; failure: WriteFailure };

export function useWriteGuard() {
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const run = useCallback(async <T,>(request: () => Promise<T>): Promise<WriteResult<T> | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      return { ok: true, value: await request() };
    } catch (error) {
      return { ok: false, failure: classifyWriteFailure(error) };
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, run };
}
