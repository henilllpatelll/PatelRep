import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { StatusText } from "@/components/housekeeping/roomDetail/FormBits";
import { useTheme } from "@/lib/theme/useTheme";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { shortPlace } from "@/lib/tasks/taskDisplay";
import type { SyncRow, SyncRowState } from "@/lib/tasks/offline/syncStatus";

interface Props {
  visible: boolean;
  isOnline: boolean;
  rows: SyncRow[];
  /** When the lists were last confirmed by the server; null = never on this device (never invented). */
  lastSyncedAt: string | null;
  /** The outbox is sending, or a refresh is running. */
  syncing: boolean;
  zone: string | null;
  language: string;
  onRetry: () => void;
  onReview: (taskId: string) => void;
  onClose: () => void;
}

/**
 * What this phone is still holding for the server, built from the real outbox. A row leaves only when the
 * server confirmed it (or the person reviewed and dismissed a refused one). "Retry sync" runs the same
 * single, bounded flush the app runs on reconnect — nothing is resent by hand, so nothing is duplicated.
 */
export function TaskSyncSheet({ visible, isOnline, rows, lastSyncedAt, syncing, zone, language, onRetry, onReview, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const attention = rows.filter((row) => row.state === "conflict" || row.state === "failed").length;
  const pending = rows.length - attention;
  const last = formatHotelTime(lastSyncedAt, zone, language);

  const stateColor = (state: SyncRowState) =>
    state === "conflict" || state === "failed" ? theme.status.dirty : state === "sending" ? theme.textSecondary : theme.status.pickup;

  let headline: string;
  if (attention > 0) headline = t("tasks.hk.offline.sheet.attention", { count: attention });
  else if (pending > 0) headline = t("tasks.hk.offline.sheet.pending", { count: pending });
  else if (syncing) headline = t("tasks.hk.offline.sheet.syncing");
  else headline = t("tasks.hk.offline.sheet.allSynced");

  return (
    <BottomSheet
      visible={visible}
      title={t(isOnline ? "tasks.hk.offline.sheet.titleOnline" : "tasks.hk.offline.sheet.titleOffline")}
      onClose={onClose}
      testID="task-sync-sheet"
      footer={
        <>
          <Button
            label={t("tasks.hk.offline.sheet.retry")}
            icon="sync"
            onPress={onRetry}
            loading={syncing}
            disabled={syncing || !isOnline}
            size="lg"
            testID="task-sync-retry"
          />
          <Button label={t("tasks.hk.offline.sheet.close")} onPress={onClose} variant="secondary" testID="task-sync-close" />
        </>
      }
    >
      {!isOnline ? <StatusText tone="warn" message={t("tasks.hk.offline.sheet.savedAvailable")} testID="task-sync-saved" /> : null}
      <StatusText
        message={last ? t("tasks.hk.offline.sheet.lastSynced", { time: last }) : t("tasks.hk.offline.sheet.neverSynced")}
        testID="task-sync-last"
      />
      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textPrimary }]} testID="task-sync-count">
        {headline}
      </Text>

      {rows.map((row) => {
        const task = row.entry.task;
        const place = shortPlace(task, t);
        const title = place ? `${place} · ${task.title}` : task.title;
        const kind = t("tasks.hk.offline.sheet.kindComplete");
        const state = t(`tasks.hk.offline.sheet.states.${row.state}`);
        const review = row.state === "conflict" || row.state === "failed";
        return (
          <View
            key={row.key}
            style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: review ? theme.status.dirtyLine : theme.borderSubtle }]}
            testID="task-sync-row"
          >
            <View style={styles.rowText} accessible accessibilityLabel={`${t("tasks.hk.offline.sheet.rowLabel", { task: title, kind })}. ${state}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
                {t("tasks.hk.offline.sheet.rowLabel", { task: title, kind })}
              </Text>
              {/* Words, not colour alone, carry the state. */}
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowState, { color: stateColor(row.state) }]}>
                {state}
              </Text>
            </View>
            <Pressable
              onPress={() => onReview(row.taskId)}
              accessibilityRole="button"
              accessibilityLabel={t("tasks.hk.offline.sheet.reviewA11y", { task: title })}
              style={styles.review}
              testID={`task-sync-review-${row.taskId}`}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reviewText, { color: theme.primaryAction }]}>
                {t("tasks.hk.offline.sheet.review")}
              </Text>
            </Pressable>
          </View>
        );
      })}

      <StatusText
        tone={attention > 0 ? "error" : "muted"}
        message={attention > 0 ? t("tasks.hk.offline.sheet.failedHelp") : t(isOnline ? "tasks.hk.offline.sheet.onlineHelp" : "tasks.hk.offline.sheet.offlineHelp")}
        testID="task-sync-help"
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 16, fontWeight: "800" },
  row: { minHeight: 56, borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 6, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontWeight: "700" },
  rowState: { fontSize: 12, fontWeight: "800" },
  review: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  reviewText: { fontSize: 13.5, fontWeight: "800" },
});
