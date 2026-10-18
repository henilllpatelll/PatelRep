import { StyleSheet, Text, View } from "react-native";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { InspectQueueCard, type InspectionOutcome } from "@/components/supervisor/inspect/InspectQueueCard";
import type { ReadyRoom } from "@/lib/api/inspections";
import type { InspectionTarget } from "@/lib/housekeeping/inspectionTarget";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* The block above the queue when the Room Board opened Inspect for one room. It only ever shows that room's
   controls (they still need an explicit tap and a confirm), or says plainly why it cannot. */
export function InspectFocus({
  target,
  roomLabel,
  queueFailed,
  timeSince,
  onOutcome,
  onShowQueue,
  onBack,
  onRetry,
  t,
}: {
  target: InspectionTarget;
  /** Display label from the link (the number); never used to pick the room. */
  roomLabel: string | null;
  queueFailed: boolean;
  timeSince: (iso: string | null) => string;
  onOutcome: (room: ReadyRoom, result: InspectionOutcome) => void;
  onShowQueue: () => void;
  onBack: () => void;
  onRetry: () => void;
  t: Translate;
}) {
  const theme = useTheme();
  if (target.kind === "none") return null;
  if (target.kind === "ready") {
    return (
      <View style={styles.wrap} testID="inspect-focus">
        <Text style={[styles.heading, { color: theme.textMuted }]} accessibilityRole="header">
          {t("inspect.focus.heading", { room: target.room.room_number })}
        </Text>
        <InspectQueueCard room={target.room} timeSince={timeSince} onOutcome={onOutcome} t={t} focused />
        <Button label={t("inspect.focus.showQueue")} variant="ghost" size="sm" onPress={onShowQueue} testID="inspect-focus-queue" />
      </View>
    );
  }
  if (target.kind === "waiting" && !queueFailed) return null;
  const message =
    target.kind === "not_awaiting"
      ? roomLabel
        ? t("inspect.focus.notAwaiting", { room: roomLabel })
        : t("inspect.focus.notAwaitingGeneric")
      : target.kind === "invalid"
        ? t("inspect.focus.invalid")
        : t("inspect.focus.unavailable");
  return (
    <View style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="inspect-focus-notice">
      <Text style={[styles.message, { color: theme.textPrimary }]}>{message}</Text>
      <View style={styles.row}>
        <Button label={t("inspect.focus.backToBoard")} variant="secondary" size="sm" onPress={onBack} style={styles.flex} testID="inspect-focus-back" />
        <Button label={t("inspect.focus.showQueue")} variant="secondary" size="sm" onPress={onShowQueue} style={styles.flex} testID="inspect-focus-queue" />
      </View>
      {target.kind === "waiting" ? <Button label={t("roomBoard.panel.retry")} size="sm" onPress={onRetry} testID="inspect-focus-retry" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 6 },
  heading: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  notice: { borderWidth: 1, borderRadius: R.lg, padding: 13, gap: 10, marginBottom: 6 },
  message: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
});
