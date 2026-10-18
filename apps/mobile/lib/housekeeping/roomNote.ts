/* ─── Supervisor room note — rules (pure) ───────────────────────────────────
   POST /rooms/{id}/notes takes `{ text }` (max 1000 characters, non-empty after trimming) and writes a
   note-only history entry: it never changes the room's status. The server replays an identical note from the
   same person inside two minutes as one note, which is what makes a manual retry safe in that window.

   The note is an operational note on the room — visible to every authorised staff member of the hotel who can
   read the room's history. There is no per-note audience, so nothing here may call a note private. */

export const ROOM_NOTE_MAX_LENGTH = 1000;
/** The server's replay window for an identical note from the same person. */
export const NOTE_REPLAY_WINDOW_MS = 2 * 60 * 1000;

export type NoteIssue = "empty" | "too_long";

export interface NoteCheck {
  /** What is sent: the text without surrounding whitespace. */
  text: string;
  length: number;
  remaining: number;
  issue: NoteIssue | null;
  canSave: boolean;
}

export function checkNote(raw: string): NoteCheck {
  const text = raw.trim();
  const issue: NoteIssue | null = text.length === 0 ? "empty" : text.length > ROOM_NOTE_MAX_LENGTH ? "too_long" : null;
  return { text, length: text.length, remaining: ROOM_NOTE_MAX_LENGTH - text.length, issue, canSave: issue === null };
}

/** The slice of a GET /rooms/{id}/history row needed to recognise a note. */
export interface HistoryRowLike {
  from_status?: string | null;
  to_status?: string | null;
  notes?: string | null;
  changed_by?: string | null;
  created_at?: string | null;
}

/** A note-only entry: the status did not change and there is text. Status changes never count as notes. */
export function isNoteEntry(row: HistoryRowLike): boolean {
  return Boolean(row.notes && row.notes.trim()) && row.from_status === row.to_status;
}

/**
 * Did THIS person already record this exact note since `sinceMs`? Used after an unclear outcome (no answer, 5xx):
 * the room's history is read back instead of sending the note a second time. A little clock skew is tolerated.
 */
export function noteWasRecorded(rows: readonly HistoryRowLike[], input: { text: string; userId: string | null; sinceMs: number }): boolean {
  if (!input.userId) return false;
  const floor = input.sinceMs - 60_000;
  return rows.some((row) => {
    if (!isNoteEntry(row) || row.changed_by !== input.userId || row.notes?.trim() !== input.text) return false;
    const at = row.created_at ? Date.parse(row.created_at) : NaN;
    return !Number.isNaN(at) && at >= floor;
  });
}
