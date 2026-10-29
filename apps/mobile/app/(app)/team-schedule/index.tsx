import { Redirect, useLocalSearchParams } from "expo-router";
import { TeamScheduleScreen } from "@/components/scheduling/TeamScheduleScreen";
import { parseTeamScheduleParams } from "@/lib/navigation/teamScheduleLink";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route (not a tab): the housekeeping supervisor's Team Schedule, opened from Today.
 *  The personal "My Schedule" (`/scheduling`) is a different route and is untouched. */
export default function TeamScheduleRoute() {
  const user = useAppStore((state) => state.user);
  const params = useLocalSearchParams();
  const role = user?.effective_role ?? user?.role;
  if (!canViewTeamSchedule(role)) return <Redirect href={"/(app)/home" as never} />;
  // Keyed by hotel + person, so signing in as someone else (or switching hotel) starts from a clean screen.
  return <TeamScheduleScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} link={parseTeamScheduleParams(params)} />;
}
