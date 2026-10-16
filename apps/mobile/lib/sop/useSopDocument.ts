import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { getLibraryDocument, type SOPDocument } from "@/lib/api/sop";
import { assistantScope } from "@/lib/ai/session";
import { readSopCache } from "@/lib/sop/offlineCache";
import { useAppStore } from "@/stores/appStore";

export type SopDocumentStatus = "loading" | "ready" | "gone" | "error";

export interface SopDocumentState {
  doc: SOPDocument | null;
  status: SopDocumentStatus;
  /** The record on screen is the copy saved on this phone, not confirmed with the server just now. */
  fromCache: boolean;
  savedAt: number | null;
  reload: () => void;
}

/**
 * One procedure's record. The server is asked first; "not found" means the document is no longer available to
 * this person (retired, superseded, withdrawn, or never theirs) and nothing saved is shown in its place. Only when
 * the server cannot be reached is the copy saved on this phone for this person used, and it says so.
 */
export function useSopDocument(documentId: string | undefined): SopDocumentState {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const scope = assistantScope(user);
  const [state, setState] = useState<Omit<SopDocumentState, "reload">>({ doc: null, status: "loading", fromCache: false, savedAt: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const mine = (latest.current += 1);
    const current = () => latest.current === mine;
    if (!documentId) {
      setState({ doc: null, status: "gone", fromCache: false, savedAt: null });
      return;
    }
    setState({ doc: null, status: "loading", fromCache: false, savedAt: null });

    const fromSaved = async () => {
      const snapshot = await readSopCache(scope);
      if (!current()) return;
      const doc = snapshot?.docs.find((item) => item.id === documentId) ?? null;
      setState(doc && snapshot ? { doc, status: "ready", fromCache: true, savedAt: snapshot.savedAt } : { doc: null, status: "error", fromCache: false, savedAt: null });
    };

    void (async () => {
      if (!isOnline) {
        await fromSaved();
        return;
      }
      try {
        const res = await getLibraryDocument(documentId);
        if (!current()) return;
        setState({ doc: res.data ?? null, status: res.data ? "ready" : "gone", fromCache: false, savedAt: null });
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          setState({ doc: null, status: "gone", fromCache: false, savedAt: null });
          return;
        }
        await fromSaved();
      }
    })();

    return () => {
      latest.current += 1;
    };
  }, [documentId, scope, isOnline, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}
