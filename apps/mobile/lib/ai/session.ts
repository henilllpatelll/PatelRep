import { resetSharedBriefing } from "@/lib/ai/shiftBriefingSource";

/* ─── Whose assistant session is this? ──────────────────────────────────────
   Everything the assistant keeps -- the open conversation, saved history, the
   shared briefing -- belongs to one person in one hotel. `assistantScope` names
   that pair; `resetAssistantSession` drops everything held in memory the moment
   the signed-in person or hotel changes (sign-out included), so nothing carries
   over to the next person on the device. */

export function assistantScope(user: { tenant_id?: string | null; id?: string | null } | null | undefined): string | null {
  return user?.tenant_id && user?.id ? `${user.tenant_id}:${user.id}` : null;
}

const resetters = new Set<() => void>();

/** A conversation controller registers here so a sign-out / account switch clears it. Returns an unsubscribe. */
export function onAssistantSessionReset(fn: () => void): () => void {
  resetters.add(fn);
  return () => {
    resetters.delete(fn);
  };
}

export function resetAssistantSession(): void {
  for (const fn of [...resetters]) {
    try {
      fn();
    } catch {
      // One surface failing to reset must not stop the others.
    }
  }
  resetSharedBriefing();
}
