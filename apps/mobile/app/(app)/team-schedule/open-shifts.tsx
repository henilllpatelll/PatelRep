import { Redirect, useLocalSearchParams } from "expo-router";
import { OpenShiftsScreen } from "@/components/scheduling/OpenShiftsScreen";
import { isYmd } from "@/lib/scheduling/teamScheduleDates";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under the Team Schedule: every shift that still needs a person. Not a tab. */
export default function OpenShiftsRoute() {
  const user = useAppStore((state) => state.user);
  const params = useLocalSearchParams<{ date?: string }>();
  const role = user?.effective_role ?? user?.role;
  if (!canViewTeamSchedule(role)) return <Redirect href={"/(app)/home" as never} />;
  return <OpenShiftsScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} initialDate={isYmd(params.date) ? params.date : null} />;
}
