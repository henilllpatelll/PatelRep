import { HousekeeperTasksScreen } from "@/components/tasks/HousekeeperTasksScreen";
import { StaffTasksScreen } from "@/components/tasks/StaffTasksScreen";
import { useAppStore } from "@/stores/appStore";

/** The redesigned queue is housekeeper-only (its Available/claim contract is housekeeper-gated);
 *  every other role that shares this tab keeps the existing screen. */
export default function TasksRoute() {
  const { user } = useAppStore();
  return user?.role === "housekeeper" ? <HousekeeperTasksScreen /> : <StaffTasksScreen />;
}
