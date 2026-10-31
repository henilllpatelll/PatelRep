import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetGone, SheetNotice } from "@/components/home/sheetParts";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { NotificationLink, NotificationLinkIssue } from "@/lib/housekeeping/notificationLinks";
import type { Translate } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

export interface MessageDetails {
  id: string;
  title: string;
  body: string;
  /** Real creation time of the notification; null when the record has none. */
  createdAt: string | null;
  /** Only when the record carries a sender name. Never inferred. */
  sender: string | null;
  link: NotificationLink;
  /** Already read: the sheet only shows it (the list can include read messages). */
  read?: boolean;
  /** Why no link is offered although the message names a record. */
  linkIssue?: NotificationLinkIssue | null;
}

export type MarkReadError = "offline" | "failed" | null;

interface Props {
  visible: boolean;
  /** Null once the message is no longer unread (marked read here or elsewhere). */
  message: MessageDetails | null;
  marking: boolean;
  error: MarkReadError;
  language: string;
  timeZone: string | null;
  t: Translate;
  onMarkRead: () => void;
  onOpenLink: (link: Exclude<NotificationLink, { kind: "none" }>) => void;
  /** Ask the assistant about the record this message points at. Absent when there is no assistant or nothing to ask about. */
  onAsk?: () => void;
  onClose: () => void;
}

/**
 * A notification, read in full: who sent it (when known), when, what it says,
 * the record it points at (only when that is verifiable) and Mark as read.
 * "Read" is the only thing the server records, so that is the only thing the
 * button claims; a failed write leaves the message unread and says so.
 */
export function SupervisorMessageSheet({ visible, message, marking, error, language, timeZone, t, onMarkRead, onOpenLink, onAsk, onClose }: Props) {
  const theme = useTheme();

  if (!message) {
    return (
      <BottomSheet visible={visible} title={t("home.message.noneTitle")} onClose={onClose} grabber testID="message-sheet">
        <SheetGone
          title={t("home.message.noneTitle")}
          body={t("home.message.noneBody")}
          closeLabel={t("common.close")}
          onClose={onClose}
          testID="message-none"
        />
      </BottomSheet>
    );
  }

  const sent = formatHotelTime(message.createdAt, timeZone, language);
  const meta = [message.sender ? t("home.message.from", { sender: message.sender }) : null, sent ? t("home.message.sent", { time: sent }) : null]
    .filter(Boolean)
    .join(" · ");
  const link = message.link;

  return (
    <BottomSheet
      visible={visible}
      title={message.title || t("home.message.fallbackTitle")}
      onClose={onClose}
      grabber
      testID="message-sheet"
      footer={
        <View style={styles.footer}>
          {link.kind !== "none" ? (
            <Button
              label={link.kind === "room" ? t("home.message.viewRoom", { room: link.roomNumber }) : link.kind === "schedule" ? t("home.message.viewSchedule") : t("home.message.viewTask")}
              onPress={() => onOpenLink(link)}
              variant="secondary"
              testID="message-open-link"
            />
          ) : null}
          {onAsk && link.kind !== "none" ? (
            <Button label={t("home.message.ask")} onPress={onAsk} variant="ghost" icon="sparkles" testID="message-ask" />
          ) : null}
          {message.read ? (
            <Button label={t("common.close")} onPress={onClose} variant="secondary" testID="message-close" />
          ) : (
            <Button
              label={t(marking ? "home.message.marking" : "home.message.markRead")}
              onPress={onMarkRead}
              loading={marking}
              icon="checkmark"
              testID="message-mark-read"
            />
          )}
        </View>
      }
    >
      {meta ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="message-meta">
          {meta}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="message-body" selectable>
        {message.body}
      </Text>
      {message.linkIssue === "room_not_on_list" ? (
        <SheetNotice text={t("home.message.roomNotOnList")} testID="message-link-issue" />
      ) : null}
      {error ? (
        <SheetNotice tone="error" text={t(error === "offline" ? "home.message.offline" : "home.message.failed")} testID="message-error" />
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t(message.read ? "home.message.alreadyRead" : "home.message.readOnlyHint")}
        </Text>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  body: { fontSize: 17, lineHeight: 25 },
  hint: { fontSize: 12, lineHeight: 17 },
  footer: { gap: 8 },
});
