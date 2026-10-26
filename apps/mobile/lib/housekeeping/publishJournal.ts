import AsyncStorage from "@react-native-async-storage/async-storage";

/* ─── Supervisor Assignments — the in-flight publication journal ─────────────
   The one thing worth keeping across an app restart: "a publication with THIS operation id was sent and its outcome
   is not known yet". With it, a supervisor who is killed mid-publish (or loses the app to the background) is told
   what became of it instead of being left to guess — the answer comes from the server (a read-only check), never
   from this record.

   It holds ONLY the operation id, the hotel date, how many rooms and when — no room, name or any other detail — and
   is keyed by `tenant:user`, so another person on the same phone never reads it. It is written just before the
   request is sent and removed as soon as the outcome is known. Storage can fail or be cleared (every call is
   try/caught): then the app simply does not remember, which is the same as before this existed. */

export interface PendingPublication {
  operationId: string;
  scopeKey: string;
  hotelDate: string;
  changeCount: number;
  startedAt: number;
}

const keyOf = (scopeKey: string) => `@patelrep/assignment_publish_journal:${scopeKey}`;

export async function writePending(entry: PendingPublication): Promise<void> {
  try {
    await AsyncStorage.setItem(keyOf(entry.scopeKey), JSON.stringify(entry));
  } catch {
    /* not remembered */
  }
}

export async function readPending(scopeKey: string): Promise<PendingPublication | null> {
  try {
    const raw = await AsyncStorage.getItem(keyOf(scopeKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingPublication> | null;
    if (
      value &&
      typeof value.operationId === "string" &&
      value.scopeKey === scopeKey &&
      typeof value.hotelDate === "string" &&
      typeof value.changeCount === "number" &&
      typeof value.startedAt === "number"
    ) {
      return { operationId: value.operationId, scopeKey, hotelDate: value.hotelDate, changeCount: value.changeCount, startedAt: value.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearPending(scopeKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyOf(scopeKey));
  } catch {
    /* nothing to forget */
  }
}
