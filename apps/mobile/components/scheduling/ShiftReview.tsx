import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { PreviewResult, ScheduleWarning, WriteFailure } from "@/lib/api/schedulingManage";
import type { ChangedField } from "@/lib/scheduling/shiftForm";
import { failureBody, failureTitle, warningText } from "@/lib/scheduling/shiftText";
import { formatShortDate, formatWallClock } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const ITEMS_SHOWN = 12;

/** What the server will refuse or ask the supervisor to weigh, in words. Used for create previews and failed saves. */
export function FailurePanel({ failure, t, testID = "shift-failure" }: { failure: WriteFailure; t: Translate; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceMuted, borderColor: theme.status.dirty }]} accessibilityRole="alert" testID={testID}>
      <View style={styles.titleRow}>
        <Ionicons name="alert-circle-outline" size={20} color={theme.status.dirty} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {failureTitle(failure, t)}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {failureBody(failure, t)}
      </Text>
      {failure.conflicts.length > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID={`${testID}-conflicts`}>
          {t("teamSchedule.manage.conflictDates", { dates: [...new Set(failure.conflicts.map((c) => c.workDate).filter((d): d is string => d !== null))].map((d) => formatShortDate(d)).join(", ") })}
        </Text>
      ) : null}
      {failure.warnings.filter((w) => w.severity === "block").map((w) => (
        <Text key={`${w.code}:${w.workDate}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {warningText(w, t)}
        </Text>
      ))}
    </View>
  );
}

export function WarningsList({ warnings, t, testID = "shift-warnings" }: { warnings: readonly ScheduleWarning[]; t: Translate; testID?: string }) {
  const theme = useTheme();
  if (warnings.length === 0) return null;
  // One line per kind of warning: the same rule hit on ten dates is one sentence, not ten.
  const kinds = [...new Map(warnings.map((w) => [w.code, w])).values()];
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceMuted, borderColor: theme.status.pickup }]} testID={testID}>
      <View style={styles.titleRow}>
        <Ionicons name="warning-outline" size={20} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("teamSchedule.manage.warningsTitle", { count: warnings.length })}
        </Text>
      </View>
      {kinds.map((w) => (
        <Text key={w.code} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {warningText(w, t)}
        </Text>
      ))}
    </View>
  );
}

interface ReviewProps {
  preview: PreviewResult;
  nameOf: (userId: string) => string;
  zone: string | null;
  language?: string;
  t: Translate;
}

/** The shifts a create or recurring request would write: dates, time windows, who, and which already exist. */
export function ReviewList({ preview, nameOf, zone, language, t }: ReviewProps) {
  const theme = useTheme();
  const shown = preview.items.slice(0, ITEMS_SHOWN);
  const people = new Set(preview.items.map((item) => item.userId)).size;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="shift-review">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
        {t("teamSchedule.manage.review.summary", { count: preview.createCount, people })}
      </Text>
      {preview.unchangedCount > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="shift-review-existing">
          {t("teamSchedule.manage.review.existing", { count: preview.unchangedCount })}
        </Text>
      ) : null}
      {shown.map((item) => {
        const start = formatWallClock(item.workDate, item.startTime, item.startsAt ?? "", zone, language);
        const end = formatWallClock(item.workDate, item.endTime, item.endsAt ?? "", zone, language);
        return (
          <View key={`${item.userId}:${item.shiftId}:${item.workDate}`} style={styles.line} testID={`shift-review-${item.workDate}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textPrimary }]}>
              {formatShortDate(item.workDate, language)}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.window, { color: theme.textSecondary }]} numberOfLines={2}>
              {`${start} – ${end} · ${nameOf(item.userId)}`}
              {item.status === "existing" ? ` · ${t("teamSchedule.manage.review.alreadyThere")}` : ""}
            </Text>
          </View>
        );
      })}
      {preview.items.length > shown.length ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("teamSchedule.manage.review.more", { count: preview.items.length - shown.length })}
        </Text>
      ) : null}
    </View>
  );
}

const FIELD_KEYS: Record<ChangedField, string> = {
  employee: "employee",
  date: "date",
  template: "template",
  startTime: "startTime",
  endTime: "endTime",
  notes: "notes",
};

/** Someone else changed this shift. Nothing was overwritten; this says what differs and asks for a fresh decision. */
export function VersionConflictPanel({ fields, onReload, busy, t }: { fields: readonly ChangedField[]; onReload: () => void; busy: boolean; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceMuted, borderColor: theme.status.pickup }]} accessibilityRole="alert" testID="shift-version-conflict">
      <View style={styles.titleRow}>
        <Ionicons name="git-compare-outline" size={20} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {t("teamSchedule.manage.conflict.title")}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("teamSchedule.manage.conflict.body")}
      </Text>
      {fields.length > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="shift-version-conflict-fields">
          {t("teamSchedule.manage.conflict.changed", { fields: fields.map((field) => t(`teamSchedule.manage.field.${FIELD_KEYS[field]}`)).join(", ") })}
        </Text>
      ) : null}
      <Text
        onPress={busy ? undefined : onReload}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.action, { color: theme.primaryAction, borderColor: theme.primaryLine }]}
        testID="shift-version-conflict-reload"
      >
        {t("teamSchedule.manage.conflict.reload")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  line: { gap: 1, paddingVertical: 2 },
  date: { fontSize: 14, fontWeight: "700" },
  window: { fontSize: 13.5, lineHeight: 19 },
  action: { minHeight: 44, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: "700", textAlign: "center", overflow: "hidden" },
});
