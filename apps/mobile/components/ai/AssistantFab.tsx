import { StyleSheet, View } from "react-native";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CopilotBubble } from "@/components/shared/CopilotBubble";
import { useAssistant } from "@/lib/ai/AssistantProvider";
import { assistantFabPlacement, assistantFabVisible } from "@/lib/ai/fab";
import { useKeyboardVisible } from "@/lib/ai/useAssistantA11y";
import { useAppStore } from "@/stores/appStore";

const noop = () => {};

/**
 * The housekeeper's floating assistant button. A tap opens the compact sheet; a long press opens it on the voice
 * panel (it does not start listening by itself). Rendering it asks nothing of any model. It steps aside for the
 * keyboard, for the open sheet and for screens whose own controls sit at the bottom.
 */
export function AssistantFab() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const user = useAppStore((state) => state.user);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const { conversation, sheetOpen, openAssistant, setSheetView } = useAssistant();

  const visible = assistantFabVisible({
    pathname,
    role: user?.effective_role ?? user?.role,
    authenticated: isAuthenticated,
    keyboardVisible,
    sheetOpen,
  });
  if (!visible) return null;

  const { bottom, right } = assistantFabPlacement({ bottom: insets.bottom, right: insets.right });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <CopilotBubble
        state={conversation.sending ? "thinking" : "idle"}
        bottom={bottom}
        right={right}
        accessibilityLabel={t("assistant.fab.label")}
        accessibilityHint={t("assistant.fab.hint")}
        onPress={() => openAssistant()}
        onLongPress={() => {
          openAssistant();
          setSheetView("voice");
        }}
        onPressOut={noop}
      />
    </View>
  );
}
