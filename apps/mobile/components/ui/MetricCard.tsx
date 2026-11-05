import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";

export type MetricTone = "neutral" | "ready" | "inProgress" | "dirty" | "pickup" | "ai";

export interface MetricCardProps {
  label: string;
  value: string;
  /** Short supporting text ("of 12 rooms"). */
  caption?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  tone?: MetricTone;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** MetricCard is a compact KPI tile. The icon tile carries the tone; the value and label carry
 *  the meaning, so nothing depends on color alone. It becomes a button when `onPress` is given. */
export function MetricCard({
  label,
  value,
  caption,
  icon,
  tone = "neutral",
  onPress,
  style,
  testID,
}: MetricCardProps) {
  const theme = useTheme();
  const s = theme.status;
  const toneMap = {
    neutral: { fg: theme.textSecondary, bg: theme.surfaceMuted },
    ready: { fg: s.ready, bg: s.readySoft },
    inProgress: { fg: s.inProgress, bg: s.inProgressSoft },
    dirty: { fg: s.dirty, bg: s.dirtySoft },
    pickup: { fg: s.pickup, bg: s.pickupSoft },
    ai: { fg: theme.ai.primary, bg: theme.ai.soft },
  }[tone];
  const spoken = [label, value, caption].filter(Boolean).join(", ");

  const body = (
    <>
      <View style={styles.top}>
        <AppText variant="caption" tone="secondary" style={styles.flex} numberOfLines={2}>
          {label}
        </AppText>
        {icon ? (
          <View style={[styles.iconTile, { backgroundColor: toneMap.bg }]}>
            <Ionicons name={icon} size={16} color={toneMap.fg} />
          </View>
        ) : null}
      </View>
      <AppText variant="title" numeric>
        {value}
      </AppText>
      {caption ? (
        <AppText variant="micro" tone="muted" numberOfLines={2}>
          {caption}
        </AppText>
      ) : null}
    </>
  );

  const containerStyle = [
    styles.card,
    { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        style={({ pressed }) => [
          containerStyle,
          pressed ? { backgroundColor: theme.surfaceMuted } : null,
        ]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View testID={testID} accessible accessibilityLabel={spoken} style={containerStyle}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: radiusV2.card,
    padding: 12,
    gap: 4,
  },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  flex: { flex: 1 },
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: radiusV2.chip,
    alignItems: "center",
    justifyContent: "center",
  },
});
