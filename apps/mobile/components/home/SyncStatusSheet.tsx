import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice, SheetSection } from "@/components/home/sheetParts";
import { formatClock, type TextContext, type Translate } from "@/lib/housekeeping/myRoomsText";
import type { SyncRunResult } from "@/lib/housekeeping/syncRunner";
import type { SyncStatusRow, SyncStatusView, SyncViewStatus } from "@/lib/housekeeping/syncStatus";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  view: SyncStatusView;
  syncing: boolean;
  /** What the retry that just finished found. */
  lastRun: SyncRunResult | null;
  t: Translate;
  ctx: TextContext;
  onRetry: () => void;
  onOpenRoom: (roomId: string) => void;
  onOpenTasks: () => void;
  onClose: () => void;
}

type Tone = "ok" | "warn" | "alert" | "muted";
const STATUS_ICON: Record<SyncViewStatus, { icon: keyof typeof Ionicons.glyphMap; tone: Tone }> = {
  synced: { icon: "checkmark-circle-outline", tone: "ok" },
  pending: { icon: "cloud-upload-outline", tone: "warn" },
  syncing: { icon: "sync-outline", tone: "warn" },
  offline_cached: { icon: "cloud-offline-outline", tone: "warn" },
  offline: { icon: "cloud-offline-outline", tone: "warn" },
  stale: { icon: "time-outline", tone: "warn" },
  unknown: { icon: "time-outline", tone: "muted" },
  failed: { icon: "alert-circle-outline", tone: "alert" },
  conflict: { icon: "alert-circle-outline", tone: "alert" },
};

/**
 * What this phone is holding for the server, in plain words. One status says
 * where things stand; each waiting change names its room, what it is, when it
 * was saved here and whether the server has it. Nothing is called done until
 * the server has confirmed it. Retry runs the app's own single, ordered flush;
 * a change the server refused is fixed in its room, never replayed from here.
 */
export function SyncStatusSheet({ visible, view, syncing, lastRun, t, ctx, onRetry, onOpenRoom, onOpenTasks, onClose }: Props) {
  const theme = useTheme();
  const { icon, tone } = STATUS_ICON[view.status];
  const toneColor: Record<Tone, string> = { ok: theme.status.ready, warn: theme.status.pickup, alert: theme.status.dirty, muted: theme.textMuted };
  const lastSynced = formatClock(view.lastSyncedAt, ctx);
  const waiting = view.rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <BottomSheet
      visible={visible}
      title={t("home.syncSheet.title")}
      onClose={onClose}
      grabber
      testID="sync-status-sheet"
      footer={
        <>
          <Button
            label={t(syncing ? "home.syncSheet.retrying" : "home.syncSheet.retry")}
            icon="sync"
            onPress={onRetry}
            size="lg"
            loading={syncing}
            disabled={!view.canRetry}
            testID="sync-status-retry"
          />
          {view.retryBlock && !syncing ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="sync-status-retry-hint">
              {t(`home.syncSheet.retryBlock.${view.retryBlock}`)}
            </Text>
          ) : null}
        </>
      }
    >
      <View style={styles.statusRow} accessible accessibilityRole="header" testID="sync-status-headline">
        <Ionicons name={icon} size={26} color={toneColor[tone]} />
        <View style={styles.statusText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusTitle, { color: theme.textPrimary }]}>
            {t(`home.syncSheet.status.${view.status}.title`)}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusBody, { color: theme.textSecondary }]}>
            {t(`home.syncSheet.status.${view.status}.body`)}
          </Text>
        </View>
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="sync-status-last">
        {lastSynced ? t("home.syncSheet.lastSync", { time: lastSynced }) : t("home.syncSheet.neverSynced")}
      </Text>

      {lastRun ? <RunResult run={lastRun} t={t} /> : null}
      {view.unreadable ? <SheetNotice tone="warn" text={t("home.syncSheet.unreadable")} testID="sync-status-unreadable" /> : null}

      {view.rows.length > 0 ? (
        <SheetSection
          title={t("home.syncSheet.waiting", { count: waiting })}
          hint={t("home.syncSheet.waitingHint")}
        >
          {view.rows.map((row) => (
            <ChangeRow key={row.key} row={row} t={t} ctx={ctx} onOpenRoom={onOpenRoom} onOpenTasks={onOpenTasks} />
          ))}
        </SheetSection>
      ) : view.status === "synced" || view.status === "stale" || view.status === "unknown" ? (
        <SheetNotice text={t("home.syncSheet.nothingWaiting")} testID="sync-status-empty" />
      ) : null}

      {/* AI help is online-only and is never queued, so it can neither be waiting to send nor replayed on reconnect. */}
      <SheetSection title={t("home.syncSheet.ai.title")}>
        <View style={styles.statusRow} accessible accessibilityLabel={`${t(`home.syncSheet.ai.${view.online ? "online" : "offline"}.title`)}. ${t(`home.syncSheet.ai.${view.online ? "online" : "offline"}.body`)}`} testID="sync-status-ai">
          <Ionicons name={view.online ? "sparkles-outline" : "cloud-offline-outline"} size={22} color={view.online ? theme.status.ready : theme.status.pickup} />
          <View style={styles.statusText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]} testID="sync-status-ai-title">
              {t(`home.syncSheet.ai.${view.online ? "online" : "offline"}.title`)}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusBody, { color: theme.textSecondary }]}>
              {t(`home.syncSheet.ai.${view.online ? "online" : "offline"}.body`)}
            </Text>
          </View>
        </View>
      </SheetSection>
    </BottomSheet>
  );
}

