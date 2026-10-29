import { MyAvailabilityScreen } from "@/components/scheduling/MyAvailabilityScreen";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under My Schedule: the signed-in employee's own availability. Not a tab. */
export default function MyAvailabilityRoute() {
  const user = useAppStore((state) => state.user);
  return <MyAvailabilityScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
