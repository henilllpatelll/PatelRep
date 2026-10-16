import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { ActionConfirmPanel } from "@/components/ai/ActionConfirmPanel";
import { AssistantComposer } from "@/components/ai/AssistantComposer";
import { AssistantMessageView } from "@/components/ai/AssistantMessageView";
import { ContextChip } from "@/components/ai/ContextChip";
import { usePalette } from "@/components/ai/palette";
import { RoomPickerPanel } from "@/components/ai/RoomPickerPanel";
import { RoomQuestionList } from "@/components/ai/RoomQuestionList";
import { VoiceCapturePanel } from "@/components/voice/VoiceCapturePanel";
import { useAssistant } from "@/lib/ai/AssistantProvider";
import { sheetQuickActions, roomIssueHref } from "@/lib/ai/quickActions";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/useAssistantConversation";
import { useAnnounceReplies } from "@/lib/ai/useAssistantA11y";
import { useAiPreferences } from "@/lib/ai/preferences";
import { useQuickActions } from "@/lib/ai/useQuickActions";
import { useRoomQuestions } from "@/lib/ai/useRoomQuestions";
import { useVoiceCapability } from "@/lib/voice/useVoiceCapability";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.6;
/** How much of the conversation the compact sheet shows; the full assistant has all of it. */
const RECENT_MESSAGES = 6;

/**
 * The compact assistant: four things a housekeeper does most, a message box, and a way into the full chat.
 * It is a view of the shared conversation (lib/ai/AssistantProvider), not a conversation of its own, so what is
 * said here is there in the full assistant, and closing the sheet forgets nothing.
 */
