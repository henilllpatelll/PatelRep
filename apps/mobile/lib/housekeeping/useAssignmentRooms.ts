import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  QUICK_VIEWS,
  buildFilterOptions,
  queueOf,
  runAssignmentQuery,
  toggleQuickView,
  type AssignmentFilterOptions,
  type AssignmentQueryResult,
  type QuickView,
} from "@/lib/housekeeping/assignmentQuery";
import {
  DEFAULT_VIEW_STATE,
  buildActiveChips,
  buildListItems,
  buildRoomCard,
  isDefaultViewState,
  removeActiveChip,
  viewStateBadge,
  type ActiveChip,
  type AssignmentViewState,
  type RoomCardModel,
  type RoomsListItem,
  type Translate,
} from "@/lib/housekeeping/assignmentRoomsView";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";

/* The Rooms tab's state and derived lists.

   Search, scope, filters and sort are plain local state over the verified model: nothing here fetches, so a
   keystroke never causes a request and a refresh never loses what the supervisor typed. The text that drives
   the query is DEFERRED, so typing stays responsive on a large hotel and the list does not flicker between
   keystrokes while a refresh lands.

   The state belongs to one signed-in hotel and person: when `resetKey` changes (another hotel, another user)
   it starts over, so a floor or building from one property can never filter another. A new hotel DAY keeps
   the supervisor's view — the options below are re-read from the new day's rooms. */

export interface UseAssignmentRoomsInput {
  model: AssignmentsModel;
  gate: MutationGate;
  language: string;
  t: Translate;
  /** `tenant:user`; a change resets search, filters and sort. */
  resetKey: string | null;
}

export interface AssignmentRoomsView {
  search: string;
  setSearch: (text: string) => void;
  clearSearch: () => void;
  state: AssignmentViewState;
  /** Replace scope + filters + sort at once (the filter sheet's Apply). */
  applyState: (state: AssignmentViewState) => void;
  pressQuick: (view: QuickView) => void;
  removeChip: (chip: ActiveChip) => void;
  clearFilters: () => void;
  clearAll: () => void;
  /** The queue behind the query: remaining work only, in the model's priority order. */
  queue: AssignmentRoom[];
  options: AssignmentFilterOptions;
  query: AssignmentQueryResult;
  chips: ActiveChip[];
  /** Filter-button badge: applied narrowing the quick chips do not already show, plus a non-default sort. */
  badge: number;
  items: RoomsListItem[];
  cards: Map<string, RoomCardModel>;
  quickViews: readonly QuickView[];
  isDefault: boolean;
}

export function useAssignmentRooms({ model, gate, language, t, resetKey }: UseAssignmentRoomsInput): AssignmentRoomsView {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<AssignmentViewState>(DEFAULT_VIEW_STATE);
  const deferredSearch = useDeferredValue(search);

  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setSearch("");
    setState(DEFAULT_VIEW_STATE);
  }, [resetKey]);

  const rooms = model.rooms;
  const queue = useMemo(() => (rooms ? queueOf(rooms) : []), [rooms]);
  const options = useMemo(() => buildFilterOptions(queue), [queue]);

  const query = useMemo(
    () => runAssignmentQuery({ rooms: queue, search: deferredSearch, filters: state.filters, scope: state.scope, sort: state.sort }),
    [queue, deferredSearch, state],
  );

  const items = useMemo(() => buildListItems(query.visible, state.sort === "priority"), [query.visible, state.sort]);

  const now = model.generatedAt;
  const timeZone = model.timeZone;
  const cards = useMemo(() => {
    const context = { now, timeZone, language, gate, t };
    return new Map(query.visible.map((entry) => [entry.room.roomId, buildRoomCard(entry, context)] as const));
  }, [query.visible, now, timeZone, language, gate, t]);

  const chips = useMemo(() => buildActiveChips(state, options), [state, options]);

  const pressQuick = useCallback((view: QuickView) => {
    setState((current) => {
      const next = toggleQuickView(view, { scope: current.scope, priority: current.filters.priority });
      return { ...current, scope: next.scope, filters: { ...current.filters, priority: next.priority } };
    });
  }, []);
  const removeChip = useCallback((chip: ActiveChip) => setState((current) => removeActiveChip(current, chip)), []);
  const clearFilters = useCallback(() => setState(DEFAULT_VIEW_STATE), []);
  const clearAll = useCallback(() => {
    setSearch("");
    setState(DEFAULT_VIEW_STATE);
  }, []);
  const clearSearch = useCallback(() => setSearch(""), []);

  return {
    search,
    setSearch,
    clearSearch,
    state,
    applyState: setState,
    pressQuick,
    removeChip,
    clearFilters,
    clearAll,
    queue,
    options,
    query,
    chips,
    badge: viewStateBadge(state),
    items,
    cards,
    quickViews: QUICK_VIEWS,
    isDefault: isDefaultViewState(state),
  };
}
