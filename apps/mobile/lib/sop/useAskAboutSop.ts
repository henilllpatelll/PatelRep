import { useCallback } from "react";
import { router } from "expo-router";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { isAssistantRole } from "@/lib/ai/fab";
import { isValidEntityId } from "@/lib/ai/launch";
import { useAppStore } from "@/stores/appStore";

export interface AskAboutSop {
  /** The document the question is about; omit to ask across all of the hotel's approved procedures. */
  documentId?: string | null;
  /** Shown as the assistant's subject until the server confirms the document's own title. */
  title?: string | null;
  /** The question. Without it the assistant just opens, about that document, ready for the person to type. */
  text?: string;
}

/**
 * Hand a procedure question to the one shared assistant. The document id is only a claim: the server checks it is
 * this hotel's current, indexed procedure before it searches it, and answers only from that document. Opening
 * the assistant asks nothing and costs nothing; a question is sent only when the person chose one.
 *
 * Housekeepers get the compact assistant; every other role keeps the full-screen chat they already have.
 */
export function useAskAboutSop(): (ask: AskAboutSop) => void {
  const assistant = useAssistantOptional();
  const user = useAppStore((state) => state.user);
  const role = user?.effective_role ?? user?.role;

  return useCallback(
    ({ documentId, title, text }: AskAboutSop) => {
      const entityId = documentId && isValidEntityId(documentId) ? documentId.trim().toLowerCase() : null;
      const question = text?.trim() ? text.trim() : undefined;
      if (assistant && isAssistantRole(role)) {
        assistant.openAssistant(
          entityId
            ? { contextType: "sop", entityId, label: title ?? undefined }
            : { contextType: "general" },
        );
        if (question) {
          void assistant.conversation.send(question, {
            intentHint: "sop_query",
            context: entityId ? { documentId: entityId } : {},
          });
        }
        return;
      }
      const params: Record<string, string> = {};
      if (entityId) params.documentId = entityId;
      if (question) {
        params.prefill = question;
        params.intent = "sop_query";
      }
      router.push({ pathname: "/(app)/copilot", params } as never);
    },
    [assistant, role],
  );
}
