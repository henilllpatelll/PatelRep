import { MyRequestsScreen } from "@/components/scheduling/MyRequestsScreen";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under My Schedule: everything the employee asked for, and swaps waiting on their answer. Not a tab. */
export default function MyRequestsRoute() {
  const user = useAppStore((state) => state.user);
  return <MyRequestsScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
