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
  onStartBreak: () => void;
  onRetry: () => void;
  /** Opens the Finish Shift review. Clocking out happens only inside it. */
  onFinish: () => void;
}

/**
 * The in-shift row: since when, and the explicit "take a break" tap. Start,
 * resume and the clocked-out summary have their own state cards (HomeStateCards);
 * Home never starts a shift by itself. Clock-out lives in the Finish Shift review.
 */
export function ShiftControlCard({ lifecycle, timeZone, language, t, onStartBreak, onRetry, onFinish }: Props) {
  const theme = useTheme();
  const time = (iso: string | null) => (iso ? formatHotelTime(iso, timeZone, language) : null);

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
        onPress={onFinish}
        disabled={!lifecycle.canEnd}
        accessibilityRole="button"
        accessibilityLabel={t("home.shift.finish")}
        activeOpacity={0.8}
        style={styles.breakButton}
        testID="shift-finish"
      >
        <Text style={[styles.breakText, { color: lifecycle.canEnd ? theme.textSecondary : theme.textDisabled }]}>
          {t("home.shift.finish")}
        </Text>
      </TouchableOpacity>
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
  activeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 12 },
  activeText: { flexGrow: 1, flexShrink: 1, flexBasis: 160, gap: 2 },
  breakButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  breakText: { fontSize: 13, fontWeight: "600" },
});
