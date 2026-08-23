import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { darkTheme } from "@/components/shared/tokens";
import { useAppStore } from "@/stores/appStore";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";
import type { CopilotCardBrief } from "@/lib/ai/copilotCard";
import {
  sendCopilotMessage,
  confirmTask,
  confirmWorkOrder,
  confirmGuestRequest,
  type ChatMessage,
  type TaskPreview,
  type WorkOrderPreview,
  type GuestRequestPreview,
} from "@/lib/ai/copilotChat";

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
  const { user } = useAppStore();
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingTaskMsgId, setPendingTaskMsgId] = useState<string | null>(null);
  const [pendingWOMsgId, setPendingWOMsgId] = useState<string | null>(null);
  const [pendingGRMsgId, setPendingGRMsgId] = useState<string | null>(null);

  async function sendMessage(text: string) {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const response = await sendCopilotMessage(text, user?.role);
      const msgId = (Date.now() + 1).toString();
      const assistantMsg: ChatMessage = {
        id: msgId,
        role: "assistant",
        content: response.message,
        task_preview: response.task_preview,
        work_order_preview: response.work_order_preview,
        guest_request_preview: response.guest_request_preview,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (response.task_preview) setPendingTaskMsgId(msgId);
      if (response.work_order_preview) setPendingWOMsgId(msgId);
      if (response.guest_request_preview) setPendingGRMsgId(msgId);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant", content: t("common.error") },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }

  async function handleConfirmTask(preview: TaskPreview) {
    try {
      await confirmTask(preview);
      setPendingTaskMsgId(null);
      toast.success(t("copilot.taskCreated"));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function handleConfirmWorkOrder(preview: WorkOrderPreview) {
    try {
      await confirmWorkOrder(preview);
      setPendingWOMsgId(null);
      toast.success(t("copilot.workOrderCreated"));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function handleConfirmGuestRequest(preview: GuestRequestPreview) {
    try {
      await confirmGuestRequest(preview);
      setPendingGRMsgId(null);
      toast.success(t("copilot.guestRequestCreated"));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  const chatting = messages.length > 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dims the screen behind the card (design spec 1a) without dismissing
       * it — the card only closes via its own header close button, by design. */}
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={() => {}}
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
              <View key={item.id}>
                <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}>
                  <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.aiText]}>
                    {item.content}
                  </Text>
                </View>
                {item.task_preview && pendingTaskMsgId === item.id ? (
                  <View style={styles.confirmCard}>
                    <Text style={styles.confirmCardLabel}>{t("copilot.createTask")}</Text>
                    <Text style={styles.confirmCardTitle} numberOfLines={2}>{item.task_preview.title}</Text>
                    <View style={styles.confirmCardActions}>
                      <Button
                        label={t("copilot.create")}
                        onPress={() => handleConfirmTask(item.task_preview!)}
                        size="sm"
                        style={styles.confirmBtn}
                      />
                      <Button
                        label={t("copilot.dismiss")}
                        onPress={() => setPendingTaskMsgId(null)}
                        size="sm"
                        style={styles.dismissBtn}
                      />
                    </View>
                  </View>
                ) : null}
                {item.work_order_preview && pendingWOMsgId === item.id ? (
                  <View style={styles.confirmCard}>
                    <Text style={styles.confirmCardLabel}>{t("copilot.createWorkOrder")}</Text>
                    <Text style={styles.confirmCardTitle} numberOfLines={2}>{item.work_order_preview.title}</Text>
                    <View style={styles.confirmCardActions}>
                      <Button
                        label={t("copilot.create")}
                        onPress={() => handleConfirmWorkOrder(item.work_order_preview!)}
                        size="sm"
                        style={styles.confirmBtn}
                      />
                      <Button
                        label={t("copilot.dismiss")}
                        onPress={() => setPendingWOMsgId(null)}
                        size="sm"
                        style={styles.dismissBtn}
                      />
                    </View>
                  </View>
                ) : null}
                {item.guest_request_preview && pendingGRMsgId === item.id ? (
                  <View style={styles.confirmCard}>
                    <Text style={styles.confirmCardLabel}>{t("copilot.createGuestRequest")}</Text>
                    <Text style={styles.confirmCardTitle} numberOfLines={2}>{item.guest_request_preview.description}</Text>
                    <View style={styles.confirmCardActions}>
                      <Button
                        label={t("copilot.create")}
                        onPress={() => handleConfirmGuestRequest(item.guest_request_preview!)}
                        size="sm"
                        style={styles.confirmBtn}
                      />
                      <Button
                        label={t("copilot.dismiss")}
                        onPress={() => setPendingGRMsgId(null)}
                        size="sm"
                        style={styles.dismissBtn}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
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
                onPress={() => sendMessage(brief.primaryAction)}
              >
                <Text style={styles.primaryBtnText} numberOfLines={1}>{brief.primaryAction}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryBtn}
                onPress={() => sendMessage(brief.secondaryAction)}
              >
                <Text style={styles.secondaryBtnText} numberOfLines={1}>{brief.secondaryAction}</Text>
              </Pressable>
            </View>

            {brief.chips.length > 0 ? (
              <View style={styles.chipsRow}>
                {brief.chips.map((chip, i) => (
                  <Pressable
                    key={`${chip}-${i}`}
                    accessibilityRole="button"
                    style={styles.chip}
                    onPress={() => sendMessage(chip)}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>{chip}</Text>
                  </Pressable>
                ))}
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
            maxLength={500}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("copilot.card.send")}
            style={[styles.askIconBtn, (!input.trim() || sending) && styles.askIconBtnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || sending}
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
  bubble: { maxWidth: "86%", borderRadius: 12, padding: 10, marginVertical: 3 },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(247,244,238,0.08)",
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.14)",
  },
  aiBubble: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(247,244,238,0.05)",
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
  },
  bubbleText: { fontSize: 13, lineHeight: 18 },
  userText: { color: darkTheme.textPrimary },
  aiText: { color: "rgba(247,244,238,0.85)" },
  confirmCard: {
    marginTop: 4,
    marginBottom: 6,
    backgroundColor: "rgba(247,244,238,0.05)",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    alignSelf: "flex-start",
    maxWidth: "90%",
  },
  confirmCardLabel: {
    fontSize: 10,
    color: "rgba(247,244,238,0.5)",
    marginBottom: 3,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  confirmCardTitle: { fontSize: 13, fontWeight: "600", color: darkTheme.textPrimary, marginBottom: 8 },
  confirmCardActions: { flexDirection: "row", gap: 6 },
  confirmBtn: {
    flex: 1,
    backgroundColor: darkTheme.primaryAction,
    borderRadius: 8,
    paddingVertical: 7,
  },
  dismissBtn: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.2)",
    borderRadius: 8,
    paddingVertical: 7,
  },
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
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    backgroundColor: darkTheme.primaryAction,
    alignItems: "center",
  },
  primaryBtnText: { color: darkTheme.onPrimary, fontSize: 13, fontWeight: "700" },
  secondaryBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.2)",
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
