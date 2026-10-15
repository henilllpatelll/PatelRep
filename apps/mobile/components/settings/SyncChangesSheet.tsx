import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SheetNotice } from "@/components/home/sheetParts";
import { Button } from "@/components/ui/Button";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";
import type { SyncRunResult } from "@/lib/housekeeping/syncRunner";
import { type CategoryKey, type OverviewCategory } from "@/lib/offline/syncOverview";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.4;

interface Props {
  visible: boolean;
  /** Show only this category, or everything when null. */
  category: CategoryKey | null;
  categories: OverviewCategory[];
  online: boolean;
  syncing: boolean;
  lastRun: SyncRunResult | null;
  onRetry: () => void;
  onOpenRoom: (roomId: string) => void;
  onOpenTasks: () => void;
  onClose: () => void;
}

/**
 * "Unsynced Changes": the real saved-but-unconfirmed work, one row per change (kind, room, when it was
 * saved here, state). It never shows what was typed, cannot delete or edit anything, and a change the
 * server refused is fixed where the work happens, not replayed from here.
 */
export function SyncChangesSheet({ visible, category, categories, online, syncing, lastRun, onRetry, onOpenRoom, onOpenTasks, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const shown = categories.filter((c) => c.rows.length > 0 && (category === null || c.key === category));
  const retryable = shown.some((c) => c.rows.some((r) => r.state !== "conflict"));

  return (
    <BottomSheet
      visible={visible}
      title={t("settings.sync.drawer.title")}
      onClose={onClose}
      grabber
      testID="sync-changes-sheet"
      footer={
        <>
          {retryable && online ? (
            <Button
              label={t(syncing ? "settings.sync.syncingNow" : "settings.sync.retrySync")}
              icon="sync"
              onPress={onRetry}
              loading={syncing}
              testID="sync-changes-retry"
            />
          ) : null}
          <Button label={t("common.close")} variant="secondary" onPress={onClose} testID="sync-changes-close" />
        </>
      }
    >
      {lastRun ? <RunNotice run={lastRun} /> : null}
      {shown.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="sync-changes-empty">
          {t("settings.sync.drawer.empty")}
        </Text>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
            {t("settings.sync.drawer.intro")}
          </Text>
          {shown.map((c) => (
            <View key={c.key} style={styles.group} testID={`sync-changes-${c.key}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>
                {t(`settings.sync.categories.${c.key}`)}
              </Text>
              {c.rows.map((row) => (
                <ChangeRow key={row.key} row={row} onOpenRoom={onOpenRoom} onOpenTasks={onOpenTasks} />
              ))}
            </View>
          ))}
        </>
      )}
    </BottomSheet>
  );
}

function RunNotice({ run }: { run: SyncRunResult }) {
  const { t } = useTranslation();
  if (!run.ran) return <SheetNotice tone="error" text={t(`home.syncSheet.run.${run.reason}`)} testID="sync-changes-run" />;
  if (run.conflicts > 0) return <SheetNotice tone="error" text={t("home.syncSheet.run.conflicts", { count: run.conflicts })} testID="sync-changes-run" />;
  if (run.failed > 0) return <SheetNotice tone="error" text={t("home.syncSheet.run.itemsFailed", { count: run.failed })} testID="sync-changes-run" />;
  if (run.remaining > 0 || !run.verified) return <SheetNotice tone="warn" text={t("home.syncSheet.run.partial", { count: run.remaining })} testID="sync-changes-run" />;
  return <SheetNotice text={t("home.syncSheet.run.done")} testID="sync-changes-run" />;
}

function reasonText(code: string, state: string, t: (key: string) => string): string {
  const key = `home.syncSheet.reasons.${code}`;
  const text = t(key);
  if (text !== key) return text;
  return t(state === "retrying" ? "home.syncSheet.reasons.retrying" : "home.syncSheet.reasons.generic");
}

function ChangeRow({ row, onOpenRoom, onOpenTasks }: { row: SyncRow; onOpenRoom: (roomId: string) => void; onOpenTasks: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ctx = useTextContext();
  const roomNumber = useAppStore((s) => (row.roomId ? (s.myRooms.find((r) => r.id === row.roomId)?.room_number ?? null) : null));
  const count = row.count ?? 1;
  const kind = t(`rooms.work.sync.kinds.${row.kind}`, { count });
  const label = roomNumber ? t("rooms.work.sync.rowWithRoom", { room: roomNumber, kind }) : kind;
  const state = t(`home.syncSheet.rowStates.${row.state}`);
  const saved = formatClock(row.savedAt, ctx);
  const needsPerson = row.state === "failed" || row.state === "conflict";
  const reason = row.reason && (needsPerson || row.state === "retrying") ? reasonText(row.reason, row.state, t) : needsPerson ? t("home.syncSheet.reasons.generic") : null;
  const stateColor = needsPerson ? theme.status.dirty : row.state === "pending" ? theme.textSecondary : theme.status.pickup;
  const action = needsPerson ? (row.kind === "task" ? "tasks" : row.roomId ? "room" : null) : null;

  return (
    <View
      accessible
      accessibilityLabel={[label, state, saved ? t("home.syncSheet.savedAt", { time: saved }) : null, reason].filter(Boolean).join(". ")}
      style={[styles.row, { backgroundColor: theme.surfaceMuted, borderColor: needsPerson ? theme.status.dirty : theme.borderSubtle }]}
      testID="sync-changes-row"
    >
      <View style={styles.rowTop}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
          {label}
        </Text>
        {/* Words, not colour alone, carry the state. */}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowState, { color: stateColor }]}>
          {state}
        </Text>
      </View>
      {saved ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMeta, { color: theme.textMuted }]}>
          {t("home.syncSheet.savedAt", { time: saved })}
        </Text>
      ) : null}
      {reason ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMeta, { color: theme.textSecondary }]}>
          {reason}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={t(action === "room" ? "home.syncSheet.openRoom" : "home.syncSheet.openTasks")}
          onPress={() => (action === "room" && row.roomId ? onOpenRoom(row.roomId) : onOpenTasks())}
          variant="secondary"
          size="sm"
          testID="sync-changes-row-action"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 14, lineHeight: 20 },
  intro: { fontSize: 14, lineHeight: 20 },
  group: { gap: 8 },
  groupTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  row: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
  rowState: { fontSize: 12, fontWeight: "800" },
  rowMeta: { fontSize: 12, lineHeight: 17 },
});
