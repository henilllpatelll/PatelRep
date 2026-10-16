import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SOPDocument } from "@/lib/api/sop";
import { onAssistantSessionReset } from "@/lib/ai/session";

/* ─── The procedure list kept on the phone ──────────────────────────────────
   Only the library's LIST (titles, categories, versions, dates) so a person can
   still see which procedures exist without a connection. It holds no document
   text, no passages, no embeddings and no files, and it is stamped with the
   person it belongs to (`${tenantId}:${userId}`): a copy stamped for anyone else
   is treated as empty. It is also dropped on sign-out / account switch and after
   a week, so a procedure the hotel retired is not shown as current for long. */

const KEY = "@patelrep/sop_library_cache.v1";
export const SOP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SopLibrarySnapshot {
  docs: SOPDocument[];
  savedAt: number;
}

interface Stored extends SopLibrarySnapshot {
  scope: string;
}

/** Only these fields are ever written, whatever the server sent. */
function slim(doc: SOPDocument): SOPDocument {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description ?? null,
    category: doc.category ?? null,
    page_count: doc.page_count ?? null,
    indexing_status: doc.indexing_status,
    created_at: doc.created_at,
    updated_at: doc.updated_at ?? null,
    ai_ready: doc.ai_ready,
    approval: doc.approval ?? null,
  };
}

export async function readSopCache(scope: string | null, now: number = Date.now()): Promise<SopLibrarySnapshot | null> {
  if (!scope) return null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.scope !== scope || !Array.isArray(stored.docs) || typeof stored.savedAt !== "number") return null;
    if (now - stored.savedAt > SOP_CACHE_MAX_AGE_MS || stored.savedAt > now + 60000) return null;
    return { docs: stored.docs, savedAt: stored.savedAt };
  } catch {
    return null;
  }
}

export async function writeSopCache(scope: string | null, docs: SOPDocument[], now: number = Date.now()): Promise<void> {
  if (!scope) return;
  try {
    const stored: Stored = { scope, savedAt: now, docs: docs.map(slim) };
    await AsyncStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // A full disk costs the offline copy, nothing else.
  }
}

export async function clearSopCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// Sign-out or an account switch removes the copy at once, on top of the scope check above.
onAssistantSessionReset(() => {
  void clearSopCache();
});
