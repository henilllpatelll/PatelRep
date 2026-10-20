import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { BOARD_SEGMENTS, type BoardSegmentKey } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Horizontally scrollable status chips with verified counts: labels never truncate, touch targets stay full size. */
export function BoardSegmentBar({
  selected,
  counts,
  t,
  onSelect,
}: {
  selected: BoardSegmentKey;
  counts: Record<BoardSegmentKey, number>;
  t: Translate;
  onSelect: (segment: BoardSegmentKey) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.scroll}
      accessibilityRole="tablist"
      testID="room-board-segments"
    >
      {BOARD_SEGMENTS.map((key) => {
        const active = selected === key;
        const label = t(`roomBoard.seg.${key}`);
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            testID={`room-board-seg-${key}`}
            accessibilityRole="tab"
            accessibilityLabel={t("roomBoard.seg.a11y", { label, count: counts[key] })}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.chip,
              active
                ? { backgroundColor: theme.primaryAction, borderColor: theme.primaryAction }
                : { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.label, { color: active ? theme.onPrimary : theme.textPrimary }]}
            >
              {label}
            </Text>
            <View style={[styles.count, { backgroundColor: active ? "rgba(255,255,255,0.22)" : theme.surfaceMuted }]}>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.countText, { color: active ? theme.onPrimary : theme.textSecondary }]}
              >
                {counts[key]}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: MIN_TARGET - 4,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 999,
  },
  label: { fontSize: 14, fontWeight: "700" },
  count: { minWidth: 24, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, alignItems: "center" },
  countText: { fontSize: 12, fontWeight: "800" },
});
