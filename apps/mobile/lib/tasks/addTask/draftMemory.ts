import type { TaskDraft } from "@/lib/tasks/addTask/draft";

/* ─── In-memory Add Task draft ──────────────────────────────────────────────
   A half-written task survives the sheet being dismissed (and the Tasks screen remounting) for as
   long as the app process lives. It is deliberately NOT persisted to disk — task text can name
   guests and rooms — and it is bound to one hotel+user: a different owner never sees it. */

export type DraftStep = "describe" | "review";

export interface DraftSnapshot {
  draft: TaskDraft;
  step: DraftStep;
  /** The description the suggestions were made from; unchanged text never re-asks (so edits survive Back). */
  parsedText: string | null;
}

let held: { owner: string; snapshot: DraftSnapshot } | null = null;

export function ownerKey(hotelId: string | null | undefined, userId: string | null | undefined): string | null {
  return hotelId && userId ? `${hotelId}:${userId}` : null;
}

export function saveDraft(owner: string | null, snapshot: DraftSnapshot) {
  if (!owner) return;
  held = { owner, snapshot };
}

export function loadDraft(owner: string | null): DraftSnapshot | null {
  if (!owner || !held) return null;
  if (held.owner !== owner) {
    held = null; // another account/property: forget it rather than risk showing it
    return null;
  }
  return held.snapshot;
}

export function clearDraft() {
  held = null;
}
