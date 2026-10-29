import { Redirect } from "expo-router";
import { RequestsScreen } from "@/components/scheduling/RequestsScreen";
import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under the Team Schedule: time-off requests and shift swaps waiting for, or already given, a decision. Not a tab. */
export default function RequestsRoute() {
  const user = useAppStore((state) => state.user);
  const role = user?.effective_role ?? user?.role;
  if (!canViewTeamSchedule(role)) return <Redirect href={"/(app)/home" as never} />;
  return <RequestsScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
