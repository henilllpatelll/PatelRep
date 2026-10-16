import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import { SourceCitationCard } from "@/components/sop/SourceCitationCard";
import { summarizePreview } from "@/lib/ai/actionSummary";
import type { AssistantSource, ClarifyOption, CopilotFailureKind } from "@/lib/ai/contract";
import type { ActionItem } from "@/lib/ai/conversationState";
import type { PublishedNextRoom } from "@/lib/ai/shiftBriefingSource";

/* One card language for everything the assistant can show besides plain text:
   a room, a question back, a limitation, sources, and a proposed action. Screens
   never build their own versions. */

const MAX_FONT_SCALE = 1.6;

function useCardStyles(palette?: Palette) {
  const theme = usePalette(palette);
  return { theme, styles: useMemo(() => makeStyles(theme), [theme]) };
}

/** B. Room recommendation: the room Home ranks first, a permitted next step, and where that came from. */
export function RoomRecommendationCard({
  room,
  onOpen,
  palette,
}: {
  room: PublishedNextRoom;
  onOpen: (roomId: string) => void;
  palette?: Palette;
}) {
  const { t } = useTranslation();
  const { theme, styles } = useCardStyles(palette);
  const facts = [room.context, room.estimateMinutes ? t("assistant.room.estimate", { minutes: room.estimateMinutes }) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.card} testID="assistant-room-card">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.kicker}>
        {t("assistant.room.kicker", { room: room.roomNumber })}
      </Text>
      {facts ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>
          {facts}
        </Text>
      ) : null}
      {room.reason ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted}>
          {room.reason}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.source}>
        {t("assistant.room.source")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("assistant.room.open", { room: room.roomNumber })}
        onPress={() => onOpen(room.roomId)}
        style={styles.primary}
        testID="assistant-room-open"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.primaryText}>
          {room.kind === "continue" ? t("assistant.room.continue") : t("assistant.room.openRoom")}
        </Text>
        <Ionicons name="arrow-forward" size={16} color={theme.onPrimary} />
      </Pressable>
    </View>
  );
}

/** G. Clarification: one question, only the actions the server offered this person. */
export function ClarificationCard({
  options,
  onPick,
  disabled,
  palette,
}: {
  options: ClarifyOption[];
  onPick: (option: ClarifyOption) => void;
  disabled?: boolean;
  palette?: Palette;
}) {
  const { t } = useTranslation();
  const { theme, styles } = useCardStyles(palette);
  return (
    <View style={styles.options} testID="assistant-clarify">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>
        {t("copilot.clarify")}
      </Text>
      {options.map((option) => (
        <Pressable
          key={option.intentHint}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!disabled }}
          disabled={disabled}
          onPress={() => onPick(option)}
          style={[styles.option, disabled && styles.disabled]}
          testID={`assistant-option-${option.intentHint}`}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.optionText}>
            {option.label}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        </Pressable>
      ))}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted}>
        {t("assistant.clarify.orType")}
      </Text>
    </View>
  );
}

const RETRYABLE: ReadonlySet<CopilotFailureKind> = new Set<CopilotFailureKind>([
  "offline",
  "unavailable",
  "rate_limited",
  "unknown",
  "invalid_response",
  "unconfirmed",
]);

