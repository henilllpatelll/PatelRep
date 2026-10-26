import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { ProgressText } from "@/lib/inspections/workspaceText";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * How far through the checklist the supervisor is. The bar is COMPLETION only (items reviewed of all items): it never
 * turns green, never implies the room passed, and the words beside it say what is left.
 */
export function ProgressCard({
  text,
  hasIssues,
  hasOpenItems,
  t,
  onNext,
}: {
  text: ProgressText;
  hasIssues: boolean;
  hasOpenItems: boolean;
  t: Translate;
  onNext: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
      testID="workspace-progress"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={text.a11y}
      accessibilityValue={{ min: 0, max: 100, now: text.percent }}
    >
      <View style={styles.row}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
          {t("inspect.workspace.progress.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fraction, { color: theme.textPrimary }]} testID="workspace-progress-fraction">
          {text.fraction}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]} importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${text.percent}%`, backgroundColor: theme.primaryAction }]} testID="workspace-progress-fill" />
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID="workspace-progress-line">
        {text.remaining}
        {"  ·  "}
        <Text style={{ color: hasIssues ? theme.status.dirty : theme.textSecondary }}>{text.issues}</Text>
      </Text>
      {hasOpenItems ? <Button label={t("inspect.workspace.next")} variant="secondary" size="sm" icon="arrow-down" onPress={onNext} testID="workspace-next" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  fraction: { fontSize: 18, fontWeight: "800" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  line: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
