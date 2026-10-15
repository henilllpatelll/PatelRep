import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { darkTheme } from "@/components/shared/tokens";
import { IconButton } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { AssistantMessageView } from "@/components/ai/AssistantMessageView";
import { speechModule as _speechModule, useSpeechRecognitionEvent } from "@/lib/voice/speechModule";
import type { IntentHint } from "@/lib/ai/contract";
import { MAX_MESSAGE_CHARS, useAssistantConversation } from "@/lib/ai/useAssistantConversation";

// Each quick action starts a real, routed request: it fills in the start of a sentence and points the
// assistant at the matching intent (the server still checks the hint against the person's role).
const QUICK_ACTIONS: Array<{ key: string; icon: "warning" | "cube" | "person" | "book-outline"; hint: IntentHint }> = [
  { key: "reportIssue", icon: "warning", hint: "work_order_creation" },
  { key: "requestSupplies", icon: "cube", hint: "task_creation" },
  { key: "guestRequest", icon: "person", hint: "guest_request_creation" },
  { key: "searchSOPs", icon: "book-outline", hint: "sop_query" },
];

export default function CopilotScreen() {
  const { t } = useTranslation();
  const { prefill, documentId, roomId } = useLocalSearchParams<{ prefill?: string; documentId?: string; roomId?: string }>();
  // Ids from the route are only ever claims: the server verifies each one for this person before use.
  const conversation = useAssistantConversation({ persist: true, context: { documentId, roomId } });
  const { messages, sending, online } = conversation;
  const sentPrefillRef = useRef(false);
  const [input, setInput] = useState("");
  const [pendingHint, setPendingHint] = useState<IntentHint | undefined>(undefined);
  const flatListRef = useRef<FlatList>(null);
  const [isRecording, setIsRecording] = useState(false);

  const { send } = conversation;
  const submit = useCallback(
    (text: string, hint?: IntentHint) => {
      if (!text.trim() || sending) return;
      setInput("");
      setPendingHint(undefined);
      void send(text, hint ? { intentHint: hint } : undefined);
    },
    [send, sending],
  );

  // Deep-linked from the corner-card overlay / voice: send the transcript as the opening message exactly once.
  useEffect(() => {
    if (prefill && !sentPrefillRef.current && conversation.scope) {
      sentPrefillRef.current = true;
      submit(prefill);
    }
  }, [prefill, conversation.scope, submit]);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    setInput(transcript);
    setIsRecording(false);
  });
  useSpeechRecognitionEvent("error", () => setIsRecording(false));

  const handleMicPressIn = () => {
    if (!_speechModule) return;
    setIsRecording(true);
    _speechModule.start({ lang: "en-US", continuous: false, interimResults: false });
  };
  const handleMicPressOut = () => { _speechModule?.stop(); };

  const startQuickAction = (action: (typeof QUICK_ACTIONS)[number]) => {
    setInput(t(`copilot.quickPrompts.${action.key}`));
    setPendingHint(action.hint);
  };

  const canSend = online && !sending && input.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AssistantMessageView message={item} conversation={conversation} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles" size={22} color={darkTheme.ai.primary} />
            </View>
            <Text style={styles.emptyTitle}>{t("copilot.title")}</Text>
            <View style={styles.quickActions}>
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.key}
                  label={t(`copilot.quickActions.${action.key}`)}
                  icon={action.icon}
                  onPress={() => startQuickAction(action)}
                  style={styles.quickAction}
                />
              ))}
            </View>
          </View>
        }
        contentContainerStyle={messages.length === 0 ? styles.emptyFlex : styles.messages}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      {sending ? (
        <View style={styles.typingRow}>
          <ActivityIndicator color={darkTheme.ai.primary} size="small" />
          <Text style={styles.typingText}>{t("copilot.thinking")}</Text>
        </View>
      ) : null}

      {!online ? (
        <View style={styles.offlineRow} accessibilityLiveRegion="polite" testID="copilot-offline">
          <Ionicons name="cloud-offline-outline" size={14} color={darkTheme.status.pickup} />
          <Text style={styles.offlineText}>{t("copilot.notice.offline")}</Text>
        </View>
      ) : null}

      {messages.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={conversation.startNewConversation}
          style={styles.newChat}
          testID="copilot-new-chat"
        >
          <Ionicons name="refresh" size={14} color={darkTheme.textMuted} />
          <Text style={styles.newChatText}>{t("copilot.newConversation")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.inputRow}>
        {_speechModule ? (
          <Pressable
            onPressIn={handleMicPressIn}
            onPressOut={handleMicPressOut}
            accessibilityRole="button"
            style={[styles.iconControl, isRecording && styles.micBtnActive]}
          >
            <IconButton icon="mic" tone={isRecording ? "alert" : "ai"} size={40} />
          </Pressable>
        ) : null}
        <TextInput
          style={styles.input}
          placeholder={t("copilot.placeholder")}
          placeholderTextColor={darkTheme.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={MAX_MESSAGE_CHARS}
          testID="copilot-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("copilot.card.send")}
          style={[styles.iconControl, !canSend && styles.sendBtnDisabled]}
          onPress={() => submit(input, pendingHint)}
          disabled={!canSend}
          testID="copilot-send"
        >
          <IconButton icon="send" tone="ai" size={40} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: darkTheme.background },
  messages: { padding: 12, gap: 8 },
  emptyFlex: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkTheme.ai.soft,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: darkTheme.textPrimary, marginBottom: 24 },
  quickActions: { gap: 10, width: "100%" },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    backgroundColor: darkTheme.surfaceElevated,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: darkTheme.glassBorder,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: darkTheme.background,
  },
  typingText: { fontSize: 12, color: darkTheme.textMuted, fontStyle: "italic" },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: darkTheme.surface,
  },
  offlineText: { fontSize: 12, color: darkTheme.textSecondary },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  newChatText: { fontSize: 12, color: darkTheme.textMuted },
  inputRow: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
    backgroundColor: darkTheme.surface,
    borderTopWidth: 1,
    borderColor: darkTheme.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: darkTheme.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
    color: darkTheme.textPrimary,
    backgroundColor: darkTheme.surfaceElevated,
  },
  iconControl: {
    width: 40,
    height: 40,
  },
  sendBtnDisabled: { opacity: 0.4 },
  micBtnActive: {
    borderWidth: 2,
    borderRadius: 12,
    borderColor: darkTheme.status.dirty,
  },
});
