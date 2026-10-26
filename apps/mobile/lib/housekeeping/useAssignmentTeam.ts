import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  DEFAULT_TEAM_VIEW_STATE,
  buildTeamChips,
  buildTeamFilterOptions,
  isDefaultTeamViewState,
  removeTeamChip,
  runTeamQuery,
  teamViewBadge,
  type TeamChip,
  type TeamFilterOptions,
  type TeamQueryResult,
  type TeamViewState,
} from "@/lib/housekeeping/assignmentTeamQuery";
import { buildTeamCard, type TeamCardModel, type Translate } from "@/lib/housekeeping/assignmentTeamView";

/* The Team tab's state and derived lists.

   Like the Rooms tab's, this is plain local state over the verified model: nothing here fetches, so typing never
   causes a request and a refresh never loses what the supervisor typed or chose. Because it is held by the screen
   (not by the tab), switching Rooms ↔ Team keeps the search, filters and sort exactly as they were.

   The state belongs to one signed-in hotel and person: when `resetKey` changes it starts over, so a floor from one
   property can never filter another. A new hotel DAY keeps the supervisor's view. */

export interface UseAssignmentTeamInput {
  model: AssignmentsModel;
  t: Translate;
  /** `tenant:user`; a change resets search, filters and sort. */
  resetKey: string | null;
}

export interface AssignmentTeamView {
  search: string;
  setSearch: (text: string) => void;
  clearSearch: () => void;
  state: TeamViewState;
  applyState: (state: TeamViewState) => void;
  removeChip: (chip: TeamChip) => void;
  clearFilters: () => void;
  clearAll: () => void;
  options: TeamFilterOptions;
  query: TeamQueryResult;
  chips: TeamChip[];
  badge: number;
  cards: Map<string, TeamCardModel>;
  isDefault: boolean;
  /** A verified roster exists, so "Most available" is a real ranking. */
  rosterVerified: boolean;
}

export function useAssignmentTeam({ model, t, resetKey }: UseAssignmentTeamInput): AssignmentTeamView {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<TeamViewState>(DEFAULT_TEAM_VIEW_STATE);
  const deferredSearch = useDeferredValue(search);

  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setSearch("");
    setState(DEFAULT_TEAM_VIEW_STATE);
  }, [resetKey]);

  const team = model.team;
  const rosterVerified = model.rosterTrust === "verified" && model.staffListKnown;
  const options = useMemo(() => buildTeamFilterOptions(team ?? []), [team]);
  const query = useMemo(
    () => runTeamQuery({ team: team ?? [], search: deferredSearch, filters: state.filters, sort: state.sort, rosterVerified }),
    [team, deferredSearch, state, rosterVerified],
  );
  const chips = useMemo(() => buildTeamChips(state, options), [state, options]);
  const cards = useMemo(() => new Map(query.visible.map((member) => [member.userId, buildTeamCard(member, t)] as const)), [query.visible, t]);

  const removeChip = useCallback((chip: TeamChip) => setState((current) => removeTeamChip(current, chip)), []);
  const clearFilters = useCallback(() => setState(DEFAULT_TEAM_VIEW_STATE), []);
  const clearAll = useCallback(() => {
    setSearch("");
    setState(DEFAULT_TEAM_VIEW_STATE);
  }, []);
  const clearSearch = useCallback(() => setSearch(""), []);

  return {
    search,
    setSearch,
    clearSearch,
    state,
    applyState: setState,
    removeChip,
    clearFilters,
    clearAll,
    options,
    query,
    chips,
    badge: teamViewBadge(state),
    cards,
    isDefault: isDefaultTeamViewState(state),
    rosterVerified,
  };
}
