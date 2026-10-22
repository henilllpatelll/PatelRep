import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { CorrectionGroups } from "@/lib/inspections/lists";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** Needs attention · With housekeepers · Ready to reinspect. A count is shown only for a verified list; "at least" when truncated. */
export function CorrectionSummary({ groups, atLeast, t }: { groups: CorrectionGroups; atLeast: boolean; t: Translate }) {
  const theme = useTheme();
  const tiles = [
    { key: "needsAttention", value: groups.needsAttention, color: groups.needsAttention > 0 ? theme.status.dirty : theme.textPrimary },
    { key: "withHousekeepers", value: groups.withHousekeepers, color: theme.status.pickup },
    { key: "readyToReinspect", value: groups.readyToReinspect, color: groups.readyToReinspect > 0 ? theme.status.ready : theme.textPrimary },
  ] as const;
  return (
    <View style={styles.row} testID="correction-summary">
      {tiles.map((tile) => {
        const shown = `${tile.value}${atLeast ? "+" : ""}`;
        return (
          <View
            key={tile.key}
            style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessible
            accessibilityLabel={t(`inspect.correctionsSummary.${tile.key}A11y`, { count: tile.value })}
            testID={`correction-summary-${tile.key}`}
          >
            <Text maxFontSizeMultiplier={1.3} style={[styles.value, { color: tile.color }]}>
              {shown}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textSecondary }]}>
              {t(`inspect.correctionsSummary.${tile.key}`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: R.md, paddingVertical: 8, paddingHorizontal: 6 },
  value: { fontSize: 22, lineHeight: 26, fontWeight: "800" },
  label: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
});
