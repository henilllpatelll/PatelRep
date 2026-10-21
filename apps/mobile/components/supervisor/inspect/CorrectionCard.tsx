import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import type { CorrectionItem } from "@/lib/inspections/lists";
import { correctionText, type Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  item: CorrectionItem;
  now: number;
  /** True only when the verified queue says this room can be reinspected right now. */
  canReinspect: boolean;
  t: Translate;
  onPress: (item: CorrectionItem, intent: "reinspect" | "view") => void;
}

/**
 * One outstanding correction. Its status is the server's, its owner is the real assignee (or "Unassigned"), and the
 * only action is navigation: reinspect when the room really is back in the queue, otherwise look at the room.
 */
function CorrectionCardView({ item, now, canReinspect, t, onPress }: Props) {
  const theme = useTheme();
  const text = correctionText(item, now, t);
  const intent = canReinspect ? "reinspect" : "view";
  const action = t(canReinspect ? "inspect.correction.reinspect" : "inspect.correction.viewRoom");
  const tone =
    item.stage === "needs_action"
      ? { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }
      : item.stage === "awaiting_reinspection"
        ? { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }
        : { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine };
  return (
    <Pressable
      onPress={() => onPress(item, intent)}
      accessibilityRole="button"
      accessibilityLabel={t("inspect.correction.a11y", { action, room: item.roomNumber, status: t(`inspect.correction.status.${item.stage}`), details: text.summary })}
      testID={`correction-card-${item.roomId}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.88 }]}
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
      <View style={[styles.action, { borderColor: theme.border, backgroundColor: canReinspect ? theme.primaryAction : theme.surfaceMuted }]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: canReinspect ? theme.onPrimary : theme.textPrimary }]}>
          {action}
        </Text>
        <Ionicons name="arrow-forward" size={18} color={canReinspect ? theme.onPrimary : theme.textPrimary} />
      </View>
    </Pressable>
  );
}

export const CorrectionCard = memo(CorrectionCardView);

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  room: { fontFamily: monoFont, fontSize: 24, lineHeight: 28, fontWeight: "800" },
  badge: { flexShrink: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11.5, fontWeight: "800" },
  detail: { fontSize: 14, fontWeight: "700" },
  line: { fontSize: 13, fontWeight: "600" },
  action: { marginTop: 8, minHeight: 48, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actionText: { fontSize: 15, fontWeight: "800" },
});
