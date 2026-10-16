import { useCallback } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { HousekeeperTasksScreen } from "@/components/tasks/HousekeeperTasksScreen";
import { StaffTasksScreen } from "@/components/tasks/StaffTasksScreen";
import { taskIdFromNotification } from "@/lib/tasks/taskLink";
import { useAppStore } from "@/stores/appStore";

/** The redesigned queue is housekeeper-only (its Available/claim contract is housekeeper-gated);
 *  every other role that shares this tab keeps the existing screen. */
export default function TasksRoute() {
  const { user } = useAppStore();
  const { taskId, add, prefill } = useLocalSearchParams<{ taskId?: string; add?: string; prefill?: string }>();
  const linkedTaskId = taskIdFromNotification({ task_id: taskId });
  // The id is single-use: once the screen has looked it up, drop it so a re-render never re-opens it.
  const clearLink = useCallback(() => router.setParams({ taskId: undefined }), []);
  // "Create a task" from the assistant opens the Add Task sheet once, with whatever was typed as its starting text.
  const clearAdd = useCallback(() => router.setParams({ add: undefined, prefill: undefined }), []);
  return user?.role === "housekeeper" ? (
    <HousekeeperTasksScreen
      linkedTaskId={linkedTaskId}
      onLinkHandled={clearLink}
      openAdd={add === "1"}
      addPrefill={typeof prefill === "string" ? prefill : null}
      onAddHandled={clearAdd}
    />
  ) : (
    <StaffTasksScreen />
  );
}
