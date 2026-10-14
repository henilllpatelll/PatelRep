import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { ShiftLifecycle } from "@/lib/housekeeping/shiftLifecycle";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  lifecycle: ShiftLifecycle;
  timeZone: string | null;
  language: string;
  t: Translate;
  onStart: () => void;
  onStartBreak: () => void;
  onEndBreak: () => void;
  onRetry: () => void;
}

/**
 * The explicit shift controls. Home never starts a shift by itself: every
 * clock-in, break and resume is a tap on a button here. Clock-out lives in the
 * end-of-shift summary. Shows nothing while a clock-out is the only thing left.
 */
export function ShiftControlCard({ lifecycle, timeZone, language, t, onStart, onStartBreak, onEndBreak, onRetry }: Props) {
  const theme = useTheme();
  const time = (iso: string | null) => (iso ? formatHotelTime(iso, timeZone, language) : null);

  if (lifecycle.state === "not_started") {
    return (
      <Card style={styles.card} testID="shift-control-not-started">
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("home.shift.notStartedTitle")}</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t("home.shift.notStartedBody")}</Text>
        <Button label={t("home.shift.start")} onPress={onStart} disabled={!lifecycle.canStart} loading={lifecycle.busy} testID="shift-start" />
      </Card>
    );
  }

  if (lifecycle.state === "ended") {
    const at = time(lifecycle.endedAt);
    return (
      <Card style={styles.card} testID="shift-control-ended">
        {at ? <Text style={[styles.body, { color: theme.textSecondary }]}>{t("home.shift.endedAt", { time: at })}</Text> : null}
        <Button
          label={t("home.shift.startNew")}
          variant="secondary"
          onPress={onStart}
          disabled={!lifecycle.canStart}
          loading={lifecycle.busy}
          testID="shift-start-new"
        />
      </Card>
    );
  }

  if (lifecycle.state === "unknown") {
    return (
      <Card style={styles.card} testID="shift-control-unknown">
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t("home.shift.unknown")}</Text>
        <Button label={t("home.shift.retry")} variant="secondary" onPress={onRetry} testID="shift-retry" />
      </Card>
    );
  }

  if (lifecycle.state === "ending") {
    return (
      <Card style={styles.card} testID="shift-control-ending">
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t("home.shift.ending")}</Text>
      </Card>
    );
  }

  if (lifecycle.state === "on_break") {
    return (
      <Card style={styles.card} testID="shift-control-break">
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("home.shift.onBreak")}</Text>
        <Button label={t("home.shift.resume")} onPress={onEndBreak} disabled={!lifecycle.canEndBreak} loading={lifecycle.busy} testID="shift-resume" />
      </Card>
    );
  }

  // active
  const since = time(lifecycle.startedAt);
  return (
    <View style={styles.activeRow} testID="shift-control-active">
      <View style={styles.activeText}>
        {since ? <Text style={[styles.body, { color: theme.textMuted }]}>{t("home.shift.activeSince", { time: since })}</Text> : null}
        {lifecycle.carriedOver ? (
          <Text style={[styles.body, { color: theme.status.pickup }]} testID="shift-carried-over">
            {t("home.shift.carriedOver")}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={onStartBreak}
        disabled={!lifecycle.canStartBreak}
        accessibilityRole="button"
        accessibilityLabel={t("home.shift.takeBreak")}
        activeOpacity={0.8}
        style={styles.breakButton}
        testID="shift-break"
      >
        <Text style={[styles.breakText, { color: lifecycle.canStartBreak ? theme.textSecondary : theme.textDisabled }]}>
          {t("home.shift.takeBreak")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  title: { fontSize: 16, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 18 },
  activeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  activeText: { flex: 1, gap: 2 },
  breakButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  breakText: { fontSize: 13, fontWeight: "600" },
});
