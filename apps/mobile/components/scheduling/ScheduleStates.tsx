import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Skeleton } from "@/components/supervisor/today/TodayBlocks";
import type { SourceFailure } from "@/lib/housekeeping/supervisorSources";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/** Card-shaped placeholders, so the layout does not jump when the schedule lands. */
export function ScheduleSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.skeleton} testID="team-schedule-skeleton" accessible accessibilityLabel={t("teamSchedule.loading")} accessibilityRole="progressbar">
      <Skeleton height={120} />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={84} />
      ))}
    </View>
  );
}

function ActionButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={({ pressed }) => [styles.action, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, pressed && { opacity: 0.8 }]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The schedule could not be loaded. Says why (offline / not allowed / server) and offers a retry — never "no shifts". */
export function ScheduleError({ failure, onRetry, t }: { failure: SourceFailure | null; onRetry: () => void; t: Translate }) {
  const theme = useTheme();
  const kind = failure?.kind ?? "error";
  return (
    <View style={styles.center} accessibilityRole="alert" testID="team-schedule-error">
      <Ionicons name={kind === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={28} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
        {t(`teamSchedule.error.${kind}.title`)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t(`teamSchedule.error.${kind}.body`)}
      </Text>
      {kind !== "forbidden" ? <ActionButton label={t("teamSchedule.retry")} onPress={onRetry} testID="team-schedule-retry" /> : null}
    </View>
  );
}

export type EmptyKind = "noStaff" | "nobodyScheduled" | "search" | "filters";

/** Every honest reason the list can be empty, each with its own words and way out. */
export function ScheduleEmpty({ kind, dateLabel, onClear, t }: { kind: EmptyKind; dateLabel: string; onClear?: () => void; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.center} testID={`team-schedule-empty-${kind}`}>
      <Ionicons name={kind === "search" || kind === "filters" ? "search-outline" : "calendar-outline"} size={28} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
        {t(`teamSchedule.empty.${kind}.title`, { date: dateLabel })}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t(`teamSchedule.empty.${kind}.body`, { date: dateLabel })}
      </Text>
      {onClear ? <ActionButton label={t(`teamSchedule.empty.${kind}.action`)} onPress={onClear} testID={`team-schedule-empty-${kind}-action`} /> : null}
    </View>
  );
}

/** An empty state with its own words (the shift-template list). */
export function ScheduleEmptyCard({ title, body, testID }: { title: string; body: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.center} testID={testID}>
      <Ionicons name="layers-outline" size={28} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {body}
      </Text>
    </View>
  );
}

/** A one-line banner above the list (offline, saved copy). */
export function ScheduleBanner({ text, icon, testID }: { text: string; icon: "cloud-offline-outline" | "time-outline"; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityLiveRegion="polite" accessibilityRole="alert" testID={testID}>
      <Ionicons name={icon} size={16} color={theme.status.pickup} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: 12, paddingHorizontal: 16 },
  center: { alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 36 },
  title: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  body: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  action: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: 999, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", marginTop: 6 },
  actionText: { fontSize: 15, fontWeight: "700" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 18, fontWeight: "600" },
});
