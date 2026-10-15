import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { darkTheme } from "@/components/shared/tokens";
import { ActionPreviewCard } from "@/components/ai/ActionPreviewCard";
import type { AssistantConversation } from "@/lib/ai/useAssistantConversation";
import type { AssistantMessage } from "@/lib/ai/conversationState";

interface Props {
  message: AssistantMessage;
  conversation: Pick<AssistantConversation, "chooseOption" | "editAction" | "confirm" | "dismissAction" | "send" | "online">;
  compact?: boolean;
}

/** One entry in the conversation, for every assistant surface: text, where it came from, and what can be done next. */
export function AssistantMessageView({ message, conversation, compact }: Props) {
  const { t } = useTranslation();
  const isUser = message.role === "user";

  if (message.kind === "notice" && message.notice) {
    const retryable = message.askedText && message.notice !== "permission" && message.notice !== "credit_limit";
    return (
      <View style={[styles.notice, compact && styles.noticeCompact]} accessibilityLiveRegion="polite" testID="assistant-notice">
        <Ionicons name={message.notice === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={16} color={darkTheme.status.pickup} />
        <View style={styles.noticeBody}>
          <Text style={styles.noticeText}>{t(`copilot.notice.${message.notice}`)}</Text>
          {retryable ? (
            <Pressable
              accessibilityRole="button"
              disabled={!conversation.online && message.notice === "offline"}
              onPress={() => void conversation.send(message.askedText!)}
              style={styles.retry}
              testID="assistant-retry"
            >
              <Text style={styles.retryText}>{t("copilot.notice.retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const text = message.content || (message.kind === "unsupported" ? t("copilot.unsupportedReply") : "");

  return (
    <View>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>{text}</Text>
        {!isUser && message.provenance ? (
          <Text style={styles.provenance} testID="assistant-provenance">
            {t(`copilot.provenance.${message.provenance}`)}
          </Text>
        ) : null}
      </View>

      {message.sources && message.sources.length > 0 ? (
        <View style={styles.sources} testID="assistant-sources">
          <Text style={styles.sourcesLabel}>{t("copilot.sources")}</Text>
          {message.sources.map((source, index) => (
            <Text key={`${source.documentId ?? source.title}-${source.page ?? index}`} style={styles.source} numberOfLines={2}>
              {source.title}
              {source.page ? ` · ${t("copilot.page", { page: source.page })}` : ""}
            </Text>
          ))}
        </View>
      ) : null}

      {message.options && message.options.length > 0 ? (
        <View style={styles.options}>
          <Text style={styles.sourcesLabel}>{t("copilot.clarify")}</Text>
          {message.options.map((option) => (
            <Pressable
              key={option.intentHint}
              accessibilityRole="button"
              onPress={() => void conversation.chooseOption(message, option)}
              style={styles.option}
              testID={`assistant-option-${option.intentHint}`}
            >
              <Text style={styles.optionText}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {message.actions?.map((item) => (
        <ActionPreviewCard
          key={item.id}
          item={item}
          compact={compact}
          onEdit={(patch) => conversation.editAction(message.id, item.id, patch)}
          onConfirm={() => void conversation.confirm(message.id, item.id)}
          onDismiss={() => conversation.dismissAction(message.id, item.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "85%", borderRadius: 14, padding: 12, marginVertical: 4 },
  userBubble: { alignSelf: "flex-end", backgroundColor: darkTheme.surface, borderWidth: 1, borderColor: darkTheme.border },
  aiBubble: { alignSelf: "flex-start", backgroundColor: darkTheme.surfaceElevated, borderWidth: 1, borderColor: darkTheme.ai.line },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: darkTheme.textPrimary },
  aiText: { color: darkTheme.textSecondary },
  provenance: { marginTop: 6, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: darkTheme.textMuted },
  sources: { marginTop: 2, marginBottom: 6, paddingHorizontal: 4 },
  sourcesLabel: { fontSize: 11, color: darkTheme.textMuted, fontWeight: "600", marginBottom: 2 },
  source: { fontSize: 12, color: darkTheme.textSecondary, marginTop: 2 },
  options: { gap: 6, marginVertical: 6, alignSelf: "flex-start" },
  option: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    backgroundColor: darkTheme.surfaceElevated,
  },
  optionText: { fontSize: 14, color: darkTheme.textPrimary, fontWeight: "600" },
  notice: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: 12,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: darkTheme.border,
    backgroundColor: darkTheme.surface,
  },
  noticeCompact: { padding: 10 },
  noticeBody: { flex: 1 },
  noticeText: { fontSize: 13, lineHeight: 18, color: darkTheme.textSecondary },
  retry: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  retryText: { fontSize: 13, fontWeight: "700", color: darkTheme.ai.primary },
});
