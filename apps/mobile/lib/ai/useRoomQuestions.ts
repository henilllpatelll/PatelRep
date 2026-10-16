import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAssistant } from "@/lib/ai/AssistantProvider";
import { useAiPreferences } from "@/lib/ai/preferences";
import { roomIdOf } from "@/lib/ai/quickActions";
import { answerRoomQuestion, roomQuestionIds, type RoomQuestionId } from "@/lib/housekeeping/roomAssist";
import { selectSession, useCleanSessionStore } from "@/stores/cleanSessionStore";
import { useAppStore } from "@/stores/appStore";

/**
 * The questions the assistant offers once it is about one room, and what each does. They are answered on
 * the phone from the room and clean-session records the room screen shows, at the moment of the tap, so
 * they cost nothing, work offline, and never describe a room that has since left the person's list: if it
 * is gone, the answer says so and the assistant drops the room. Free-text questions still go to the
 * server, which verifies the room for this person and hotel before it uses it.
 */
export function useRoomQuestions(onNavigate?: (href: string) => void) {
  const { t } = useTranslation();
  const assistant = useAssistant();
  const { context, conversation, clearContext, setDraft, setPendingHint, requestFocus } = assistant;
  const roomId = roomIdOf(context);
  const session = useCleanSessionStore(selectSession(roomId ?? undefined));
  const hasLive = Boolean(session && !session.completionConfirmed);
  // Offered only for a room that is on this person's list right now; for anything else the server alone decides.
  const onList = useAppStore((state) => Boolean(roomId && state.myRooms.some((candidate) => candidate.id === roomId)));
  // Suggested questions are a choice (AI & voice settings); typing a question always works.
  const suggestions = useAiPreferences((state) => state.suggestions);
  const ids = useMemo(() => (suggestions && roomId && onList ? roomQuestionIds(hasLive) : []), [suggestions, roomId, onList, hasLive]);

  const run = useCallback(
    (id: RoomQuestionId) => {
      if (!roomId) return;
      // Read at the moment of the tap, not from a render that may be a moment old.
      const room = useAppStore.getState().myRooms.find((candidate) => candidate.id === roomId) ?? null;
      const live = useCleanSessionStore.getState();
      const current = selectSession(roomId)(live);
      const answer = answerRoomQuestion(id, { room, session: current });
      const question = t(`assistant.roomQ.q.${id}`);
      if (answer.type === "compose") {
        setDraft(t("assistant.roomQ.sopPrefill", { room: room?.room_number ?? "" }));
        setPendingHint(answer.hint);
        requestFocus();
        return;
      }
      const text = answer.lines.map((line) => t(line.key, line.params)).join(" ");
      if (answer.type === "gone") {
        conversation.showLocal(question, text, { type: "roomAnswer", roomId });
        clearContext();
        return;
      }
      conversation.showLocal(question, text, {
        type: "roomAnswer",
        roomId,
        href: answer.href,
        label: answer.href ? t(`assistant.roomQ.open.${id}`) : undefined,
      });
    },
    [roomId, t, conversation, clearContext, setDraft, setPendingHint, requestFocus],
  );

  return { roomId, ids, run, onNavigate };
}
