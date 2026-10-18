import { create } from "zustand";
import { initialTodaySources, type TodaySources } from "@/lib/housekeeping/supervisorToday";

/**
 * The one set of Supervisor Today sources. Today and the Attention Center are separate routes, so they
 * read the same snapshot from here: the counts cannot disagree and nothing is fetched twice.
 *
 * - `scope` (`tenant:user`) names whose data this is; a reader for another scope sees "nothing loaded".
 * - The store is emptied when the last screen using it goes away, so one hotel's data never lingers.
 * - Refreshes are coalesced: while one is in flight, a further request sets a flag and one follow-up
 *   refresh runs afterwards (the newest answer always wins, a burst never fans out into many requests).
 *   A request that only wants data to exist (`join`, e.g. a screen mounting) just waits for the one in flight.
 */

interface TodayStoreState {
  scope: string | null;
  sources: TodaySources;
  refreshing: boolean;
}

export const useSupervisorTodayStore = create<TodayStoreState>(() => ({
  scope: null,
  sources: initialTodaySources(),
  refreshing: false,
}));

type Loader = (previous: TodaySources) => Promise<TodaySources>;

interface InFlight {
  scope: string | null;
  again: boolean;
  load: Loader;
  promise: Promise<void>;
}

let inFlight: InFlight | null = null;
let users = 0;

/** The sources for `scope`, or a blank set when the store holds another scope's data. */
export function sourcesFor(scope: string | null): TodaySources {
  const state = useSupervisorTodayStore.getState();
  return state.scope === scope ? state.sources : initialTodaySources();
}

/** A screen starts using the store. Returns the matching release. */
export function acquireTodayStore(): () => void {
  users += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users <= 0) {
      users = 0;
      inFlight = null;
      useSupervisorTodayStore.setState({ scope: null, sources: initialTodaySources(), refreshing: false });
    }
  };
}

/**
 * Refresh the sources for `scope` through `load`. Resolves when the refresh (and any follow-up it
 * absorbed) has settled. A different scope starting mid-flight discards the older answer.
 */
export function requestTodayRefresh(scope: string | null, load: Loader, options: { join?: boolean } = {}): Promise<void> {
  if (inFlight && inFlight.scope === scope) {
    if (!options.join) {
      inFlight.again = true;
      inFlight.load = load;
    }
    return inFlight.promise;
  }
  const entry: InFlight = { scope, again: false, load, promise: Promise.resolve() };
  entry.promise = (async () => {
    try {
      useSupervisorTodayStore.setState({ refreshing: true });
      do {
        entry.again = false;
        const next = await entry.load(sourcesFor(scope));
        if (inFlight !== entry) return;
        useSupervisorTodayStore.setState({ scope, sources: next });
      } while (entry.again && inFlight === entry);
    } finally {
      if (inFlight === entry) {
        inFlight = null;
        useSupervisorTodayStore.setState({ refreshing: false });
      }
    }
  })();
  inFlight = entry;
  return entry.promise;
}
