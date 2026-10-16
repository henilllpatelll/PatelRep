import { Redirect } from "expo-router";
import { SupervisorAttentionScreen } from "@/components/supervisor/attention/SupervisorAttentionScreen";
import { useAppStore } from "@/stores/appStore";

/** Secondary route (not a tab): the supervisor's "Needs your attention" queue, opened from Today.
 *  The housekeeper Attention Center is a different route (`/attention`) and is untouched. */
export default function SupervisorAttentionRoute() {
  const user = useAppStore((state) => state.user);
  const role = user?.effective_role ?? user?.role;
  if (role !== "housekeeping_supervisor") return <Redirect href={"/(app)/home" as never} />;
  return <SupervisorAttentionScreen />;
}
