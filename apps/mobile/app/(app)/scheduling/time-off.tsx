import { TimeOffScreen } from "@/components/scheduling/TimeOffScreen";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under My Schedule: ask for time off. Not a tab. */
export default function TimeOffRoute() {
  const user = useAppStore((state) => state.user);
  return <TimeOffScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
