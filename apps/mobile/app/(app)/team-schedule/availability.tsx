import { Redirect } from "expo-router";
import { TeamAvailabilityScreen } from "@/components/scheduling/TeamAvailabilityScreen";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under the Team Schedule: what each person in this supervisor's departments said they can work. Not a tab. */
export default function TeamAvailabilityRoute() {
  const user = useAppStore((state) => state.user);
  const role = user?.effective_role ?? user?.role;
  if (!canViewTeamSchedule(role)) return <Redirect href={"/(app)/home" as never} />;
  return <TeamAvailabilityScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
