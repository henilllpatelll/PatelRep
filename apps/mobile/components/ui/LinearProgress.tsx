import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

export type ProgressTone = "primary" | "ready" | "inProgress" | "pickup" | "ai";

export interface LinearProgressProps {
  value: number;
  total: number;
  tone?: ProgressTone;
  /** Spoken description, e.g. "Checklist, 6 of 9 steps". Required: the bar alone says nothing. */
  accessibilityLabel: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** LinearProgress has a static fill (no animation), so it is reduced-motion safe by
 *  construction. Always pair it with visible "x of y" text; fill color is never the only signal. */
export function LinearProgress({
  value,
  total,
  tone = "primary",
  accessibilityLabel,
  height = 8,
  style,
  testID,
}: LinearProgressProps) {
  const theme = useTheme();
  const safeTotal = total > 0 ? total : 1;
  const clamped = Math.max(0, Math.min(value, safeTotal));
  const ratio = clamped / safeTotal;
  const fill = {
    primary: theme.primaryAction,
    ready: theme.status.ready,
    inProgress: theme.status.inProgress,
    pickup: theme.status.pickup,
    ai: theme.ai.primary,
  }[tone];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: safeTotal, now: clamped }}
      style={[
        styles.track,
        { height, borderRadius: height / 2, backgroundColor: theme.surfaceMuted },
        style,
      ]}
    >
      <View
        style={{
          width: `${Math.round(ratio * 100)}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: "hidden", alignSelf: "stretch" },
});
