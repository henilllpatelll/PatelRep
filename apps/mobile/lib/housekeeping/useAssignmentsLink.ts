import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  linkNamesRecord,
  parseAssignmentsParams,
  resolveAssignmentsLink,
  type AssignmentsFilterParam,
  type AssignmentsLink,
  type AssignmentsTabParam,
} from "@/lib/navigation/assignmentsLink";

/* Honours a deep link into Assignments (see lib/navigation/assignmentsLink.ts).

   - The link is SINGLE-USE: it is read from the route params and the params are cleared at once, so a later
     link (even to the same place) arrives as a fresh request and re-opening the app never replays an old one.
   - Tab and Rooms filter are view state, applied immediately.
   - A named room or person is judged only against a board the server verified just now: a loading, stale or
     failed board proves nothing about a record, so the request waits for the next good load. The ids are looked
     up in this hotel's verified model only, so another property's record is simply "not found".
   - A request that is waiting is dropped when the signed-in hotel or person changes. */

export type AssignmentsLinkNotice = "room_missing" | "staff_missing";

export interface AssignmentsLinkActions {
  /** Show a tab and (Rooms only) a filter. Called for every accepted link, before any record is looked up. */
  show: (tab: AssignmentsTabParam, filter: AssignmentsFilterParam | null) => void;
  /** Close whatever sheet is open so the linked record is the one thing in front of the supervisor. */
  reset: () => void;
  openRoom: (roomId: string) => void;
  openStaff: (userId: string) => void;
}

export interface UseAssignmentsLink {
  notice: AssignmentsLinkNotice | null;
  dismissNotice: () => void;
}

export function useAssignmentsLink({
  model,
  scopeKey,
  actions,
}: {
  model: AssignmentsModel;
  scopeKey: string | null;
  actions: AssignmentsLinkActions;
}): UseAssignmentsLink {
  const params = useLocalSearchParams<{ tab?: string; filter?: string; roomId?: string; staffId?: string }>();
  const link = useMemo(
    () => parseAssignmentsParams(params as Record<string, unknown>),
    // Compared by value: the params object is a new reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.tab, params.filter, params.roomId, params.staffId],
  );
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const pending = useRef<{ link: AssignmentsLink; scopeKey: string | null } | null>(null);
  const [notice, setNotice] = useState<AssignmentsLinkNotice | null>(null);

  // Accept: apply the view, remember a record to look up, and consume the params.
  useEffect(() => {
    const hasParams = params.tab !== undefined || params.filter !== undefined || params.roomId !== undefined || params.staffId !== undefined;
    if (!hasParams) return;
    router.setParams({ tab: undefined, filter: undefined, roomId: undefined, staffId: undefined } as never);
    if (!link) return;
    setNotice(null);
    actionsRef.current.reset();
    actionsRef.current.show(link.tab, link.filter);
    pending.current = linkNamesRecord(link) ? { link, scopeKey } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, params.tab, params.filter, params.roomId, params.staffId]);

  const availability = model.availability.kind;
  const verified = availability === "ready" || availability === "verified_empty";
  const rooms = model.rooms;
  const team = model.team;
  // Resolve: only against a freshly verified board, and only for the scope the link arrived in.
  useEffect(() => {
    const held = pending.current;
    if (!held) return;
    if (held.scopeKey !== scopeKey) {
      pending.current = null;
      return;
    }
    if (!verified || rooms === null) return;
    pending.current = null;
    const resolution = resolveAssignmentsLink(
      held.link,
      new Set(rooms.map((entry) => entry.room.roomId)),
      new Set((team ?? []).map((member) => member.userId)),
    );
    if (resolution.room === "found" && held.link.roomId) actionsRef.current.openRoom(held.link.roomId);
    else if (resolution.room === "missing") setNotice("room_missing");
    if (resolution.staff === "found" && held.link.staffId) actionsRef.current.openStaff(held.link.staffId);
    else if (resolution.staff === "missing") setNotice("staff_missing");
  }, [verified, rooms, team, scopeKey, params.roomId, params.staffId]);

  const dismissNotice = useCallback(() => setNotice(null), []);
  return { notice, dismissNotice };
}
