import { Redirect, useLocalSearchParams } from "expo-router";
import { ForecastScreen } from "@/components/scheduling/ForecastScreen";
import { isYmd } from "@/lib/scheduling/teamScheduleDates";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under the Team Schedule: the housekeeping staffing forecast (`?date=` opens that day's details). Not a tab.
 *  Same access as the schedule; the server re-checks the role and department on every read. */
export default function ForecastRoute() {
  const user = useAppStore((state) => state.user);
  const params = useLocalSearchParams<{ date?: string }>();
  const role = user?.effective_role ?? user?.role;
  if (!canViewTeamSchedule(role)) return <Redirect href={"/(app)/home" as never} />;
  return <ForecastScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} openDate={isYmd(params.date) ? params.date : null} />;
}
