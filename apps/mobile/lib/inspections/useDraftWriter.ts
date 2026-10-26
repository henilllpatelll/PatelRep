import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { InspectionDraft } from "@/lib/inspections/draft";
import { writeDraft } from "@/lib/inspections/draftStore";

/* ─── Writing the draft to the phone, safely ────────────────────────────────
   Every edit is tracked at once and written after a short pause, so a burst of taps is one write; the pause is cut
   short when the app leaves the foreground, when the screen goes away, and when the supervisor asks to save and exit.

   • Writes never overlap: each runs after the previous finished and always writes the NEWEST draft, so an older
     draft can never land on top of a newer one.
   • An edit that arrives while a write is running is written next, not lost.
   • "saved" is claimed only from a write that completed. A failed write leaves the work marked unsaved so the next
     flush tries again, and `flush()` says plainly whether everything is on the phone. */

export type SaveState =
  /** Nothing to keep yet, or nothing changed since the last save. */
  | { status: "idle" }
  /** Changed; waiting for the short pause before writing. */
  | { status: "pending" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "failed" };

export const DRAFT_WRITE_DELAY_MS = 600;
/** More than this many back-to-back rewrites in one flush means edits keep arriving; the rest follow on the next flush. */
const MAX_PASSES = 5;

export interface DraftWriter {
  state: SaveState;
  /** Record the newest draft; it is written after the pause. */
  track: (draft: InspectionDraft) => void;
  /** Write now. Resolves true only when everything tracked has been stored. */
  flush: () => Promise<boolean>;
  /** Forget what is tracked without writing (the draft was discarded, or the account changed). */
  reset: () => void;
  /** Is anything tracked but not yet stored? */
  isDirty: () => boolean;
}

export function useDraftWriter({
  delayMs = DRAFT_WRITE_DELAY_MS,
  write = writeDraft,
  now = Date.now,
}: { delayMs?: number; write?: (draft: InspectionDraft) => Promise<boolean>; now?: () => number } = {}): DraftWriter {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const latest = useRef<InspectionDraft | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tail = useRef<Promise<boolean>>(Promise.resolve(true));
  const mounted = useRef(true);
  const writeRef = useRef(write);
  writeRef.current = write;
  const nowRef = useRef(now);
  nowRef.current = now;

  const show = useCallback((next: SaveState) => {
    if (mounted.current) setState(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const draft = latest.current;
      if (!draft || !dirty.current) return true;
      show({ status: "saving" });
      // Cleared BEFORE the write: an edit that lands meanwhile sets it again and is written on the next pass.
      dirty.current = false;
      let ok = false;
      try {
        ok = await writeRef.current(draft);
      } catch {
        ok = false;
      }
      if (!ok) {
        dirty.current = true;
        show({ status: "failed" });
        return false;
      }
      if (!dirty.current) {
        show({ status: "saved", at: nowRef.current() });
        return true;
      }
    }
    show({ status: "pending" });
    return false;
  }, [show]);

  const flush = useCallback(() => {
    clearTimer();
    tail.current = tail.current.then(run, run);
    return tail.current;
  }, [clearTimer, run]);

  const track = useCallback(
    (draft: InspectionDraft) => {
      latest.current = draft;
      dirty.current = true;
      show({ status: "pending" });
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, delayMs);
    },
    [clearTimer, delayMs, flush, show],
  );

  const reset = useCallback(() => {
    clearTimer();
    latest.current = null;
    dirty.current = false;
    show({ status: "idle" });
  }, [clearTimer, show]);

  // Leaving the foreground may be the last chance: write now.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") void flush();
    });
    return () => subscription.remove();
  }, [flush]);

  // The screen going away writes what is pending (the write itself outlives the component).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (dirty.current) {
        tail.current = tail.current.then(run, run);
      }
    };
  }, [run]);

  const isDirty = useCallback(() => dirty.current, []);
  return { state, track, flush, reset, isDirty };
}
