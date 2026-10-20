import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRoomHistory, postRoomNote, type RoomHistoryRow } from "@/lib/api/roomPanels";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";
import { classifyWriteFailure, type WriteFailure } from "@/lib/housekeeping/roomPanelErrors";
import { checkNote, noteWasRecorded, type NoteIssue } from "@/lib/housekeeping/roomNote";

/* ─── Supervisor note controller ────────────────────────────────────────────
   ONE state for the "Add note" drawer. It protects three things:
   - the draft: it survives every recoverable failure (and Back/forward within the drawer) and is cleared only
     when the server confirmed the note;
   - the write: one in flight at a time, never retried by itself. A refused write (4xx) did not happen. A write
     with no answer (offline, timeout, 5xx) MAY have happened, so the room's history is READ BACK before anything
     else is said; if even that fails the drawer stays on "check again", which only reads;
   - the claim: "saved" appears only after the server confirmed (or the read-back found the note). A board that
     fails to refresh afterwards is reported as its own thing. */

export type NoteError = NoteIssue | WriteFailure | "paused" | "unconfirmed" | "scope_changed";

export interface NoteController {
  draft: string;
  setDraft: (text: string) => void;
  busy: boolean;
  error: NoteError | null;
  /** An unclear outcome is waiting to be checked; the next press only reads. */
  needsCheck: boolean;
  canSave: boolean;
  save: () => Promise<void>;
  /** Forget the draft and any error (leaving the drawer on purpose). */
  reset: () => void;
}

export interface UseRoomNoteInput {
  /** The live board room, or null when it left the board. */
  room: BoardRoom | null;
  gate: MutationGate;
  scopeKey: string | null;
  userId: string | null;
  refresh: () => Promise<void>;
  /** Called once a note is confirmed, so the drawer can step back. */
  onSaved: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  /** Test seams. */
  post?: typeof postRoomNote;
  readHistory?: (roomId: string) => Promise<RoomHistoryRow[]>;
  now?: () => number;
  settle?: () => Promise<void>;
}

const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function useRoomNote({
  room,
  gate,
  scopeKey,
  userId,
  refresh,
  onSaved,
  t,
  toast,
  post = postRoomNote,
  readHistory = fetchRoomHistory,
  now = Date.now,
  settle = defaultSettle,
}: UseRoomNoteInput): NoteController {
  const [draft, setDraftState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<NoteError | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  // What the unclear write was: the text actually sent and when, so the read-back can look for exactly it.
  const pending = useRef<{ text: string; sentAt: number } | null>(null);
  const latest = useRef({ room, scopeKey, onSaved, t, toast, refresh });
  latest.current = { room, scopeKey, onSaved, t, toast, refresh };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const roomId = room?.roomId ?? null;
  const check = checkNote(draft);

  const setDraft = useCallback((text: string) => {
    setDraftState(text);
    // Editing after a refusal clears it; an unclear write stays flagged so the person is never invited to resend blindly.
    setError((current) => (current === "empty" || current === "too_long" || current === "invalid" || current === "rejected" ? null : current));
  }, []);

  const reset = useCallback(() => {
    setDraftState("");
    setError(null);
    setNeedsCheck(false);
    pending.current = null;
  }, []);

  const save = useCallback(async () => {
    if (writing.current || roomId === null) return;
    const started = scopeKey;
    const sameScope = () => mounted.current && latest.current.scopeKey === started;
    const wrote = pending.current;
    // After an unclear write the draft may no longer match what was sent; judge the text that was actually sent.
    const text = wrote?.text ?? check.text;
    if (!wrote) {
      if (check.issue) {
        setError(check.issue);
        return;
      }
    }
    if (!gate.allowed) {
      setError("paused");
      return;
    }
    if (started === null) {
      setError("scope_changed");
      return;
    }

    writing.current = true;
    setBusy(true);
    setError(null);
    const finish = () => {
      writing.current = false;
      if (mounted.current) setBusy(false);
    };
    const succeed = async (message: string) => {
      finish();
      if (!sameScope()) return;
      pending.current = null;
      setNeedsCheck(false);
      setDraftState("");
      latest.current.toast.success(message);
      latest.current.onSaved();
      // The note is confirmed; whether the board caught up is a separate question and is reported as one.
      await latest.current.refresh().catch(() => undefined);
      await settle();
      const reflected = latest.current.room?.latestNote?.trim();
      if (mounted.current && reflected !== text && !(reflected && text.startsWith(reflected))) {
        latest.current.toast.info(latest.current.t("roomBoard.panel.note.boardBehind"));
      }
    };

    try {
      if (wrote) {
        // Only a read: was the note recorded?
        const rows = await readHistory(roomId);
        if (!sameScope()) return finish();
        if (noteWasRecorded(rows, { text, userId, sinceMs: wrote.sentAt })) return await succeed(latest.current.t("roomBoard.panel.note.saved"));
        // Read fine, no such note: it never landed, so sending it again cannot duplicate it.
        pending.current = null;
        setNeedsCheck(false);
        finish();
        setError("uncertain");
        return;
      }

      const sentAt = now();
      try {
        const result = await post(roomId, text);
        if (!sameScope()) return finish();
        return await succeed(latest.current.t(result.replayed ? "roomBoard.panel.note.alreadySaved" : "roomBoard.panel.note.saved"));
      } catch (failure) {
        if (!sameScope()) return finish();
        const kind = classifyWriteFailure(failure);
        if (kind !== "uncertain") {
          finish();
          setError(kind);
          return;
        }
        // No answer: do not resend. Look for the note instead.
        pending.current = { text, sentAt };
        try {
          const rows = await readHistory(roomId);
          if (!sameScope()) return finish();
          if (noteWasRecorded(rows, { text, userId, sinceMs: sentAt })) return await succeed(latest.current.t("roomBoard.panel.note.saved"));
          pending.current = null;
          finish();
          setError("uncertain");
        } catch {
          finish();
          setNeedsCheck(true);
          setError("unconfirmed");
        }
      }
    } catch {
      finish();
      if (sameScope()) {
        setNeedsCheck(true);
        setError("unconfirmed");
      }
    }
  }, [roomId, scopeKey, check.text, check.issue, gate.allowed, userId, post, readHistory, now, settle]);

  return {
    draft,
    setDraft,
    busy,
    error,
    needsCheck,
    canSave: !busy && gate.allowed && (needsCheck || check.canSave),
    save,
    reset,
  };
}
