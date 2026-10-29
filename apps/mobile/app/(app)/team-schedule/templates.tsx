import { Redirect } from "expo-router";
import { TemplatesScreen } from "@/components/scheduling/TemplatesScreen";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under the Team Schedule: the supervisor's reusable shift templates. Same access as the schedule;
 *  the server re-checks every read and write and scopes it to the supervisor's departments. */
export default function ShiftTemplatesRoute() {
  const user = useAppStore((state) => state.user);
  const role = user?.effective_role ?? user?.role;
  if (!canViewTeamSchedule(role)) return <Redirect href={"/(app)/home" as never} />;
  return <TemplatesScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
