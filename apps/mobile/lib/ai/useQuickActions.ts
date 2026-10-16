import { useCallback } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAssistant } from "@/lib/ai/AssistantProvider";
import { readNextRoom } from "@/lib/ai/nextRoom";
import { addTaskHref, resolveQuickAction, roomIdOf, type QuickActionId } from "@/lib/ai/quickActions";

/**
 * What each quick action does, for both the compact sheet and the full chat. They perform the real thing:
 * the next-room answer is read from Home's own ranking, Report an issue and Create a task open the existing
 * forms (carrying over anything already typed), and nothing here asks a model unless the person sends a message.
 */
export function useQuickActions({ onPickRoom }: { onPickRoom: () => void }) {
  const { t } = useTranslation();
  const assistant = useAssistant();
  const { conversation, context, draft, closeAssistant, requestFocus, setDraft, setPendingHint } = assistant;
  const { scope, showLocal } = conversation;

  return useCallback(
    (id: QuickActionId) => {
      const command = resolveQuickAction(id, roomIdOf(context));
      switch (command.type) {
        case "nextRoom": {
          const question = t("assistant.quick.nextRoom");
          const room = readNextRoom(scope);
          if (room) showLocal(question, t("assistant.room.answer", { room: room.roomNumber }), { type: "nextRoom", room });
          else showLocal(question, t("assistant.room.none"), { type: "noRoomOrder" });
          return;
        }
        case "navigate": {
          // Whatever was typed so far becomes the new task's description instead of being lost.
          const href = id === "createTask" ? addTaskHref(draft) : command.href;
          if (id === "createTask") setDraft("");
          closeAssistant();
          router.push(href as never);
          return;
        }
        case "pickRoom":
          onPickRoom();
          return;
        case "focus":
          requestFocus();
          return;
        case "compose":
          setDraft(t("copilot.quickPrompts.searchSOPs"));
          setPendingHint(command.hint);
          requestFocus();
          return;
      }
    },
    [context, scope, showLocal, draft, closeAssistant, requestFocus, setDraft, setPendingHint, onPickRoom, t],
  );
}