/** H + I. Errors and limitations, in words a person can act on. Never an internal payload. */
export function LimitationCard({
  kind,
  online,
  onRetry,
  onAction,
  actionLabel,
  compact,
  palette,
}: {
  kind: CopilotFailureKind;
  online: boolean;
  /** Present when the failed question can be asked again. */
  onRetry?: () => void;
  onAction?: () => void;
  actionLabel?: string;
  compact?: boolean;
  palette?: Palette;
}) {
  const { t } = useTranslation();
  const { theme, styles } = useCardStyles(palette);
  const canRetry = !!onRetry && RETRYABLE.has(kind);
  const icon =
    kind === "offline" ? "cloud-offline-outline" : kind === "permission" || kind === "credit_limit" ? "lock-closed-outline" : "alert-circle-outline";
  return (
    <View style={[styles.notice, compact && styles.noticeCompact]} accessibilityLiveRegion="polite" testID="assistant-notice">
      <Ionicons name={icon} size={18} color={theme.status.pickup} />
      <View style={styles.noticeBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeText}>
          {t(`copilot.notice.${kind}`)}
        </Text>
        {canRetry ? (
          <Pressable
            accessibilityRole="button"
            disabled={!online && kind === "offline"}
            onPress={onRetry}
            style={styles.link}
            testID="assistant-retry"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.linkText}>
              {t("copilot.notice.retry")}
            </Text>
          </Pressable>
        ) : null}
        {onAction && actionLabel ? (
          <Pressable accessibilityRole="button" onPress={onAction} style={styles.link} testID="assistant-notice-action">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.linkText}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** F. SOP answer references: one citation card per source. Only what the server returned; nothing is invented. */
export function SourceList({ sources, palette, onOpenHref }: { sources: AssistantSource[]; palette?: Palette; onOpenHref?: (href: string) => void }) {
  const { t } = useTranslation();
  const { styles } = useCardStyles(palette);
  if (sources.length === 0) return null;
  return (
    <View style={styles.sources} testID="assistant-sources">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label} accessibilityRole="header">
        {t("copilot.sources")}
      </Text>
      {sources.map((source, index) => (
        <SourceCitationCard key={`${source.documentId ?? source.title}-${source.page ?? index}`} source={source} palette={palette} onOpenHref={onOpenHref} />
      ))}
    </View>
  );
}

/** C + D + E. A proposed action in brief. Nothing exists yet; reviewing it opens the confirmation drawer. */
export function ActionSummaryCard({
  item,
  onReview,
  onDismiss,
  palette,
}: {
  item: ActionItem;
  onReview: () => void;
  onDismiss: () => void;
  palette?: Palette;
}) {
  const { t } = useTranslation();
  const { theme, styles } = useCardStyles(palette);
  if (item.status === "dismissed") return null;
  const rows = summarizePreview(item.preview, t)
    .filter((row) => row.key === "title" || row.key === "room")
    .slice(0, 2);
  const confirmed = item.status === "confirmed";
  const busy = item.status === "confirming";
  return (
    <View style={styles.card} testID={`action-card-${item.preview.kind}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.kicker}>
        {t(`copilot.action.kind.${item.preview.kind}`)}
      </Text>
      {rows.map((row) => (
        <Text key={row.key} maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body} numberOfLines={2}>
          {row.key === "room" ? `${row.label} ${row.value}` : row.value}
        </Text>
      ))}
      {confirmed ? (
        <View style={styles.doneRow} accessibilityLiveRegion="polite" testID="action-confirmed">
          <Ionicons name="checkmark-circle" size={16} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.doneText}>
            {item.deduplicated ? t("copilot.action.alreadyCreated") : t(`copilot.action.created.${item.preview.kind}`)}
          </Text>
        </View>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted}>
            {t("assistant.confirm.notYet")}
          </Text>
          {item.status === "failed" && item.failure ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.error} accessibilityLiveRegion="polite" testID="action-failure">
              {t(`copilot.notice.${item.failure}`)}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onReview}
              style={[styles.primary, styles.grow, busy && styles.disabled]}
              testID="action-review"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.primaryText}>
                {t("assistant.confirm.review")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("copilot.dismiss")}
              disabled={busy}
              onPress={onDismiss}
              style={[styles.secondary, busy && styles.disabled]}
              testID="action-dismiss"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.secondaryText}>
                {t("copilot.dismiss")}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    card: {
      marginTop: 4,
      marginBottom: 8,
      alignSelf: "stretch",
      backgroundColor: theme.surfaceElevated,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.ai.line,
      gap: 4,
    },
    kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase", color: theme.ai.primary },
    body: { fontSize: 15, lineHeight: 21, color: theme.textPrimary, fontWeight: "600" },
    muted: { fontSize: 12.5, lineHeight: 18, color: theme.textMuted },
    source: { fontSize: 12, color: theme.textMuted, marginTop: 2 },
    label: { fontSize: 11, fontWeight: "700", color: theme.textMuted, marginBottom: 2 },
    primary: {
      minHeight: 44,
      marginTop: 8,
      borderRadius: 10,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: theme.primaryAction,
    },
    primaryText: { color: theme.onPrimary, fontSize: 14, fontWeight: "800" },
    secondary: {
      minHeight: 44,
      marginTop: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: { color: theme.textSecondary, fontSize: 14, fontWeight: "600" },
    grow: { flex: 1 },
    actions: { flexDirection: "row", gap: 8 },
    disabled: { opacity: 0.45 },
    options: { gap: 6, marginVertical: 6, alignSelf: "stretch" },
    option: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.ai.line,
      backgroundColor: theme.surfaceElevated,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    optionText: { flex: 1, fontSize: 14.5, color: theme.textPrimary, fontWeight: "700" },
    notice: {
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
      padding: 12,
      marginVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    noticeCompact: { padding: 10 },
    noticeBody: { flex: 1 },
    noticeText: { fontSize: 13.5, lineHeight: 19, color: theme.textSecondary },
    link: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
    linkText: { fontSize: 13.5, fontWeight: "800", color: theme.ai.primary },
    sources: { marginTop: 2, marginBottom: 6, paddingHorizontal: 2, gap: 4 },
    sourceRow: { gap: 1 },
    sourceTitle: { fontSize: 12.5, color: theme.textSecondary, fontWeight: "600" },
    doneRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
    doneText: { fontSize: 13.5, color: theme.textPrimary, fontWeight: "700" },
    error: { fontSize: 12.5, color: theme.status.dirty, marginTop: 4 },
  });
