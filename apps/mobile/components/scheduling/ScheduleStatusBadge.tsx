import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { STATUS_PRESENTATION, statusLabel, type StatusTone, type Translate } from "@/lib/scheduling/teamScheduleText";
import type { DisplayStatus } from "@/lib/scheduling/teamScheduleModel";
import { useTheme } from "@/lib/theme/useTheme";

/** Tone → the three colours a pill needs. Neutral borrows the muted surface so it never competes with a warning. */
export function useToneColors(tone: StatusTone) {
  const theme = useTheme();
  if (tone === "neutral") return { fg: theme.textSecondary, bg: theme.surfaceMuted, line: theme.border };
  return { fg: theme.status[tone], bg: theme.status[`${tone}Soft` as const], line: theme.status[`${tone}Line` as const] };
}

/**
 * One attendance status as icon + word + tint. The icon and the word carry the meaning; colour only reinforces
 * it, so it reads the same in grayscale, in dark mode and to a colour-blind reader.
 */
export function ScheduleStatusBadge({ status, t, testID }: { status: DisplayStatus; t: Translate; testID?: string }) {
  const { icon, tone } = STATUS_PRESENTATION[status];
  const { fg, bg, line } = useToneColors(tone);
  const label = statusLabel(status, t);
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: line }]} accessible accessibilityLabel={label} testID={testID}>
      <Ionicons name={icon} size={13} color={fg} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", flexShrink: 1 },
  text: { fontSize: 12, fontWeight: "700", flexShrink: 1 },
});
