import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import type { DoneResult } from "@/lib/inspections/lists";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** Outcome wording. A historical `conditional` stays its own word: it is neither a pass nor a fail. */
export function outcomeLabel(result: DoneResult, t: Translate): string {
  return t(`inspect.history.result.${result}`);
}

const ICONS: Record<DoneResult, React.ComponentProps<typeof Ionicons>["name"]> = {
  passed: "checkmark-circle",
  failed: "close-circle",
  conditional: "remove-circle",
  unknown: "help-circle",
};

/** A small outcome badge: an icon AND a word, so the result never depends on colour alone. */
export function ResultBadge({ result, t, size = "sm", testID }: { result: DoneResult; t: Translate; size?: "sm" | "lg"; testID?: string }) {
  const theme = useTheme();
  const tone =
    result === "passed"
      ? { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }
      : result === "failed"
        ? { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }
        : { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine };
  const big = size === "lg";
  return (
    <View style={[styles.pill, big && styles.pillLarge, { backgroundColor: tone.bg, borderColor: tone.line }]} testID={testID}>
      <Ionicons name={ICONS[result]} size={big ? 16 : 13} color={tone.fg} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, big && styles.textLarge, { color: tone.fg }]}>
        {outcomeLabel(result, t)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, flexShrink: 1 },
  pillLarge: { paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
  text: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, flexShrink: 1 },
  textLarge: { fontSize: 13 },
});
