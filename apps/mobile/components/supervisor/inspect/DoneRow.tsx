import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { outcomeLabel, ResultBadge } from "@/components/supervisor/inspect/history/ResultBadge";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { DoneItem } from "@/lib/inspections/lists";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  item: DoneItem;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  /** Show the building with the floor (the hotel has more than one). */
  showBuilding?: boolean;
  onPress: (item: DoneItem) => void;
}

/** "Building A · Floor 2", or just the floor; null when the record has neither. */
export function locationText(item: Pick<DoneItem, "floor" | "building">, showBuilding: boolean, t: Translate): string | null {
  const floor = item.floor === null ? null : t("inspect.history.row.floor", { floor: item.floor });
  const building = showBuilding && item.building ? item.building : null;
  const parts = [building, floor].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function DoneRowView({ item, timeZone, language, t, showBuilding = false, onPress }: Props) {
  const theme = useTheme();
  const inspector = item.inspectorName ?? t("inspect.done.inspectorUnknown");
  const clock = formatHotelTime(item.completedAtMs === null ? null : new Date(item.completedAtMs), timeZone, language) ?? "—";
  const result = outcomeLabel(item.result, t);
  const location = locationText(item, showBuilding, t);
  const room = item.roomNumber || t("inspect.history.row.roomUnknown");
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={t(item.isReinspection ? "inspect.history.row.a11yReinspection" : "inspect.history.row.a11y", { room, result, inspector, time: clock, location: location ?? "" })}
      testID={`done-row-${item.id}`}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.88 }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textPrimary }]} numberOfLines={1}>
        {room}
      </Text>
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.inspector, { color: item.inspectorName ? theme.textSecondary : theme.textMuted }]} numberOfLines={1} testID={`done-inspector-${item.id}`}>
          {inspector}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.textMuted }]} numberOfLines={2}>
          {clock}
          {item.isReinspection ? ` · ${t("inspect.done.reinspection")}` : ""}
          {location ? ` · ${location}` : ""}
        </Text>
      </View>
      <ResultBadge result={item.result} t={t} testID={`done-result-${item.id}`} />
      <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
    </Pressable>
  );
}

export const DoneRow = memo(DoneRowView);

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 11 },
  room: { fontFamily: monoFont, fontSize: 20, fontWeight: "800", minWidth: 52 },
  body: { flex: 1, minWidth: 0, gap: 1 },
  inspector: { fontSize: 13, fontWeight: "700" },
  time: { fontSize: 12 },
});
