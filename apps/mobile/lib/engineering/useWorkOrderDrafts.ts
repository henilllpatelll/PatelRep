import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AppState } from "react-native";
import { emptyCompletionDraft, type CompletionDraft } from "@/lib/engineering/repairWorkspace";
import {
  clearCompletionDraft,
  clearTextDraft,
  isMeaningfulCompletionDraft,
  loadCompletionDraft,
  loadTextDraft,
  reviewRestoredDraft,
  saveCompletionDraft,
  saveTextDraft,
  type DraftReview,
  type TextDraftKind,
} from "@/lib/engineering/workOrderDrafts";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export const DRAFT_SAVE_DELAY_MS = 700;

export interface RestoredInfo {
  savedAt: string;
  review: DraftReview;
}

const isClosed = (wo: Pick<WorkOrder, "status"> | null) => wo?.status === "completed" || wo?.status === "cancelled";

/**
 * The completion form's state, kept on this phone while it is being filled in.
 *
 * - Starts from the order's saved coding, then restores a saved draft for THIS order and THIS person (never submits it).
 * - Only what the person changes is saved (debounced; also when the app goes to the background and on leaving the
 *   screen). A restore that finishes after the person already typed never overwrites their input.
 * - The draft survives a failed submission and a merely queued one; it goes away only when the server confirmed the
 *   completion (`confirmed`, or the order being seen as completed) or the person discards it.
 */
export function useCompletionDraft(woId: string, wo: WorkOrder | null, label: string | null) {
  const [draft, setDraft] = useState<CompletionDraft>(() => emptyCompletionDraft());
  const [restored, setRestored] = useState<RestoredInfo | null>(null);

  const seeded = useRef(false);
  const touched = useRef(false);
  const suppress = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, wo, label });
  latest.current = { draft, wo, label };

  const persistNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { draft: d, wo: w, label: l } = latest.current;
    if (!w || isClosed(w) || suppress.current || !touched.current) return;
    if (isMeaningfulCompletionDraft(d, w)) void saveCompletionDraft(woId, d, w.status, l);
    else void clearCompletionDraft(woId);
  }, [woId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      persistNow();
    };
  }, [persistNow]);

  // A different order on the same screen instance starts clean.
  useEffect(() => {
    seeded.current = false;
    touched.current = false;
    suppress.current = false;
    setRestored(null);
    setDraft(emptyCompletionDraft());
  }, [woId]);

  useEffect(() => {
    if (!wo || seeded.current) return;
    seeded.current = true;
    setDraft(emptyCompletionDraft(wo));
    void loadCompletionDraft(woId).then((saved) => {
      if (!saved || !mounted.current || touched.current) return;
      const current = latest.current.wo;
      if (!current || isClosed(current)) return;
      setDraft(saved.draft);
      setRestored({ savedAt: saved.savedAt, review: reviewRestoredDraft(saved.statusAtSave, current.status) });
    });
  }, [wo, woId]);

  // The server says the order is finished: a draft for it no longer means anything.
  const closed = isClosed(wo);
  useEffect(() => {
    if (!closed) return;
    suppress.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRestored(null);
    void clearCompletionDraft(woId);
  }, [closed, woId]);

  useEffect(() => {
    if (!seeded.current || !touched.current || suppress.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persistNow, DRAFT_SAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [draft, persistNow]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") persistNow();
    });
    return () => sub.remove();
  }, [persistNow]);

  /** Every person-driven change goes through here; this is what makes a draft worth saving. */
  const editDraft: Dispatch<SetStateAction<CompletionDraft>> = useCallback((next) => {
    touched.current = true;
    suppress.current = false;
    setDraft(next);
  }, []);

  /** The server accepted the completion: clear the form and its saved copy. */
  const confirmed = useCallback(() => {
    suppress.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRestored(null);
    setDraft(emptyCompletionDraft());
    void clearCompletionDraft(woId);
  }, [woId]);

  /** The person chose to throw the saved draft away; the form returns to the order's own saved coding. */
  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    touched.current = false;
    setRestored(null);
    setDraft(emptyCompletionDraft(latest.current.wo ?? undefined));
    void clearCompletionDraft(woId);
  }, [woId]);

  return { draft, editDraft, restored, confirmed, discard };
}

/**
 * A text field's saved copy (note, hold note, escalation reason). `text` starts empty, fills from the saved copy once
 * (unless the person has already typed), saves while typing and is cleared by `clear` after the server stored it.
 */
export function useTextDraft(woId: string | null | undefined, kind: TextDraftKind) {
  const [text, setTextState] = useState("");
  const [saved, setSaved] = useState(false);
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    touched.current = false;
    setTextState("");
    setSaved(false);
    if (!woId) return;
    let live = true;
    void loadTextDraft(woId, kind).then((value) => {
      if (!live || !value || touched.current) return;
      setTextState(value);
      setSaved(true);
    });
    return () => {
      live = false;
    };
  }, [woId, kind]);

  useEffect(() => {
    if (!woId || !touched.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveTextDraft(woId, kind, latest.current).then(() => setSaved(latest.current.trim().length > 0));
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [text, woId, kind]);

  // Leaving the screen with unsaved typing still keeps it.
  useEffect(
    () => () => {
      if (woId && touched.current && latest.current.trim()) void saveTextDraft(woId, kind, latest.current);
    },
    [woId, kind]
  );

  const setText = useCallback((next: string) => {
    touched.current = true;
    setTextState(next);
  }, []);

  /** After the server stored the text (or the person cleared the box on purpose). */
  const clear = useCallback(() => {
    touched.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setTextState("");
    setSaved(false);
    if (woId) void clearTextDraft(woId, kind);
  }, [woId, kind]);

  return { text, setText, clear, saved };
}
