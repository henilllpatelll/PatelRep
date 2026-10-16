import { useCallback, useEffect, useState } from "react";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { clearHistory, loadHistory } from "@/lib/ai/history";

export interface SavedConversation {
  /** Messages actually saved on this phone for this person and hotel; null while it is being read. */
  count: number | null;
  /** Forget the saved copy and the conversation on screen. Resolves once the saved copy is gone. */
  clear: () => Promise<void>;
  /** Start over: the conversation on screen and the saved copy both go. */
  startNew: () => Promise<void>;
}

/**
 * What the privacy controls act on. It reads the real saved copy (the same one the assistant restores)
 * rather than trusting the on-screen list, and clears both through the assistant's own controller when it
 * is mounted, so there is still exactly one conversation store.
 */
export function useSavedConversation(scope: string | null): SavedConversation {
  const assistant = useAssistantOptional();
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!scope) {
      setCount(0);
      return;
    }
    const stored = await loadHistory(scope);
    setCount(stored.length);
  }, [scope]);

  useEffect(() => {
    setCount(null);
    void refresh();
  }, [refresh]);

  const clear = useCallback(async () => {
    if (assistant) {
      await assistant.conversation.clearHistory();
      assistant.startFresh();
    } else if (scope) {
      await clearHistory(scope);
    }
    await refresh();
  }, [assistant, scope, refresh]);

  const startNew = clear;

  return { count, clear, startNew };
}
