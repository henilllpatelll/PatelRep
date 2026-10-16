import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Keyboard } from "react-native";
import type { AssistantMessage } from "@/lib/ai/conversationState";

/** True while the software keyboard is up (the floating button steps aside for it). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * Tell a screen-reader user when the assistant has answered. Android reads live regions by itself; iOS needs an
 * explicit announcement. Only a reply that arrives while the surface is open is announced, never the saved
 * messages that were already there.
 */
export function useAnnounceReplies(messages: AssistantMessage[], fallback: string): void {
  const seen = useRef<string | null>(messages.length > 0 ? messages[messages.length - 1]!.id : null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === seen.current) return;
    seen.current = last.id;
    if (last.role !== "assistant") return;
    const spoken = last.content || fallback;
    if (spoken) AccessibilityInfo.announceForAccessibility(spoken.slice(0, 300));
  }, [messages, fallback]);
}
