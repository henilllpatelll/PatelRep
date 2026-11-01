import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";

interface Props {
  /** null = the count is not known (a failed read must never show as a confirmed zero). */
  overdue: number | null;
  dueToday: number | null;
  thisWeek: number | null;
  onSelect?: (card: "overdue" | "today" | "week") => void;
}

/** Overdue / Due today / This week. "This week" runs from today to Sunday and excludes overdue, so nothing is counted twice. */
export function PmMetricCards({ overdue, dueToday, thisWeek, onSelect }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const cards = [
    { key: "overdue" as const, label: t("pmSchedules.overdue"), value: overdue, color: theme.status.dirty, bg: theme.status.dirtySoft },
    { key: "today" as const, label: t("pmSchedules.dueToday"), value: dueToday, color: theme.status.pickup, bg: theme.status.pickupSoft },
    { key: "week" as const, label: t("pm.thisWeek"), value: thisWeek, color: theme.status.clean, bg: theme.status.cleanSoft },
  ];
  return (
    <View style={styles.row}>
      {cards.map((card) => (
        <Pressable
          key={card.key}
          onPress={() => onSelect?.(card.key)}
          style={[styles.card, { backgroundColor: card.bg, borderColor: theme.borderSubtle }]}
          accessibilityRole="button"
          accessibilityLabel={`${card.label}: ${card.value ?? t("pm.unknownCount")}`}
          testID={`pm-metric-${card.key}`}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: card.color }]}>
            {card.value ?? "–"}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: card.color }]} numberOfLines={1}>
            {card.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 16 },
  card: { flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 10, justifyContent: "center", gap: 2 },
  value: { fontSize: 24, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600" },
});
