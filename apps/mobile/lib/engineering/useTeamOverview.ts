import { useEffect } from "react";
import { fetchTeamOverview, fetchTechnicians, type Technician, type TeamOverview } from "@/lib/api/engineeringTeam";
import { onAssignmentChanged } from "@/lib/engineering/teamEvents";
import { useAsyncResource, type AsyncResource } from "@/lib/engineering/useAsyncResource";

/** The team overview for one hotel + person. Re-reads after any assignment; a failed refresh keeps the last good figures. */
export function useTeamOverview(scope: string | null, enabled = true): AsyncResource<TeamOverview> {
  const resource = useAsyncResource((signal) => fetchTeamOverview(signal), { scope, key: "overview", enabled });
  const { reload } = resource;
  useEffect(() => onAssignmentChanged(() => void reload()), [reload]);
  return resource;
}

/** The people work can be assigned to (loaded only while the sheet is open). */
export function useTechnicians(scope: string | null, enabled: boolean): AsyncResource<Technician[]> {
  return useAsyncResource((signal) => fetchTechnicians(signal), { scope, key: "technicians", enabled });
}
