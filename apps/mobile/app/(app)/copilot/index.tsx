import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useTranslation } from "react-i18next";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { darkTheme } from "@/components/shared/tokens";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { ActionConfirmPanel } from "@/components/ai/ActionConfirmPanel";
import { AssistantComposer } from "@/components/ai/AssistantComposer";
import { AssistantMenu } from "@/components/ai/AssistantMenu";
import { AssistantMessageView } from "@/components/ai/AssistantMessageView";
import { ContextChip } from "@/components/ai/ContextChip";
import { RoomPickerPanel } from "@/components/ai/RoomPickerPanel";
import { VoiceCapturePanel } from "@/components/voice/VoiceCapturePanel";
import { useAssistant } from "@/lib/ai/AssistantProvider";
import type { IntentHint } from "@/lib/ai/contract";
import { isAssistantRole } from "@/lib/ai/fab";
import { isValidEntityId } from "@/lib/ai/launch";
import { chatQuickActions, roomIssueHref } from "@/lib/ai/quickActions";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/useAssistantConversation";
import { useAnnounceReplies } from "@/lib/ai/useAssistantA11y";
import { useQuickActions } from "@/lib/ai/useQuickActions";
import { isSpeechAvailable } from "@/lib/voice/speechModule";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.6;
/** Within this many pixels of the end counts as "reading the latest"; further up the reader is left alone. */
const NEAR_BOTTOM = 120;
/** Scroll events this soon after we scrolled ourselves are ours, not the reader's. */
const FOLLOW_SETTLE_MS = 400;

// Other roles keep their own starting prompts: each starts a real, routed request (the server checks the hint against the role).
const STAFF_ACTIONS: Array<{ key: string; icon: "warning" | "cube" | "person" | "book-outline"; hint: IntentHint }> = [
  { key: "reportIssue", icon: "warning", hint: "work_order_creation" },
  { key: "requestSupplies", icon: "cube", hint: "task_creation" },
  { key: "guestRequest", icon: "person", hint: "guest_request_creation" },
  { key: "searchSOPs", icon: "book-outline", hint: "sop_query" },
];

