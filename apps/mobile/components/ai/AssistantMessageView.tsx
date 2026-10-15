import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ActionPreviewCard } from "@/components/ai/ActionPreviewCard";
import { ActionSummaryCard, ClarificationCard, LimitationCard, RoomRecommendationCard, SourceList } from "@/components/ai/AssistantCards";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { AssistantMessage } from "@/lib/ai/conversationState";
import type { AssistantConversation } from "@/lib/ai/useAssistantConversation";

const MAX_FONT_SCALE = 1.6;
/** Longer answers than this are shortened in the compact sheet, with a way into the full assistant. */
export const SHORT_ANSWER_CHARS = 280;

interface Props {
  message: AssistantMessage;
  conversation: Pick<AssistantConversation, "chooseOption" | "editAction" | "confirm" | "dismissAction" | "send" | "online" | "sending">;
  compact?: boolean;
  /** Pin a palette (the legacy corner card is always dark). */
  palette?: Palette;
  /** Proposed actions open the confirmation drawer. Without it they edit inline, as the corner card always has. */
  onReviewAction?: (messageId: string, actionId: string) => void;
  onOpenRoom?: (roomId: string) => void;
  /** Where "Read in the full assistant" and the My Rooms link on a limitation go. */
  onExpand?: () => void;
  onOpenMyRooms?: () => void;
  /** A screen a room answer points to (the issue form, a work order). The caller closes the sheet and navigates. */
  onOpenHref?: (href: string) => void;
}

function timeOf(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** One entry in the conversation, for every assistant surface: text, where it came from, and what can be done next. */
export function AssistantMessageView({ message, conversation, compact, palette, onReviewAction, onOpenRoom, onExpand, onOpenMyRooms, onOpenHref }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const isUser = message.role === "user";

  if (message.kind === "notice" && message.notice) {
    const askedText = message.askedText;
    return (
      <LimitationCard
        kind={message.notice}
        online={conversation.online}
        compact={compact}
        palette={palette}
        onRetry={askedText ? () => void conversation.send(askedText) : undefined}
      />
    );
  }

  const full = message.content || (message.kind === "unsupported" ? t("copilot.unsupportedReply") : "");
  const long = !!compact && !isUser && full.length > SHORT_ANSWER_CHARS;
  const text = long ? `${full.slice(0, SHORT_ANSWER_CHARS).trimEnd()}…` : full;
  const who = isUser ? t("assistant.thread.you") : t("assistant.thread.assistant");

  return (
    <View>
      <View
        style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}
        accessible
        accessibilityLabel={`${who}: ${full}`}
        testID={isUser ? "assistant-user-message" : "assistant-reply"}
      >
        {!compact ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.who}>
            {who}
            {message.at ? ` · ${timeOf(message.at)}` : ""}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
          {text}
        </Text>
        {!isUser && message.provenance ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.provenance} testID="assistant-provenance">
            {t(`copilot.provenance.${message.provenance}`)}
          </Text>
        ) : null}
        {!isUser && message.provenance === "ai" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.disclaimer} testID="assistant-disclaimer">
            {t("assistant.notAuthoritative")}
          </Text>
        ) : null}
      </View>

      {long && onExpand ? (
        <Pressable accessibilityRole="button" onPress={onExpand} style={styles.more} testID="assistant-read-more">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.moreText}>
            {t("assistant.readInFull")}
          </Text>
        </Pressable>
      ) : null}

      {message.local?.type === "nextRoom" && onOpenRoom ? <RoomRecommendationCard room={message.local.room} onOpen={onOpenRoom} palette={palette} /> : null}
      {message.local?.type === "noRoomOrder" && onOpenMyRooms ? (
        <Pressable accessibilityRole="button" onPress={onOpenMyRooms} style={styles.more} testID="assistant-open-my-rooms">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.moreText}>
            {t("assistant.room.openMyRooms")}
          </Text>
        </Pressable>
      ) : null}

      {message.local?.type === "roomAnswer" && message.local.href && message.local.label && onOpenHref ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenHref(message.local?.type === "roomAnswer" ? (message.local.href ?? "") : "")}
          style={styles.more}
          testID="assistant-room-answer-open"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.moreText}>
            {message.local.label}
          </Text>
        </Pressable>
      ) : null}

      {message.sources && message.sources.length > 0 ? <SourceList sources={message.sources} palette={palette} /> : null}

      {message.options && message.options.length > 0 ? (
        <ClarificationCard
          options={message.options}
          disabled={conversation.sending}
          palette={palette}
          onPick={(option) => void conversation.chooseOption(message, option)}
        />
      ) : null}

      {message.actions?.map((item) =>
        onReviewAction ? (
          <ActionSummaryCard
            key={item.id}
            item={item}
            palette={palette}
            onReview={() => onReviewAction(message.id, item.id)}
            onDismiss={() => conversation.dismissAction(message.id, item.id)}
          />
        ) : (
          <ActionPreviewCard
            key={item.id}
            item={item}
            compact={compact}
            palette={palette}
            onEdit={(patch) => conversation.editAction(message.id, item.id, patch)}
            onConfirm={() => void conversation.confirm(message.id, item.id)}
            onDismiss={() => conversation.dismissAction(message.id, item.id)}
          />
        ),
      )}
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    bubble: { maxWidth: "88%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginVertical: 4 },
    userBubble: { alignSelf: "flex-end", backgroundColor: theme.primarySoft, borderWidth: 1, borderColor: theme.primaryLine },
    aiBubble: { alignSelf: "flex-start", backgroundColor: theme.surfaceElevated, borderWidth: 1, borderColor: theme.ai.line },
    who: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: theme.textMuted, marginBottom: 3 },
    bubbleText: { fontSize: 15, lineHeight: 21 },
    userText: { color: theme.textPrimary },
    aiText: { color: theme.textPrimary },
    provenance: { marginTop: 6, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: theme.textMuted },
    disclaimer: { marginTop: 2, fontSize: 11.5, lineHeight: 16, color: theme.textMuted },
    more: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
    moreText: { fontSize: 13.5, fontWeight: "800", color: theme.ai.primary },
  });
