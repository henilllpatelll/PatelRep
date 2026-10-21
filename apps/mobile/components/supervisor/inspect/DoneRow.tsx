import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { DoneItem, DoneResult } from "@/lib/inspections/lists";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** Result wording: always a word, never colour alone. */
export function resultLabel(result: DoneResult, t: Translate): string {
  return t(`inspect.result.${result}`);
}

interface Props {
  item: DoneItem;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  onPress: (item: DoneItem) => void;
}

function DoneRowView({ item, timeZone, language, t, onPress }: Props) {
  const theme = useTheme();
  const tone =
    item.result === "passed"
      ? { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }
      : item.result === "failed"
        ? { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }
        : { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine };
  const inspector = item.inspectorName ?? t("inspect.done.inspectorUnknown");
  const clock = formatHotelTime(item.completedAtMs === null ? null : new Date(item.completedAtMs), timeZone, language) ?? "—";
  const result = resultLabel(item.result, t);
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={t("inspect.done.a11y", { room: item.roomNumber, result, inspector, time: clock })}
      testID={`done-row-${item.id}`}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.88 }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textPrimary }]}>
        {item.roomNumber}
      </Text>
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.inspector, { color: theme.textSecondary }]} numberOfLines={1} testID={`done-inspector-${item.id}`}>
          {inspector}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.textMuted }]} numberOfLines={1}>
          {clock}
          {item.isReinspection ? ` · ${t("inspect.done.reinspection")}` : ""}
        </Text>
      </View>
      <View style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.line }]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: tone.fg }]}>
          {result}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
    </Pressable>
  );
}

export const DoneRow = memo(DoneRowView);

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 11 },
  room: { fontFamily: monoFont, fontSize: 20, fontWeight: "800" },
  body: { flex: 1, minWidth: 0, gap: 1 },
  inspector: { fontSize: 13, fontWeight: "700" },
  time: { fontSize: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
});
