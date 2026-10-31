import { useCallback, useRef, useState } from "react";

/**
 * One submit at a time for a sheet. The guard is a ref, not state: two presses in the same tick both see the
 * state as idle, and only one of them may reach the server.
 */
export function useSheetSubmit() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (task: () => Promise<void>): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "failed");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
