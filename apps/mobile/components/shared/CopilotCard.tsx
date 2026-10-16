import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { darkTheme } from "@/components/shared/tokens";
import { AssistantMessageView } from "@/components/ai/AssistantMessageView";
import type { CopilotCardBrief } from "@/lib/ai/copilotCard";
import { MAX_MESSAGE_CHARS, useAssistantConversation } from "@/lib/ai/useAssistantConversation";

const CARD_WIDTH = 306;
const THREAD_MAX_HEIGHT = 260;

export function CopilotCard({
  onClose,
  insetsBottom,
  brief,
  loading,
  error,
  reload,
}: {
  onClose: () => void;
  insetsBottom: number;
  brief: CopilotCardBrief | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  // The same controller the full-screen chat uses; the card's conversation is not saved.
  const conversation = useAssistantConversation({ persist: false });
  const { messages, sending, online, send } = conversation;
  const [input, setInput] = useState("");

  function sendMessage(text: string) {
    if (!text.trim() || sending) return;
    setInput("");
    void send(text);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }

  function runPrimary(current: CopilotCardBrief) {
    if (current.primaryRoute) {
      onClose();
      router.push(current.primaryRoute as never);
      return;
    }
    sendMessage(current.primaryAction);
  }

  function runSecondary(current: CopilotCardBrief) {
    if (current.secondaryDismiss) {
      onClose();
      return;
    }
    sendMessage(current.secondaryAction);
  }

  const chatting = messages.length > 0;
  const canSend = online && !sending && input.trim().length > 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dims the screen behind the card (design spec 1a) without dismissing
       * it — the card only closes via its own header close button, by design. */}
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={() => {}}
        accessible={false}
        importantForAccessibility="no"
        testID="copilot-card-scrim"
      />
      <View
        style={[styles.card, { bottom: insetsBottom + 156 }]}
        testID="copilot-card"
      >
        <View style={styles.header}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t("copilot.card.badge")}</Text>
          </View>
          <Text style={styles.headerLabel} numberOfLines={1}>
            {brief?.label ?? t("copilot.title")}
          </Text>
          <View style={{ flex: 1 }} />
          {!chatting && brief?.confidence != null ? (
            <Text style={styles.confidence}>{Math.round(brief.confidence)}%</Text>
          ) : null}
          {!chatting && brief?.provenance ? (
            <Text style={styles.confidence} testID="copilot-card-provenance">
              {t(`copilot.provenance.${brief.provenance}`)}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            style={styles.iconBtn}
            onPress={onClose}
          >
            <Ionicons name="close" size={17} color="rgba(247,244,238,0.7)" />
          </Pressable>
        </View>

        {chatting ? (
          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={styles.threadContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.map((item) => (
              <AssistantMessageView key={item.id} message={item} conversation={conversation} compact palette={darkTheme} />
            ))}
            {sending ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={darkTheme.ai.primary} />
                <Text style={styles.loadingText}>{t("copilot.card.loading")}</Text>
              </View>
            ) : null}
          </ScrollView>
        ) : loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={darkTheme.ai.primary} />
            <Text style={styles.loadingText}>{t("copilot.card.loading")}</Text>
          </View>
        ) : brief ? (
          <>
            <Text style={styles.brief}>{brief.brief}</Text>

            {brief.sources.length > 0 ? (
              <View style={styles.sourcesRow}>
                <Text style={styles.sourcesLabel}>{t("copilot.card.readLabel")}</Text>
                {brief.sources.map((src, i) => (
                  <View key={`${src}-${i}`} style={styles.sourceChip}>
                    <Text style={styles.sourceChipText} numberOfLines={1}>{src}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                style={styles.primaryBtn}
                onPress={() => runPrimary(brief)}
                testID="copilot-card-primary"
              >
                <Text style={styles.primaryBtnText} numberOfLines={1}>{brief.primaryAction}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryBtn}
                onPress={() => runSecondary(brief)}
                testID="copilot-card-secondary"
              >
                <Text style={styles.secondaryBtnText} numberOfLines={1}>{brief.secondaryAction}</Text>
              </Pressable>
            </View>

            {brief.chips.length > 0 ? (
              <View style={styles.chipsRow}>
                {brief.chips.map((chip, i) =>
                  brief.chipsAreInfo ? (
                    <View key={`${chip}-${i}`} style={styles.chip} testID="copilot-card-info-chip">
                      <Text style={styles.chipText} numberOfLines={2}>{chip}</Text>
                    </View>
                  ) : (
                    <Pressable
                      key={`${chip}-${i}`}
                      accessibilityRole="button"
                      style={styles.chip}
                      onPress={() => sendMessage(chip)}
                    >
                      <Text style={styles.chipText} numberOfLines={1}>{chip}</Text>
                    </Pressable>
                  ),
                )}
              </View>
            ) : null}
          </>
        ) : error ? (
          <View style={styles.unavailableBlock}>
            <Text style={styles.unavailableText}>{t("copilot.card.unavailable")}</Text>
            <Pressable accessibilityRole="button" onPress={reload}>
              <Text style={styles.retryText}>{t("copilot.card.retry")}</Text>
            </Pressable>
          </View>
        ) : null}

        {!online ? (
          <Text style={styles.offlineText} accessibilityLiveRegion="polite" testID="copilot-card-offline">
            {t("copilot.notice.offline")}
          </Text>
        ) : null}

        <View style={styles.askRow}>
          <TextInput
            style={styles.askInput}
            placeholder={t("copilot.card.askPlaceholder")}
            placeholderTextColor="rgba(247,244,238,0.42)"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => sendMessage(input)}
            editable={!sending}
            multiline
            maxLength={MAX_MESSAGE_CHARS}
            testID="copilot-card-input"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("copilot.card.send")}
            style={[styles.askIconBtn, !canSend && styles.askIconBtnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!canSend}
            testID="copilot-card-send"
          >
            <Ionicons name="arrow-up" size={14} color={darkTheme.textPrimary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: "rgba(26,24,21,0.22)",
  },
  card: {
    position: "absolute",
    right: 12,
    width: CARD_WIDTH,
    maxWidth: "88%",
    backgroundColor: darkTheme.shell.raised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  header: {
    paddingHorizontal: 13,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    backgroundColor: darkTheme.ai.primary,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: darkTheme.onAi, letterSpacing: 0.4 },
  headerLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(247,244,238,0.5)",
    flexShrink: 1,
  },
  confidence: { fontSize: 10.5, color: darkTheme.ai.primary, fontWeight: "600" },
  iconBtn: { padding: 4 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, paddingVertical: 14 },
  loadingText: { fontSize: 12.5, color: "rgba(247,244,238,0.55)" },
  thread: { maxHeight: THREAD_MAX_HEIGHT, marginTop: 8 },
  threadContent: { paddingHorizontal: 13, paddingBottom: 8, gap: 6 },
  brief: {
    marginTop: 10,
    paddingHorizontal: 13,
    fontStyle: "italic",
    fontSize: 15,
    lineHeight: 20,
    color: darkTheme.textPrimary,
  },
  sourcesRow: {
    paddingHorizontal: 13,
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    alignItems: "center",
  },
  sourcesLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "rgba(247,244,238,0.4)",
  },
  sourceChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: "rgba(247,244,238,0.07)",
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.12)",
    maxWidth: 160,
  },
  sourceChipText: { fontSize: 10.5, color: "rgba(247,244,238,0.72)" },
  actionsRow: { paddingHorizontal: 13, marginTop: 12, flexDirection: "row", gap: 7 },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    backgroundColor: darkTheme.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: darkTheme.onPrimary, fontSize: 13, fontWeight: "700" },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.2)",
    justifyContent: "center",
  },
  secondaryBtnText: { color: darkTheme.textPrimary, fontSize: 13 },
  chipsRow: { paddingHorizontal: 13, marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(247,244,238,0.06)",
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.1)",
    maxWidth: CARD_WIDTH - 26,
  },
  chipText: { fontSize: 11.5, color: "rgba(247,244,238,0.85)" },
  unavailableBlock: { paddingHorizontal: 13, marginTop: 12, gap: 6 },
  unavailableText: { fontSize: 12.5, color: "rgba(247,244,238,0.6)" },
  retryText: { fontSize: 12.5, color: darkTheme.ai.primary, fontWeight: "600" },
  offlineText: { paddingHorizontal: 13, marginTop: 8, fontSize: 11.5, color: "rgba(247,244,238,0.6)" },
  askRow: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(247,244,238,0.09)",
    backgroundColor: "rgba(247,244,238,0.03)",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  askInput: {
    flex: 1,
    fontSize: 12.5,
    color: darkTheme.textPrimary,
    maxHeight: 80,
    paddingVertical: 4,
  },
  askIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  askIconBtnDisabled: { opacity: 0.4 },
});
