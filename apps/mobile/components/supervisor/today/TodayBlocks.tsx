import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

/* Shared building blocks for the Supervisor Today sections. */

export function SectionCard({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }, style]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityRole="header"
        style={[styles.headerTitle, { color: theme.textPrimary }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

/** A text link with a full-size touch target. */
export function LinkAction({
  label,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={theme.primaryAction} />
    </Pressable>
  );
}

export function ProgressBar({
  fraction,
  color,
  height = 8,
  testID,
}: {
  /** 0..1, clamped. */
  fraction: number;
  color: string;
  height?: number;
  testID?: string;
}) {
  const theme = useTheme();
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      testID={testID}
      accessible={false}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.surfaceMuted }]}
    >
      <View style={{ width: `${pct}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

export function Skeleton({ height, width, testID }: { height: number; width?: number | `${number}%`; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, width: width ?? "100%", borderRadius: R.sm, backgroundColor: theme.surfaceMuted }}
    />
  );
}

/** Something could not be loaded: say so, and offer a retry. Never a zero. */
export function UnavailableBlock({
  title,
  hint,
  retryLabel,
  onRetry,
  testID,
}: {
  title: string;
  hint?: string;
  retryLabel: string;
  onRetry: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View testID={testID} style={styles.unavailable}>
      <Ionicons name="cloud-offline-outline" size={22} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.unavailableTitle, { color: theme.textPrimary }]}>
        {title}
      </Text>
      {hint ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.unavailableHint, { color: theme.textSecondary }]}>
          {hint}
        </Text>
      ) : null}
      <Pressable
        onPress={onRetry}
        testID="today-retry"
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        style={({ pressed }) => [
          styles.retry,
          { borderColor: theme.primaryLine, backgroundColor: theme.surface },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retryText, { color: theme.primaryAction }]}>
          {retryLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 28 },
  headerTitle: { fontSize: 17, fontWeight: "700", flexShrink: 1 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32, justifyContent: "flex-end" },
  linkText: { fontSize: 14, fontWeight: "700" },
  track: { width: "100%", overflow: "hidden" },
  unavailable: { alignItems: "center", gap: 6, paddingVertical: 8 },
  unavailableTitle: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  unavailableHint: { fontSize: 13, textAlign: "center" },
  retry: {
    marginTop: 6,
    minHeight: MIN_TARGET,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderRadius: R.md,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { fontSize: 14, fontWeight: "700" },
});
