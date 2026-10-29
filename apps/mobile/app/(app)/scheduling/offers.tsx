import { MyOffersScreen } from "@/components/scheduling/MyOffersScreen";
import { useAppStore } from "@/stores/appStore";

/** Secondary route under My Schedule: shift offers, open shifts and the employee's own shift requests. Not a tab. */
export default function MyOffersRoute() {
  const user = useAppStore((state) => state.user);
  return <MyOffersScreen key={`${user?.tenant_id ?? ""}:${user?.id ?? ""}`} />;
}
