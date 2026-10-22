import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import type { QueueItem } from "@/lib/inspections/queue";
import { cardText, type Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  item: QueueItem;
  /** The clock, floored to the minute so cards do not redraw on every tick. */
  now: number;
  timeZone: string | null | undefined;
  language: string;
  showBuilding: boolean;
  /** Set when the room's checklist is known to be unusable: the room stays visible, the action explains itself. */
  blockedReason: string | null;
  t: Translate;
  onPress: (item: QueueItem) => void;
}

/**
 * One room waiting for a supervisor. The whole card opens that room by its stable id. It deliberately offers no
 * pass / fail shortcut: an outcome is only ever chosen inside the inspection itself.
 */
function InspectionQueueCardView({ item, now, timeZone, language, showBuilding, blockedReason, t, onPress }: Props) {
  const theme = useTheme();
  const text = cardText(item, { now, timeZone }, language, showBuilding, t);
  const blocked = blockedReason !== null;
  const action = blocked ? t("inspect.card.unavailable") : t(text.reinspection ? "inspect.card.reinspect" : "inspect.card.start");
  const rail = text.badge === "overdue" ? theme.status.dirty : text.reinspection ? theme.status.pickup : theme.status.clean;
  const badgeColors =
    text.badge === "overdue"
      ? { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }
      : text.badge === "reinspection"
        ? { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine }
        : { fg: theme.status.clean, bg: theme.status.cleanSoft, line: theme.status.cleanLine };

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={t("inspect.card.a11y", { action, room: item.roomNumber, details: text.summary })}
      accessibilityState={{ disabled: blocked }}
      testID={`queue-card-${item.roomId}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.textPrimary },
        pressed && { opacity: 0.88 },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: rail }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textPrimary }]} testID={`queue-card-number-${item.roomId}`}>
            {item.roomNumber}
          </Text>
          {text.badge ? (
            <View style={[styles.badge, { backgroundColor: badgeColors.bg, borderColor: badgeColors.line }]} testID={`queue-card-badge-${item.roomId}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: badgeColors.fg }]}>
                {t(`inspect.card.badge.${text.badge}`)}
              </Text>
            </View>
          ) : null}
        </View>
        {text.where ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} numberOfLines={1}>
            {text.where}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} numberOfLines={2}>
          {text.who}
        </Text>
        {text.note ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: text.badge === "overdue" ? theme.status.dirty : theme.textPrimary }]} numberOfLines={1}>
            {text.note}
          </Text>
        ) : null}
        {text.failedItems ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textMuted }]} numberOfLines={1}>
            {text.failedItems}
          </Text>
        ) : null}
        {blocked ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID={`queue-card-blocked-${item.roomId}`}>
            {blockedReason}
          </Text>
        ) : null}
        <View
          style={[
            styles.action,
            blocked ? { backgroundColor: theme.surfaceMuted, borderColor: theme.border } : { backgroundColor: theme.primaryAction, borderColor: theme.primaryAction },
          ]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: blocked ? theme.textMuted : theme.onPrimary }]}>
            {action}
          </Text>
          {blocked ? <Ionicons name="alert-circle-outline" size={18} color={theme.textMuted} /> : <Ionicons name="arrow-forward" size={18} color={theme.onPrimary} />}
        </View>
      </View>
    </Pressable>
  );
}

export const InspectionQueueCard = memo(InspectionQueueCardView);

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: R.lg,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  rail: { width: 5 },
  body: { flex: 1, minWidth: 0, gap: 3, paddingHorizontal: 14, paddingVertical: 12 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  room: { fontFamily: monoFont, fontSize: 26, lineHeight: 30, fontWeight: "800" },
  badge: { flexShrink: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11.5, fontWeight: "800" },
  line: { fontSize: 13, fontWeight: "600" },
  note: { fontSize: 13, fontWeight: "700" },
  action: {
    marginTop: 8,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: R.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionText: { fontSize: 15, fontWeight: "800" },
});
