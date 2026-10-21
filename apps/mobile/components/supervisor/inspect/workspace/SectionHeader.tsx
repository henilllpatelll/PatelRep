import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { SectionSummary } from "@/lib/inspections/workspace";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  summary: SectionSummary;
  expanded: boolean;
  t: Translate;
  onToggle: (name: string) => void;
}

/** One configured section: its name, how much of it is reviewed, and whether anything required is still open. */
function SectionHeaderView({ summary, expanded, t, onToggle }: Props) {
  const theme = useTheme();
  const complete = summary.requiredMissing === 0 && summary.answered === summary.total;
  const open = summary.requiredMissing > 0;
  const count = `${summary.answered}/${summary.total}`;
  const state = open
    ? t("inspect.workspace.section.requiredLeft", { count: summary.requiredMissing })
    : complete
      ? t("inspect.workspace.section.done")
      : t("inspect.workspace.section.optionalLeft");
  const issues = summary.failed > 0 ? t("inspect.workspace.section.issues", { count: summary.failed }) : null;
  const a11y = [
    t("inspect.workspace.section.a11y", { name: summary.name, answered: summary.answered, total: summary.total }),
    state,
    issues,
    t(expanded ? "inspect.workspace.section.expanded" : "inspect.workspace.section.collapsed"),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      onPress={() => onToggle(summary.name)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ expanded }}
      testID={`workspace-section-${summary.name}`}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={18} color={theme.textSecondary} />
      <View style={styles.main}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
          {summary.name.toUpperCase()}
        </Text>
        <View style={styles.meta}>
          {open ? (
            <View style={[styles.dot, { backgroundColor: theme.status.pickup }]} testID={`workspace-section-open-${summary.name}`} />
          ) : complete ? (
            <Ionicons name="checkmark-circle" size={14} color={theme.status.ready} />
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.state, { color: open ? theme.status.pickup : theme.textSecondary }]} numberOfLines={1}>
            {state}
          </Text>
          {issues ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.state, { color: theme.status.dirty }]} numberOfLines={1}>
              {"· "}
              {issues}
            </Text>
          ) : null}
        </View>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textPrimary }]} testID={`workspace-section-count-${summary.name}`}>
        {count}
      </Text>
    </Pressable>
  );
}

export const SectionHeader = memo(SectionHeaderView);

const styles = StyleSheet.create({
  row: { minHeight: MIN_TARGET + 8, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  state: { fontSize: 12, fontWeight: "700" },
  count: { fontSize: 15, fontWeight: "800" },
});
