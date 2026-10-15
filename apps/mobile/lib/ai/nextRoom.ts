import type { PublishedNextRoom } from "@/lib/ai/shiftBriefingSource";
import { getPublishedBriefing } from "@/lib/ai/shiftBriefingSource";
import type { Recommendation } from "@/lib/housekeeping/homeRecommendation";
import { describeRecommendation, roomContext } from "@/lib/housekeeping/homeText";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";

/* "My next room" never asks a model: it is the room Home already ranks first, from the same
   dashboard model My Rooms renders. Home publishes it (lib/ai/shiftBriefingSource) and the
   assistant only reads it, so the two can never disagree and reading it costs nothing. */

/** Home's lead recommendation as the assistant shows it, or null when there is nothing to recommend. */
export function nextRoomFromRecommendation(rec: Recommendation | null, t: Translate, ctx: TextContext): PublishedNextRoom | null {
  if (!rec) return null;
  const copy = describeRecommendation(rec, t, ctx);
  return {
    roomId: rec.room.id,
    roomNumber: rec.room.room_number,
    kind: rec.kind,
    context: roomContext(rec.room, t),
    reason: copy.reasons[0] ?? "",
    estimateMinutes: rec.timing.estimateMinutes ?? null,
  };
}

/** The next room for this person right now; null when Home has not published one for them (e.g. never opened Home). */
export function readNextRoom(scope: string | null): PublishedNextRoom | null {
  const published = getPublishedBriefing();
  if (!scope || !published || !published.key.startsWith(`${scope}:`)) return null;
  return published.nextRoom ?? null;
}
