import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import { syncOnConnect } from "@/lib/offline/sync";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { loadSyncRows, type LoadedSyncRows, type SyncState } from "@/lib/housekeeping/syncDetails";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";
import { StatusText } from "./FormBits";

interface Props {
  visible: boolean;
  isOnline: boolean;
  ctx: TextContext;
  onClose: () => void;
}

/**
 * What this phone is still holding for the server. Rows come straight from the real
 * queues; an item disappears only when its queue drops it after the server confirmed.
 * "Retry sync" runs the same single, in-order flush the app runs on reconnect — it
 * never resends anything by hand, so a non-idempotent write is not duplicated.
 */
export function SyncDetailsSheet({ visible, isOnline, ctx, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rooms = useAppStore((state) => state.myRooms);
  const lastSyncedAt = useAppStore((state) => state.lastSyncedAt);
  // Re-read when any queue changes while the sheet is open.
  const sessions = useCleanSessionStore((state) => state.sessions);
  const actions = useAppStore((state) => state.pendingActions);
  const [loaded, setLoaded] = useState<LoadedSyncRows | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => setLoaded(await loadSyncRows()), []);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh, sessions, actions, lastSyncedAt]);

  async function retry() {
    if (syncing || !isOnline) return;
    setSyncing(true);
    try {
      await syncOnConnect();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  const roomNumber = (roomId: string | null) => (roomId ? rooms.find((room) => room.id === roomId)?.room_number ?? null : null);
  const rows = loaded?.rows ?? null;
  const total = (rows ?? []).reduce((sum, row) => sum + (row.count ?? 1), 0);
  const last = formatClock(lastSyncedAt, ctx);
  const hasFailed = (rows ?? []).some((row) => row.state === "failed" || row.state === "conflict");

  const stateColor = (state: SyncState) =>
    state === "failed" || state === "conflict" ? theme.status.dirty : state === "retrying" ? theme.status.pickup : theme.textSecondary;

  return (
    <BottomSheet
      visible={visible}
      title={t(isOnline ? "rooms.work.sync.titleOnline" : "rooms.work.sync.titleOffline")}
      onClose={onClose}
      testID="sync-sheet"
      footer={
        <Button
          label={t("rooms.work.sync.retry")}
          icon="sync"
          onPress={() => void retry()}
          loading={syncing}
          disabled={syncing || !isOnline || (total === 0 && Boolean(loaded?.complete))}
          size="lg"
          testID="sync-retry"
        />
      }
    >
      <StatusText message={last ? t("rooms.work.sync.lastSync", { time: last }) : t("rooms.work.sync.neverSynced")} testID="sync-last" />
      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textPrimary }]} testID="sync-count">
        {t("rooms.work.sync.pending", { count: total })}
      </Text>
      {!isOnline ? <StatusText tone="warn" message={t("rooms.work.sync.offlineHelp")} /> : null}

      {loaded && !loaded.complete ? <StatusText tone="warn" message={t("rooms.work.sync.unreadable")} testID="sync-unreadable" /> : null}
      {rows === null ? null : rows.length === 0 ? (
        loaded?.complete ? <StatusText tone="ok" message={t("rooms.work.sync.allSaved")} testID="sync-empty" /> : null
      ) : (
        rows.map((row) => {
          const room = roomNumber(row.roomId);
          const kind = t(`rooms.work.sync.kinds.${row.kind}`, { count: row.count ?? 1 });
          const label = room ? t("rooms.work.sync.rowWithRoom", { room, kind }) : kind;
          const state = t(`rooms.work.sync.states.${row.state}`);
          return (
            <View
              key={row.key}
              accessible
              accessibilityLabel={`${label}. ${state}`}
              style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
              testID="sync-row"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
                {label}
              </Text>
              {/* Words, not colour alone, carry the state. */}
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowState, { color: stateColor(row.state) }]}>
                {state}
              </Text>
            </View>
          );
        })
      )}

      {hasFailed ? <StatusText tone="error" message={t("rooms.work.sync.failedHelp")} testID="sync-failed-help" /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 16, fontWeight: "800" },
  row: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
  rowState: { fontSize: 12, fontWeight: "800" },
});
