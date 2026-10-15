import { createAiCache } from "@/lib/housekeeping/aiCache";
import type { ShiftBriefing } from "@/lib/ai/briefing";

/* ─── The one housekeeping briefing ─────────────────────────────────────────
   Two places show "your day": Home's briefing drawer and the floating assistant.
   They read the SAME briefing from here:

   - `published`  the deterministic briefing Home builds from the authoritative
                  My Rooms dashboard (room order, restrictions and all). It costs
                  nothing and is what is shown when no AI answer exists.
   - `briefingCache` the optional paid AI wording. Only Home's deliberate
                  "Get AI briefing" request ever fills it; nothing that merely
                  reads (the floating card, a tab switch, a refresh) can spend a
                  credit.

   This module is storage only (no stores, no network) so the sign-out reset in
   lib/ai/session can import it without a cycle. */

/** A briefing is good for the morning's planning; it is reused, not re-bought, until it is this old. */
export const BRIEFING_TTL_MS = 45 * 60_000;
export const briefingCache = createAiCache<ShiftBriefing>(BRIEFING_TTL_MS);

/** `${tenantId}:${userId}:${shiftDate}:${language}`; briefings never carry across people, hotels, days or languages. */
export function briefingCacheKey(scope: string, shiftDate: string, language: string): string {
  return `${scope}:${shiftDate}:${language}`;
}

/** The room Home puts first, in the person's words. Facts only; the assistant shows it without asking a model. */
export interface PublishedNextRoom {
  roomId: string;
  roomNumber: string;
  /** "continue" an open session, or "start" the next room. */
  kind: "continue" | "start";
  /** e.g. "Departure · Floor 2" */
  context: string;
  /** The strongest verified reason, already in the person's language. */
  reason: string;
  estimateMinutes: number | null;
}

export interface PublishedBriefing {
  key: string;
  /** Home's deterministic briefing: the authoritative order. */
  local: ShiftBriefing;
  /** Every room number on this person's list. */
  knownRooms: string[];
  /** Rooms that must never be recommended (do-not-disturb, declined service, out of service...). */
  restrictedRooms: string[];
  /** Home's lead room right now (null when there is nothing to recommend). Optional for older publishers. */
  nextRoom?: PublishedNextRoom | null;
}

let published: PublishedBriefing | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameNextRoom(a: PublishedNextRoom | null | undefined, b: PublishedNextRoom | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.roomId === b.roomId &&
    a.roomNumber === b.roomNumber &&
    a.kind === b.kind &&
    a.context === b.context &&
    a.reason === b.reason &&
    a.estimateMinutes === b.estimateMinutes
  );
}

function samePublished(a: PublishedBriefing, b: PublishedBriefing): boolean {
  return (
    sameNextRoom(a.nextRoom, b.nextRoom) &&
    a.key === b.key &&
    a.local.headline === b.local.headline &&
    a.local.estimatedMinutes === b.local.estimatedMinutes &&
    sameList(a.local.plan, b.local.plan) &&
    sameList(a.local.watchouts, b.local.watchouts) &&
    sameList(a.knownRooms, b.knownRooms) &&
    sameList(a.restrictedRooms, b.restrictedRooms)
  );
}

/** Home calls this whenever its model changes; readers hear about it only when something actually differs. */
export function publishLocalBriefing(entry: PublishedBriefing): void {
  if (published && samePublished(published, entry)) return;
  published = entry;
  notify();
}

export function getPublishedBriefing(): PublishedBriefing | null {
  return published;
}

/** Tell readers a stored AI answer appeared or went away. */
export function notifyBriefingChange(): void {
  notify();
}

export function subscribeBriefing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sign-out / account switch: the next person starts from nothing. */
export function resetSharedBriefing(): void {
  published = null;
  briefingCache.clear();
  notify();
}
