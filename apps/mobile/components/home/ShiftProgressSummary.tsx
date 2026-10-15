import { useRef, type RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/shared/evening";
import { Kicker, LinkButton, MAX_FONT_SCALE } from "@/components/home/homeUi";
import type { HomeProgress } from "@/lib/housekeeping/homeModel";
import type { ProgressCounts } from "@/lib/housekeeping/homeState";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  progress: HomeProgress;
  counts: ProgressCounts;
  t: Translate;
  /** Shown only when a details destination exists; there is no dead "View details". */
  onViewDetails?: (opener: RefObject<unknown>) => void;
}

/**
 * One compact card on the authoritative progress model: completed of
 * serviceable (unavailable rooms are never counted as cleaned), then three
 * disjoint buckets that can not double count a room.
 */
export function ShiftProgressSummary({ progress, counts, t, onViewDetails }: Props) {
  const theme = useTheme();
  const detailsRef = useRef<unknown>(null);
  const { completed, serviceable } = progress;

  const notes: string[] = [];
  if (progress.inspected > 0 || progress.submitted > 0) {
    notes.push(t("home.progress.detail", { submitted: progress.submitted, inspected: progress.inspected }));
  }
  if (progress.unavailable > 0) notes.push(t("home.progress.unavailable", { count: progress.unavailable }));
  if (progress.awaitingConfirmation > 0) notes.push(t("home.progress.waiting", { count: progress.awaitingConfirmation }));

  const headline =
    serviceable > 0 ? t("home.progress.headline", { done: completed, total: serviceable }) : t("home.progress.noneServiceable");

  const chips: Array<{ key: string; icon: keyof typeof Ionicons.glyphMap; value: number; label: string; color: string }> = [
    { key: "to-clean", icon: "ellipse-outline", value: counts.toClean, label: t("home.progress.toClean"), color: theme.textPrimary },
    { key: "in-progress", icon: "play-circle-outline", value: counts.inProgress, label: t("home.progress.inProgress"), color: theme.status.inProgress },
    { key: "attention", icon: "alert-circle-outline", value: counts.needAttention, label: t("home.progress.needAttention"), color: theme.status.pickup },
  ];

  return (
    <Card style={styles.card} testID="shift-progress-card">
      <Kicker>{t("home.progress.kicker")}</Kicker>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headline, { color: theme.textPrimary }]}>
        {headline}
      </Text>
      {serviceable > 0 ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={headline}
          accessibilityValue={{ min: 0, max: serviceable, now: completed }}
        >
          <ProgressBar value={completed} total={serviceable} color={theme.status.ready} />
        </View>
      ) : null}
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View
            key={chip.key}
            style={styles.chip}
            accessible
            accessibilityLabel={`${chip.value} ${chip.label}`}
            testID={`progress-${chip.key}`}
          >
            <Ionicons name={chip.icon} size={14} color={chip.value > 0 ? chip.color : theme.textDisabled} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: chip.value > 0 ? theme.textPrimary : theme.textMuted }]}>
              <Text style={styles.chipValue}>{chip.value}</Text> {chip.label}
            </Text>
          </View>
        ))}
      </View>
      {notes.length > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notes, { color: theme.textMuted }]} testID="progress-notes">
          {notes.join(" · ")}
        </Text>
      ) : null}
      {onViewDetails ? (
        <LinkButton
          ref={detailsRef as never}
          label={t("home.progress.viewDetails")}
          icon="arrow-forward"
          onPress={() => onViewDetails(detailsRef)}
          testID="progress-details"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  headline: { fontSize: 22, fontWeight: "700", lineHeight: 28 },
  chips: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5 },
  chipText: { fontSize: 13, lineHeight: 18 },
  chipValue: { fontWeight: "800" },
  notes: { fontSize: 12, lineHeight: 17 },
});