export default function CopilotScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { prefill, documentId, roomId } = useLocalSearchParams<{ prefill?: string; documentId?: string; roomId?: string }>();
  const assistant = useAssistant();
  const {
    conversation,
    context,
    contextLabel,
    clearContext,
    launchContext,
    openAssistant,
    draft,
    setDraft,
    sendDraft,
    cancelSend,
    focusToken,
    requestFocus,
    setPendingHint,
    startFresh,
  } = assistant;
  const { messages, sending, online, scope } = conversation;
  const user = useAppStore((state) => state.user);
  const myRooms = useAppStore((state) => state.myRooms);
  const role = user?.effective_role ?? user?.role;
  const housekeeper = isAssistantRole(role);

  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceAuto, setVoiceAuto] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [confirmFor, setConfirmFor] = useState<{ messageId: string; actionId: string } | null>(null);
  const listRef = useRef<FlatList>(null);
  const nearBottom = useRef(true);
  const followingUntil = useRef(0);
  const [unseen, setUnseen] = useState(false);
  const sentPrefill = useRef(false);

  // Ids from the route are only ever claims: the server verifies each one for this person before use.
  const wantedId = isValidEntityId(documentId) ? documentId.trim().toLowerCase() : isValidEntityId(roomId) ? roomId.trim().toLowerCase() : null;
  useEffect(() => {
    if (isValidEntityId(documentId)) launchContext({ contextType: "sop", entityId: documentId });
    else if (isValidEntityId(roomId)) launchContext({ contextType: "room", entityId: roomId });
  }, [documentId, roomId, launchContext]);

  // A transcript handed over by the legacy corner-card voice button is sent once, as the opening message,
  // and only after the subject it was launched with is in place (so its id travels with the question).
  const subjectReady = !wantedId || context.entityId === wantedId;
  useEffect(() => {
    if (prefill && !sentPrefill.current && scope && subjectReady) {
      sentPrefill.current = true;
      void conversation.send(prefill);
    }
  }, [prefill, scope, subjectReady, conversation]);

  const describeIssue = useCallback(() => {
    setDraft(t("copilot.quickPrompts.reportIssue"));
    setPendingHint("work_order_creation");
    setRoomsOpen(false);
    requestFocus();
  }, [setDraft, setPendingHint, requestFocus, t]);
  const runQuick = useQuickActions({ onPickRoom: () => setRoomsOpen(true) });
  useAnnounceReplies(messages, t("assistant.thread.problem"));

  const confirmItem = useMemo(() => {
    if (!confirmFor) return null;
    const message = messages.find((m) => m.id === confirmFor.messageId);
    return message?.actions?.find((a) => a.id === confirmFor.actionId) ?? null;
  }, [confirmFor, messages]);
  useEffect(() => {
    if (confirmFor && !confirmItem) setConfirmFor(null);
  }, [confirmFor, confirmItem]);

  // Follow the conversation only while the reader is at the end of it (or has just sent something); otherwise leave
  // their place alone and offer a way down. Growth is followed from onContentSizeChange, after the new row is measured.
  const lastId = messages[messages.length - 1]?.id ?? null;
  const lastRole = messages[messages.length - 1]?.role;
  useEffect(() => {
    if (!lastId) return;
    if (lastRole === "user") {
      nearBottom.current = true;
      setUnseen(false);
    } else if (!nearBottom.current) {
      setUnseen(true);
    }
  }, [lastId, lastRole]);

  // FlatList.scrollToEnd guesses where the newest row ends before that row has been measured, and falls short for a
  // tall reply; the ScrollView underneath scrolls to the real end of its content.
  const scrollToLatest = useCallback((animated: boolean) => {
    const list = listRef.current;
    const responder = list?.getScrollResponder?.() as { scrollToEnd?: (options: { animated: boolean }) => void } | null | undefined;
    if (responder?.scrollToEnd) responder.scrollToEnd({ animated });
    else list?.scrollToEnd({ animated });
  }, []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Date.now() < followingUntil.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM;
    nearBottom.current = atEnd;
    if (atEnd) setUnseen(false);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/home" as never));
  const minimize = () => {
    back();
    openAssistant();
  };
  const openRoom = (id: string) => router.push(`/(app)/my-rooms/${encodeURIComponent(id)}` as never);

  const quickActions = housekeeper ? chatQuickActions(role) : [];
  const voiceAvailable = isSpeechAvailable();
  const subtitle = housekeeper ? t("assistant.screen.subtitle") : t("assistant.screen.subtitleStaff");

  return (
    <View style={[styles.container, { backgroundColor: darkTheme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: darkTheme.surface, borderBottomColor: darkTheme.borderSubtle }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={back} style={styles.headerButton} testID="assistant-back">
          <Ionicons name="arrow-back" size={22} color={darkTheme.textPrimary} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: darkTheme.textPrimary }]} numberOfLines={1}>
            {t("assistant.screen.title")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: darkTheme.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {housekeeper ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("assistant.screen.minimize")} onPress={minimize} style={styles.headerButton} testID="assistant-minimize">
            <Ionicons name="contract-outline" size={21} color={darkTheme.textPrimary} />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t("assistant.menu.title")} onPress={() => setMenuOpen(true)} style={styles.headerButton} testID="assistant-menu-button">
          <Ionicons name="ellipsis-horizontal" size={22} color={darkTheme.textPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={() => {
            if (!nearBottom.current) return;
            // Our own jump to the end must not be mistaken for the reader scrolling away.
            followingUntil.current = Date.now() + FOLLOW_SETTLE_MS;
            scrollToLatest(false);
          }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <AssistantMessageView
              message={item}
              conversation={conversation}
              onReviewAction={(messageId, actionId) => setConfirmFor({ messageId, actionId })}
              onOpenRoom={openRoom}
              onOpenMyRooms={() => router.push("/(app)/my-rooms" as never)}
            />
          )}
          ListHeaderComponent={<ContextChip context={context} label={contextLabel} onClear={clearContext} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: darkTheme.ai.soft, borderColor: darkTheme.ai.line }]}>
                <Ionicons name="sparkles" size={22} color={darkTheme.ai.primary} />
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: darkTheme.textPrimary }]}>
                {t("assistant.screen.empty")}
              </Text>
              <View style={styles.chips}>
                {housekeeper
                  ? quickActions.map((action) => (
                      <Pressable
                        key={action.id}
                        accessibilityRole="button"
                        onPress={() => runQuick(action.id)}
                        style={[styles.chip, { borderColor: darkTheme.ai.line, backgroundColor: darkTheme.surfaceElevated }]}
                        testID={`quick-${action.id}`}
                      >
                        <Ionicons name={action.icon} size={18} color={darkTheme.ai.primary} />
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: darkTheme.textPrimary }]}>
                          {t(`assistant.quick.${action.id}`)}
                        </Text>
                      </Pressable>
                    ))
                  : STAFF_ACTIONS.map((action) => (
                      <Pressable
                        key={action.key}
                        accessibilityRole="button"
                        onPress={() => {
                          setDraft(t(`copilot.quickPrompts.${action.key}`));
                          setPendingHint(action.hint);
                          requestFocus();
                        }}
                        style={[styles.chip, { borderColor: darkTheme.ai.line, backgroundColor: darkTheme.surfaceElevated }]}
                        testID={`quick-${action.key}`}
                      >
                        <Ionicons name={action.icon} size={18} color={darkTheme.ai.primary} />
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: darkTheme.textPrimary }]}>
                          {t(`copilot.quickActions.${action.key}`)}
                        </Text>
                      </Pressable>
                    ))}
              </View>
            </View>
          }
          contentContainerStyle={messages.length === 0 ? styles.emptyFlex : styles.messages}
        />

        {unseen ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setUnseen(false);
              nearBottom.current = true;
              scrollToLatest(true);
            }}
            style={[styles.jump, { backgroundColor: darkTheme.primaryAction }]}
            testID="assistant-jump"
          >
            <Ionicons name="arrow-down" size={14} color={darkTheme.onPrimary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: darkTheme.onPrimary, fontWeight: "800", fontSize: 12.5 }}>
              {t("assistant.thread.newReply")}
            </Text>
          </Pressable>
        ) : null}

        {sending ? (
          <View style={styles.typing} accessibilityLiveRegion="polite" testID="assistant-thinking">
            <ActivityIndicator color={darkTheme.ai.primary} size="small" />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 13, color: darkTheme.textMuted }}>
              {t("copilot.thinking")}
            </Text>
          </View>
        ) : null}

        <View style={[styles.composer, { backgroundColor: darkTheme.surface, borderTopColor: darkTheme.borderSubtle, paddingBottom: insets.bottom + 10 }]}>
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
                    setVoiceOpen(true);
                  }
                : undefined
            }
            placeholder={t("assistant.screen.placeholder")}
            focusToken={focusToken}
            testIDPrefix="copilot"
          />
        </View>
      </KeyboardAvoidingView>

      <AssistantMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        hasMessages={messages.length > 0}
        onNewConversation={startFresh}
        onClearSaved={() => {
          void conversation.clearHistory();
          startFresh();
        }}
        onChangeLanguage={() => router.push("/(app)/profile/language" as never)}
      />

      <BottomSheet visible={voiceOpen} title={t("assistant.voice.title")} onClose={() => setVoiceOpen(false)} grabber dragToDismiss palette={darkTheme} testID="voice-sheet">
        {voiceOpen ? (
          <VoiceCapturePanel
            maxChars={MAX_MESSAGE_CHARS}
            autoStart={voiceAuto}
            onUse={(text) => {
              setDraft(`${draft.trim() ? `${draft.trim()} ` : ""}${text}`);
              setVoiceOpen(false);
              requestFocus();
            }}
            onClose={() => setVoiceOpen(false)}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet visible={roomsOpen} title={t("assistant.rooms.title")} onClose={() => setRoomsOpen(false)} grabber dragToDismiss palette={darkTheme} testID="rooms-sheet">
        <RoomPickerPanel
          rooms={myRooms ?? []}
          onPick={(id) => {
            setRoomsOpen(false);
            router.push(roomIssueHref(id) as never);
          }}
          onDescribe={describeIssue}
          onBack={() => setRoomsOpen(false)}
        />
      </BottomSheet>

      <BottomSheet visible={!!confirmItem} title={t("assistant.confirm.title")} onClose={() => setConfirmFor(null)} grabber tall palette={darkTheme} testID="confirm-sheet">
        {confirmItem && confirmFor ? (
          <ActionConfirmPanel
            item={confirmItem}
            online={online}
            onEdit={(patch) => conversation.editAction(confirmFor.messageId, confirmFor.actionId, patch)}
            onConfirm={() => void conversation.confirm(confirmFor.messageId, confirmFor.actionId)}
            onCancel={() => {
              conversation.dismissAction(confirmFor.messageId, confirmFor.actionId);
              setConfirmFor(null);
            }}
            onDone={() => setConfirmFor(null)}
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingBottom: 8, borderBottomWidth: 1, gap: 2 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, paddingHorizontal: 4 },
  title: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, marginTop: 1 },
  messages: { padding: 14, gap: 4, paddingBottom: 20 },
  emptyFlex: { flexGrow: 1, padding: 14 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 18 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, marginBottom: 14 },
  emptyTitle: { fontSize: 22, fontWeight: "800", marginBottom: 20, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  chip: { minHeight: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  chipText: { fontSize: 14.5, fontWeight: "700" },
  jump: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, marginBottom: 6 },
  typing: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 8 },
  composer: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
});