function RunResult({ run, t }: { run: SyncRunResult; t: Translate }) {
  if (!run.ran) {
    return <SheetNotice tone="error" text={t(`home.syncSheet.run.${run.reason}`)} testID="sync-status-run" />;
  }
  if (run.conflicts > 0) return <SheetNotice tone="error" text={t("home.syncSheet.run.conflicts", { count: run.conflicts })} testID="sync-status-run" />;
  if (run.failed > 0) return <SheetNotice tone="error" text={t("home.syncSheet.run.itemsFailed", { count: run.failed })} testID="sync-status-run" />;
  if (run.remaining > 0 || !run.verified) {
    return <SheetNotice tone="warn" text={t("home.syncSheet.run.partial", { count: run.remaining })} testID="sync-status-run" />;
  }
  return <SheetNotice text={t("home.syncSheet.run.done")} testID="sync-status-run" />;
}

function ChangeRow({
  row,
  t,
  ctx,
  onOpenRoom,
  onOpenTasks,
}: {
  row: SyncStatusRow;
  t: Translate;
  ctx: TextContext;
  onOpenRoom: (roomId: string) => void;
  onOpenTasks: () => void;
}) {
  const theme = useTheme();
  const kind = t(`rooms.work.sync.kinds.${row.kind}`, { count: row.count });
  const label = row.roomNumber ? t("rooms.work.sync.rowWithRoom", { room: row.roomNumber, kind }) : kind;
  const state = t(`home.syncSheet.rowStates.${row.state}`);
  const saved = formatClock(row.savedAt, ctx);
  const reason = row.reason && (row.state === "conflict" || row.state === "failed" || row.state === "retrying") ? reasonText(row.reason, row.state, t) : null;
  const stateColor = row.state === "failed" || row.state === "conflict" ? theme.status.dirty : row.state === "pending" ? theme.textSecondary : theme.status.pickup;

  return (
    <View
      accessible
      accessibilityLabel={[label, state, saved ? t("home.syncSheet.savedAt", { time: saved }) : null, reason].filter(Boolean).join(". ")}
      style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
      testID="sync-status-row"
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
      {row.action ? (
        <Button
          label={t(row.action.type === "room" ? "home.syncSheet.openRoom" : "home.syncSheet.openTasks")}
          onPress={() => (row.action?.type === "room" ? onOpenRoom(row.action.roomId) : onOpenTasks())}
          variant="secondary"
          size="sm"
          testID="sync-status-row-action"
        />
      ) : null}
    </View>
  );
}

/** A known code gets its own sentence; anything else gets a plain one for its state. Never the raw code or payload. */
function reasonText(code: string, state: string, t: Translate): string {
  const key = `home.syncSheet.reasons.${code}`;
  const text = t(key);
  if (text !== key) return text;
  return t(state === "retrying" ? "home.syncSheet.reasons.retrying" : "home.syncSheet.reasons.generic");
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  statusText: { flex: 1, minWidth: 0, gap: 2 },
  statusTitle: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  statusBody: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  row: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
  rowState: { fontSize: 12, fontWeight: "800" },
  rowMeta: { fontSize: 12, lineHeight: 17 },
});
