import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Placeholder rows while nothing has been verified: no counts, no "all caught up". */
export function InspectSkeleton({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.skeletons} accessible accessibilityRole="progressbar" accessibilityLabel={label} testID="inspect-skeleton">
      {[0, 1, 2].map((n) => (
        <View key={n} style={[styles.skeleton, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.bar, { width: 70, height: 22, backgroundColor: theme.surfaceMuted }]} />
          <View style={[styles.bar, { width: "55%", backgroundColor: theme.surfaceMuted }]} />
          <View style={[styles.bar, { width: "75%", backgroundColor: theme.surfaceMuted }]} />
          <View style={[styles.bar, { width: "100%", height: 44, backgroundColor: theme.surfaceMuted }]} />
        </View>
      ))}
    </View>
  );
}

/** A centred message with at most one action. The wording says exactly what is known. */
export function InspectNotice({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  tone = "neutral",
  testID,
}: {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "good" | "problem";
  testID: string;
}) {
  const theme = useTheme();
  const color = tone === "good" ? theme.status.ready : tone === "problem" ? theme.status.dirty : theme.textMuted;
  return (
    <View testID={testID} accessibilityRole={tone === "problem" ? "alert" : undefined}>
      <EmptyState
        icon={icon}
        iconColor={color}
        title={title}
        body={body}
        action={actionLabel && onAction ? <Button label={actionLabel} variant="secondary" size="md" onPress={onAction} testID={`${testID}-action`} /> : undefined}
      />
    </View>
  );
}

/** Data on screen that is no longer verified: says so, and offers the one fix. */
export function StaleBanner({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert" testID="inspect-stale-banner">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
        {message}
      </Text>
      <Button label={actionLabel} variant="secondary" size="sm" onPress={onAction} testID="inspect-stale-banner-refresh" />
    </View>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: 10 },
  skeleton: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 10 },
  bar: { height: 12, borderRadius: 6 },
  banner: { borderWidth: 1, borderRadius: R.lg, padding: 12, gap: 8 },
  bannerText: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
