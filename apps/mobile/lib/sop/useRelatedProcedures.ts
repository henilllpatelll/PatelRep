import { useEffect, useMemo, useState } from "react";
import { listLibrary, type SOPDocument } from "@/lib/api/sop";
import { assistantScope } from "@/lib/ai/session";
import { readSopCache, writeSopCache } from "@/lib/sop/offlineCache";
import { relatedProcedures } from "@/lib/sop/relatedProcedures";
import { useAppStore } from "@/stores/appStore";

/**
 * The hotel's own procedures that match some text on screen (a task, a room). Runs only while `enabled` (the
 * sheet is open), reads the copy saved on this phone first and asks the server for the list only when there is
 * none and the phone is online. It never calls a model, and a failure just means no suggestions: the task or
 * room is unaffected.
 */
export function useRelatedProcedures(texts: Array<string | null | undefined>, enabled: boolean): SOPDocument[] {
  const user = useAppStore((state) => state.user);
  // Reduced to a boolean so the effect below only re-runs when connectivity really changes.
  const isOnline = useAppStore((state) => state.isOnline) !== false;
  const scope = assistantScope(user);
  const [docs, setDocs] = useState<SOPDocument[]>([]);

  useEffect(() => {
    if (!enabled || !scope) {
      // Keep the same array when it is already empty: a new [] every run would re-render forever.
      setDocs((current) => (current.length === 0 ? current : []));
      return;
    }
    let live = true;
    void (async () => {
      const cached = await readSopCache(scope);
      if (!live) return;
      if (cached) {
        setDocs(cached.docs);
        return;
      }
      if (!isOnline) return;
      try {
        const res = await listLibrary();
        if (!live) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setDocs(list);
        void writeSopCache(scope, list);
      } catch {
        // No suggestions this time.
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled, scope, isOnline]);

  const key = texts.join("␟");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => relatedProcedures(texts, docs), [key, docs]);
}