export function AssistantSheet() {
  const { t } = useTranslation();
  const theme = usePalette();
  const assistant = useAssistant();
  const {
    conversation,
    context,
    contextLabel,
    clearContext,
    sheetOpen,
    sheetView,
    setSheetView,
    closeAssistant,
    expandAssistant,
    draft,
    setDraft,
    sendDraft,
    cancelSend,
    focusToken,
    requestFocus,
    confirmTarget,
    openConfirm,
    setPendingHint,
  } = assistant;
  const { messages, sending, online } = conversation;
  const user = useAppStore((state) => state.user);
  const myRooms = useAppStore((state) => state.myRooms);
  const role = user?.effective_role ?? user?.role;
  const suggestions = useAiPreferences((state) => state.suggestions);
  const actions = suggestions ? sheetQuickActions(role) : [];
  const voiceAvailable = useVoiceCapability().enabled;
  const [voiceAuto, setVoiceAuto] = useState(false);

  const describeIssue = useCallback(() => {
    setDraft(t("copilot.quickPrompts.reportIssue"));
    setPendingHint("work_order_creation");
    setSheetView("home");
    requestFocus();
  }, [setDraft, setPendingHint, setSheetView, requestFocus, t]);
  const runQuick = useQuickActions({ onPickRoom: () => setSheetView("rooms") });
  const roomQuestions = useRoomQuestions();
  useAnnounceReplies(messages, t("assistant.thread.problem"));

  const target = useMemo(() => {
    if (!confirmTarget) return null;
    const message = messages.find((m) => m.id === confirmTarget.messageId);
    return message?.actions?.find((a) => a.id === confirmTarget.actionId) ?? null;
  }, [confirmTarget, messages]);
  useEffect(() => {
    if (sheetView === "confirm" && !target) setSheetView("home");
  }, [sheetView, target, setSheetView]);

  const openRoom = useCallback(
    (roomId: string) => {
      closeAssistant();
      router.push(`/(app)/my-rooms/${encodeURIComponent(roomId)}` as never);
    },
    [closeAssistant],
  );
  const openMyRooms = useCallback(() => {
    closeAssistant();
    router.push("/(app)/my-rooms" as never);
  }, [closeAssistant]);
  const openHref = useCallback(
    (href: string) => {
      if (!href) return;
      closeAssistant();
      router.push(href as never);
    },
    [closeAssistant],
  );

  const recent = messages.slice(-RECENT_MESSAGES);
  const lastId = messages[messages.length - 1]?.id ?? null;

  const title =
    sheetView === "voice"
      ? t("assistant.voice.title")
      : sheetView === "rooms"
        ? t("assistant.rooms.title")
        : sheetView === "confirm"
          ? t("assistant.confirm.title")
          : t("assistant.sheet.title");

  const footer =
    sheetView === "home" ? (
      <View style={styles.footer}>
        <AssistantComposer
          value={draft}
          onChangeText={(text) => setDraft(text.slice(0, MAX_MESSAGE_CHARS))}
          onSend={sendDraft}
          onCancel={cancelSend}
          sending={sending}
          online={online}
          onMic={
            voiceAvailable
              ? () => {
                  setVoiceAuto(true);
                  setSheetView("voice");
                }
              : undefined
          }
          placeholder={t("assistant.sheet.placeholder")}
          focusToken={focusToken}
          testIDPrefix="assistant-sheet"
        />
        <Pressable accessibilityRole="button" onPress={expandAssistant} style={styles.expand} testID="assistant-expand">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.expandText, { color: theme.ai.primary }]}>
            {t("assistant.sheet.openFull")}
          </Text>
          <Ionicons name="open-outline" size={16} color={theme.ai.primary} />
        </Pressable>
      </View>
    ) : undefined;

  return (
    <BottomSheet
      visible={sheetOpen}
      title={title}
      onClose={closeAssistant}
      grabber
      dragToDismiss
      tall={sheetView !== "home" || messages.length > 0}
      scrollKey={sheetView === "home" ? lastId : null}
      footer={footer}
      palette={theme}
      testID="assistant-sheet"
    >
      {sheetView === "voice" ? (
        <VoiceCapturePanel
          maxChars={MAX_MESSAGE_CHARS}
          autoStart={voiceAuto}
          onUse={(text) => {
            // Typed words are kept: what was heard is added after them, and nothing is sent until the person sends.
            setDraft(`${draft.trim() ? `${draft.trim()} ` : ""}${text}`);
            setVoiceAuto(false);
            setSheetView("home");
            requestFocus();
          }}
          onClose={() => {
            setVoiceAuto(false);
            setSheetView("home");
          }}
        />
      ) : sheetView === "rooms" ? (
        <RoomPickerPanel
          rooms={myRooms ?? []}
          onPick={(roomId) => {
            closeAssistant();
            router.push(roomIssueHref(roomId) as never);
          }}
          onDescribe={describeIssue}
          onBack={() => setSheetView("home")}
        />
      ) : sheetView === "confirm" && target && confirmTarget ? (
        <ActionConfirmPanel
          item={target}
          online={online}
          onEdit={(patch) => conversation.editAction(confirmTarget.messageId, confirmTarget.actionId, patch)}
          onConfirm={() => void conversation.confirm(confirmTarget.messageId, confirmTarget.actionId)}
          onCancel={() => {
            conversation.dismissAction(confirmTarget.messageId, confirmTarget.actionId);
            setSheetView("home");
          }}
          onDone={() => setSheetView("home")}
        />
      ) : (
        <View style={styles.body}>
          <ContextChip context={context} label={contextLabel} onClear={clearContext} />
          {recent.length === 0 ? (
            <>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, { color: theme.textPrimary }]}>
                {t(roomQuestions.ids.length > 0 ? "assistant.roomQ.heading" : "assistant.sheet.heading")}
              </Text>
              {roomQuestions.ids.length > 0 ? <RoomQuestionList ids={roomQuestions.ids} onAsk={roomQuestions.run} variant="rows" /> : null}
              <View style={styles.actions}>
                {(roomQuestions.ids.length > 0 ? [] : actions).map((action) => (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(`assistant.quick.${action.id}`)}
                    onPress={() => runQuick(action.id)}
                    style={[styles.action, { borderColor: theme.ai.line, backgroundColor: theme.surfaceElevated }]}
                    testID={`quick-${action.id}`}
                  >
                    <Ionicons name={action.icon} size={20} color={theme.ai.primary} />
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.textPrimary }]}>
                      {t(`assistant.quick.${action.id}`)}
                    </Text>
                    <Ionicons name="arrow-forward" size={16} color={theme.textMuted} />
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <>
              {recent.map((message) => (
                <AssistantMessageView
                  key={message.id}
                  message={message}
                  conversation={conversation}
                  compact
                  onReviewAction={(messageId, actionId) => openConfirm({ messageId, actionId })}
                  onOpenRoom={openRoom}
                  onExpand={expandAssistant}
                  onOpenMyRooms={openMyRooms}
                  onOpenHref={openHref}
                  onFollowUp={requestFocus}
                />
              ))}
              {sending ? (
                <View style={styles.thinking} accessibilityLiveRegion="polite" testID="assistant-thinking">
                  <ActivityIndicator size="small" color={theme.ai.primary} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13 }}>
                    {t("copilot.thinking")}
                  </Text>
                </View>
              ) : (
                <View style={styles.chips}>
                  {roomQuestions.ids.length > 0 ? <RoomQuestionList ids={roomQuestions.ids} onAsk={roomQuestions.run} variant="chips" /> : null}
                  {(roomQuestions.ids.length > 0 ? [] : actions).map((action) => (
                    <Pressable
                      key={action.id}
                      accessibilityRole="button"
                      onPress={() => runQuick(action.id)}
                      style={[styles.chip, { borderColor: theme.ai.line, backgroundColor: theme.surfaceElevated }]}
                      testID={`quick-chip-${action.id}`}
                    >
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                        {t(`assistant.quick.${action.id}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  heading: { fontSize: 20, fontWeight: "800", letterSpacing: -0.2 },
  actions: { gap: 8 },
  action: { minHeight: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  actionText: { flex: 1, fontSize: 16, fontWeight: "700" },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "700" },
  footer: { gap: 4 },
  expand: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  expandText: { fontSize: 14.5, fontWeight: "800" },
});
