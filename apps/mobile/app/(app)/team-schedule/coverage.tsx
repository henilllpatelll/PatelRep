import { Redirect, useLocalSearchParams } from "expo-router";
import { FindCoverageScreen } from "@/components/scheduling/FindCoverageScreen";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under the Team Schedule: find a replacement for one uncovered shift (`?gapId=`). Same access as the
 *  schedule; the server re-checks every read and write and scopes it to the supervisor's departments. */
export default function FindCoverageRoute() {
  const user = useAppStore((state) => state.user);
  const params = useLocalSearchParams<{ gapId?: string }>();
  const role = user?.effective_role ?? user?.role;
  const gapId = typeof params.gapId === "string" ? params.gapId : "";
  if (!canViewTeamSchedule(role) || !gapId) return <Redirect href={"/(app)/team-schedule" as never} />;
  return <FindCoverageScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}:${gapId}`} gapId={gapId} />;
}
