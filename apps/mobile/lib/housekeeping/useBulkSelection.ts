import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  MAX_BULK_SELECTION,
  addRooms,
  blockedIn,
  buildingGroups,
  floorGroups,
  removeRooms,
  scopeState,
  selectableIn,
  selectionSummary,
  toggleRoom,
  toggleScope,
  type BulkScope,
  type ScopeGroup,
  type SelectionRefusal,
  type SelectionSummary,
} from "@/lib/housekeeping/assignmentBulk";

/* The Rooms tab's bulk selection mode.

   A selection is a set of room ids held by the screen: it survives scrolling, searching and filtering, and it
   is re-validated against the live model on every render (`summary`), never trusted. It changes nothing on the
   server and nothing in the draft; it only becomes proposed changes when the supervisor allocates it.

   It belongs to one hotel, person and hotel day: any of them changing ends selection mode, so a floor picked at one
   property can never be allocated at another, and yesterday's picks never reach today's board. */

/** What the last tap was refused for, or what was trimmed. Shown once, then cleared by the next action. */
export type SelectionNotice =
  | { kind: "refused"; reason: SelectionRefusal; roomNumber: string }
  | { kind: "truncated" };

export interface UseBulkSelectionInput {
  model: AssignmentsModel;
  /** The assignment queue (remaining work), in the model's priority order. Floors and buildings are read from it. */
  queue: readonly AssignmentRoom[];
  /** The rooms the current search and filters leave. "Select all" means these. */
  visible: readonly AssignmentRoom[];
  scopeKey: string | null;
}

export interface BulkSelectionController {
  selecting: boolean;
  selected: ReadonlySet<string>;
  summary: SelectionSummary;
  /** Unowned rooms in view that selection cannot take (held back or being worked). */
  blockedVisible: number;
  /** Selectable rooms among those in view: what "Select all" would take. */
  matching: number;
  floors: ScopeGroup[];
  buildings: ScopeGroup[];
  limit: number;
  notice: SelectionNotice | null;
  start: () => void;
  stop: () => void;
  toggle: (entry: AssignmentRoom) => void;
  selectAllMatching: () => void;
  toggleScope: (scope: BulkScope) => void;
  stateOfScope: (scope: BulkScope) => "all" | "some" | "none";
  clear: () => void;
  /** Takes the selected rooms that are no longer eligible out of the selection. */
  removeInvalid: () => void;
  /** After rooms were allocated: they leave the selection. */
  consume: (roomIds: Iterable<string>) => void;
}

export function useBulkSelection({ model, queue, visible, scopeKey }: UseBulkSelectionInput): BulkSelectionController {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<SelectionNotice | null>(null);

  // Another hotel, person or day ends the mode.
  const scopeId = `${scopeKey ?? ""}|${model.hotelDate}`;
  const lastScope = useRef(scopeId);
  useEffect(() => {
    if (lastScope.current === scopeId) return;
    lastScope.current = scopeId;
    setSelecting(false);
    setSelected(new Set());
    setNotice(null);
  }, [scopeId]);

  const summary = useMemo(() => selectionSummary(model.rooms, selected), [model.rooms, selected]);
  const blockedVisible = useMemo(() => blockedIn(visible).length, [visible]);
  const matching = useMemo(() => selectableIn(visible).length, [visible]);
  const floors = useMemo(() => floorGroups(queue), [queue]);
  const buildings = useMemo(() => buildingGroups(queue), [queue]);

  const start = useCallback(() => {
    setSelecting(true);
    setNotice(null);
  }, []);
  const stop = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setNotice(null);
  }, []);

  const apply = useCallback((change: { selected: ReadonlySet<string>; refused?: SelectionRefusal; truncated?: boolean }, roomNumber = "") => {
    setSelected(change.selected);
    setNotice(change.refused ? { kind: "refused", reason: change.refused, roomNumber } : change.truncated ? { kind: "truncated" } : null);
  }, []);

  const toggle = useCallback((entry: AssignmentRoom) => apply(toggleRoom(selected, entry), entry.room.roomNumber), [apply, selected]);
  const selectAllMatching = useCallback(() => apply(addRooms(selected, visible)), [apply, selected, visible]);
  const toggleScopeGroup = useCallback((scope: BulkScope) => apply(toggleScope(selected, queue, scope)), [apply, queue, selected]);
  const stateOfScope = useCallback((scope: BulkScope) => scopeState(queue, scope, selected), [queue, selected]);
  const clear = useCallback(() => {
    setSelected(new Set());
    setNotice(null);
  }, []);
  const removeInvalid = useCallback(() => setSelected((current) => removeRooms(current, summary.invalid.map((entry) => entry.roomId))), [summary.invalid]);
  const consume = useCallback((roomIds: Iterable<string>) => setSelected((current) => removeRooms(current, roomIds)), []);

  return {
    selecting,
    selected,
    summary,
    blockedVisible,
    matching,
    floors,
    buildings,
    limit: MAX_BULK_SELECTION,
    notice,
    start,
    stop,
    toggle,
    selectAllMatching,
    toggleScope: toggleScopeGroup,
    stateOfScope,
    clear,
    removeInvalid,
    consume,
  };
}
