import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { AttentionFilter } from "@/lib/housekeeping/supervisorAttentionCenter";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  filters: AttentionFilter[];
  selected: AttentionFilter;
  counts: Record<AttentionFilter, number>;
  t: Translate;
  onSelect: (filter: AttentionFilter) => void;
}

/** A compact, horizontally scrolling filter row. Switching only re-slices what is already loaded. */
export function AttentionFilters({ filters, selected, counts, t, onSelect }: Props) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel={t("supervisorAttention.filterBarA11y")}
      testID="attention-filters"
    >
      {filters.map((filter) => {
        const active = filter === selected;
        const label = t(`supervisorAttention.filter.${filter}`);
        return (
          <Pressable
            key={filter}
            onPress={() => onSelect(filter)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(active ? "supervisorAttention.filterSelectedA11y" : "supervisorAttention.filterA11y", { label, count: counts[filter] })}
            testID={`attention-filter-${filter}`}
            style={[
              styles.chip,
              { borderColor: active ? theme.primaryAction : theme.border, backgroundColor: active ? theme.primaryAction : theme.surface },
            ]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: active ? theme.onPrimary : theme.textPrimary }]}>
              {label}
              <Text style={{ opacity: active ? 0.9 : 0.6 }}>{`  ${counts[filter]}`}</Text>
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // A horizontal ScrollView grows to fill a column parent by default; the chips must stay one line tall.
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: 18, paddingVertical: 10, gap: 8, alignItems: "center" },
  chip: { minHeight: MIN_TARGET - 4, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 14, fontWeight: "700" },
});
