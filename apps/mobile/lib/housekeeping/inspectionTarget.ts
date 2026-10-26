import type { InspectionTemplate, ReadyRoom } from "@/lib/api/inspections";
import { statusOf } from "@/lib/housekeeping/roomPanelErrors";

/* ─── Room-specific inspection handoff (pure) ───────────────────────────────
   The Room Board opens the Inspect screen with `?roomId=<stable id>` (the room NUMBER is only a label). The id is
   resolved against the inspection queue the server just returned for this hotel, so a foreign, finished or invented
   id can never select anything: it simply is not in the queue. Opening the screen this way never submits anything. */

export type InspectionTarget =
  | { kind: "none" }
  /** The param is not a plausible room id. */
  | { kind: "invalid" }
  /** A target was requested but the queue has not been verified yet (loading, or the load failed). */
  | { kind: "waiting" }
  | { kind: "ready"; room: ReadyRoom }
  /** The queue loaded and the room is not in it: already inspected, being cleaned again, or not this hotel's. */
  | { kind: "not_awaiting"; roomId: string };

/** Expo Router gives `string | string[] | undefined`; a plausible id is short and made of id characters only. */
export function normalizeRoomIdParam(raw: string | string[] | undefined | null): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : null;
}

const PLAUSIBLE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveInspectionTarget(param: string | null, queue: readonly ReadyRoom[], queueVerified: boolean): InspectionTarget {
  if (param === null) return { kind: "none" };
  if (!PLAUSIBLE_ID.test(param)) return { kind: "invalid" };
  if (!queueVerified) return { kind: "waiting" };
  const room = queue.find((candidate) => candidate.room_id === param);
  return room ? { kind: "ready", room } : { kind: "not_awaiting", roomId: param };
}

/* ─── The check before a result is sent ─────────────────────────────────────
   The supervisor reviewed the room some time ago. Before anything is written the queue and the checklist are read
   again; the result is only sent when the room is STILL awaiting inspection and the chosen checklist still exists.
   The server enforces the same rule on write, so this narrows the window and gives a clear message — it does not
   replace the server's answer. */

export type InspectionGuard = "ok" | "not_awaiting" | "template_changed" | "unavailable";

export async function checkBeforeInspecting(input: {
  roomId: string;
  templateId: string | undefined;
  /** The digest of the checklist the supervisor is working from; a different one means it was edited meanwhile. */
  templateFingerprint?: string;
  date: string;
  fetchQueue: (date: string) => Promise<ReadyRoom[]>;
  fetchTemplates: () => Promise<{ data: InspectionTemplate[] }>;
}): Promise<InspectionGuard> {
  try {
    const [queue, templates] = await Promise.all([input.fetchQueue(input.date), input.fetchTemplates()]);
    if (!queue.some((room) => room.room_id === input.roomId)) return "not_awaiting";
    if (input.templateId) {
      const current = templates.data.find((template) => template.id === input.templateId);
      if (!current) return "template_changed";
      // A same-id template whose items were edited is a different checklist: only the digest can tell.
      if (input.templateFingerprint && current.fingerprint && current.fingerprint !== input.templateFingerprint) return "template_changed";
    }
    return "ok";
  } catch {
    // Not knowing is not permission: nothing is sent on a guess.
    return "unavailable";
  }
}

/** A submit the server refused because the room is no longer awaiting inspection. */
export function isNoLongerAwaiting(error: unknown): boolean {
  return statusOf(error) === 409;
}
