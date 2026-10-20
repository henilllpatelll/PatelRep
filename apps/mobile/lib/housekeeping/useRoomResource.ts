import { useCallback, useEffect, useRef, useState } from "react";
import { classifyLoadError, type PanelLoadError } from "@/lib/housekeeping/roomPanelErrors";

/* One read for a Room Board drawer. It has exactly three honest states — loading, ready, error — so a failed or
   unfinished read can never be mistaken for "nothing there". `key` names what is being read (room, session, range):
   a new key discards the old answer at once, and an answer that arrives after the key changed (or after the
   drawer closed) is dropped instead of being painted onto the wrong room. Reads only; never retried by itself. */

export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: PanelLoadError };

export function useRoomResource<T>(key: string | null, load: () => Promise<T>): { state: Resource<T>; reload: () => void } {
  const [held, setHeld] = useState<{ key: string | null; value: Resource<T> }>({ key, value: { status: "loading" } });
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback((forKey: string | null) => {
    const mine = (seq.current += 1);
    setHeld({ key: forKey, value: { status: "loading" } });
    loadRef
      .current()
      .then((data) => {
        if (mine === seq.current) setHeld({ key: forKey, value: { status: "ready", data } });
      })
      .catch((error: unknown) => {
        if (mine === seq.current) setHeld({ key: forKey, value: { status: "error", error: classifyLoadError(error) } });
      });
  }, []);

  useEffect(() => {
    if (key === null) return undefined;
    run(key);
    return () => {
      seq.current += 1;
    };
  }, [key, run]);

  const reload = useCallback(() => {
    if (key !== null) run(key);
  }, [key, run]);

  const state: Resource<T> = held.key === key ? held.value : { status: "loading" };
  return { state, reload };
}
