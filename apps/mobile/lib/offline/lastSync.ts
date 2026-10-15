import AsyncStorage from "@react-native-async-storage/async-storage";
import { taskScope } from "@/lib/tasks/offline/taskCache";
import { useAppStore } from "@/stores/appStore";

/**
 * "All changes confirmed" time, kept on the phone per person + hotel (`${tenant}:${user}`), so a restart
 * does not forget it and the next person on a shared phone never sees it. It only means: at that moment
 * every queue was read and none held an unsent change. A request reaching the server is not enough.
 */
const key = (scope: string) => `@patelrep/mobile/last-sync:${scope}`;

const newer = (a: string | null, b: string | null) => (a && b ? (a >= b ? a : b) : (a ?? b));

function currentScope(): string | null {
  return taskScope(useAppStore.getState().user);
}

/** Record a confirmed-clear moment for the signed-in person. An older time never replaces a newer one. */
export async function recordConfirmedSync(at: string = new Date().toISOString()): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  const state = useAppStore.getState();
  if (!state.lastSyncedAt || at > state.lastSyncedAt) state.setLastSyncedAt(at);
  try {
    const stored = await AsyncStorage.getItem(key(scope));
    if (!stored || at > stored) await AsyncStorage.setItem(key(scope), at);
  } catch {
    // Storage unavailable: the in-memory time still shows for this run.
  }
}

/** After sign-in: bring back this person's saved time (never another person's). */
export async function hydrateLastSynced(): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(key(scope));
  } catch {
    return;
  }
  if (!stored || Number.isNaN(new Date(stored).getTime())) return;
  // The person may have switched, or a newer sync landed, while storage was read.
  if (currentScope() !== scope) return;
  const state = useAppStore.getState();
  const best = newer(state.lastSyncedAt, stored);
  if (best !== state.lastSyncedAt) state.setLastSyncedAt(best);
}
