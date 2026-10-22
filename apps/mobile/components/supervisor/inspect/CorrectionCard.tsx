import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { correctionAction, type CorrectionAction, type CorrectionItem } from "@/lib/inspections/lists";
import { correctionText, type Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  item: CorrectionItem;
  now: number;
  /** True only when the verified queue says this room can be reinspected right now. */
  roomAwaitingInspection: boolean;
  t: Translate;
  /** The card itself: open the correction. */
  onOpen: (item: CorrectionItem) => void;
  /** The one action the card offers (reinspect, assign, request again, or just view). */
  onAction: (item: CorrectionItem, action: CorrectionAction) => void;
}

const ACTION_LABEL: Record<CorrectionAction, string> = {
  reinspect: "inspect.correction.startReinspection",
  repair: "inspect.correction.requestAgain",
  assign: "inspect.correction.assign",
  view: "inspect.correction.view",
};

/**
 * One outstanding correction. Its status is the server's, its owner is the real assignee (or "Unassigned"). Tapping the
 * card opens the correction; the button does the one thing that moves it forward - and says so ("Start reinspection"
 * only when the room really is back in the queue).
 */
function CorrectionCardView({ item, now, roomAwaitingInspection, t, onOpen, onAction }: Props) {
  const theme = useTheme();
  const text = correctionText(item, now, t);
  const action = correctionAction(item, roomAwaitingInspection);
  const primary = action !== "view";
  const label = t(ACTION_LABEL[action]);
  const tone =
    item.stage === "needs_action"
      ? { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }
      : item.stage === "awaiting_reinspection"
        ? { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }
        : { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine };
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`correction-card-${item.roomId}`}>
      <Pressable
        onPress={() => onOpen(item)}
        accessibilityRole="button"
        accessibilityLabel={t("inspect.correction.openA11y", { room: item.roomNumber, status: t(`inspect.correction.status.${item.stage}`), details: text.summary })}
        testID={`correction-open-${item.roomId}`}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.88 }]}
      >
        <View style={styles.topRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textPrimary }]}>
            {item.roomNumber}
          </Text>
          <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.line }]} testID={`correction-status-${item.roomId}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: tone.fg }]}>
              {t(`inspect.correction.status.${item.stage}`)}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textPrimary }]}>
          {text.kind ? `${text.kind} · ${text.detail}` : text.detail}
        </Text>
        {item.failedLabels.length > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} numberOfLines={2}>
            {text.failed}: {item.failedLabels.join(", ")}
          </Text>
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]}>
            {text.failed}
          </Text>
        )}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} numberOfLines={1}>
          {text.owner}
          {text.updated ? ` · ${text.updated}` : ""}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onAction(item, action)}
        accessibilityRole="button"
        accessibilityLabel={t("inspect.correction.a11y", { action: label, room: item.roomNumber, status: t(`inspect.correction.status.${item.stage}`), details: text.summary })}
        testID={`correction-action-${item.roomId}`}
        style={({ pressed }) => [styles.action, { borderColor: theme.border, backgroundColor: primary ? theme.primaryAction : theme.surfaceMuted }, pressed && { opacity: 0.88 }]}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: primary ? theme.onPrimary : theme.textPrimary }]}>
          {label}
        </Text>
        <Ionicons name="arrow-forward" size={18} color={primary ? theme.onPrimary : theme.textPrimary} />
      </Pressable>
    </View>
  );
}

export const CorrectionCard = memo(CorrectionCardView);

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  body: { gap: 3 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  room: { fontFamily: monoFont, fontSize: 24, lineHeight: 28, fontWeight: "800" },
  badge: { flexShrink: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11.5, fontWeight: "800" },
  detail: { fontSize: 14, fontWeight: "700" },
  line: { fontSize: 13, fontWeight: "600" },
  action: { minHeight: 48, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actionText: { fontSize: 15, fontWeight: "800" },
});
