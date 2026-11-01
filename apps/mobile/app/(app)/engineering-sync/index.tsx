import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { dismissClaimConflict, useClaimConflicts } from "@/lib/engineering/claimConflicts";
import { dismissReportRecord, useReportRecords } from "@/lib/engineering/pendingReports";
import { summarizePending, type PendingAction } from "@/lib/engineering/offlineActions";
import { isEngineeringRole } from "@/lib/engineering/roles";
import { usePendingActions } from "@/lib/engineering/usePendingActions";
import { loadRecentlySynced, type SyncedEntry } from "@/lib/engineering/syncedHistory";
import { listCompletionDrafts, type SavedCompletionDraftRow } from "@/lib/engineering/workOrderDrafts";
import { syncOnConnect } from "@/lib/offline/sync";
import { useSyncOverview } from "@/lib/offline/useSyncOverview";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Engineering Sync Status + Pending Actions ─────────────────────────────
   Everything here is read from the real queue and the recorded refusals. "Last sync" only moves when a sync left
   nothing waiting. A refused change keeps what was typed; discarding is a deliberate second tap and only ever
   removes an unsent change from this phone - it never reverses anything the server confirmed. */

export default function EngineeringSyncScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const ctx = useTextContext();
  const user = useAppStore((s) => s.user);
  const role = user?.effective_role ?? user?.role;
  const { overview, syncing, runSync } = useSyncOverview();
  const pending = usePendingActions();
  const claimConflicts = useClaimConflicts(user?.id ?? null);
  const reports = useReportRecords().filter((r) => r.kind === "refused");
  const [confirming, setConfirming] = useState<number | null>(null);
  const [synced, setSynced] = useState<SyncedEntry[]>([]);
  const [drafts, setDrafts] = useState<SavedCompletionDraftRow[]>([]);
  const userId = user?.id ?? null;

  // Re-read the two local lists whenever a sync run ends or the queue changes; nothing polls.
  useEffect(() => {
    let live = true;
    void Promise.all([loadRecentlySynced(), listCompletionDrafts()]).then(([recent, saved]) => {
      if (!live) return;
      setSynced(recent);
      setDrafts(saved);
    });
    return () => {
      live = false;
    };
  }, [userId, syncing, overview.lastSyncedAt, pending.actions]);

  // Opening the Sync Center is one of the moments to try: once, and only when something is actually waiting.
  const triedOnOpen = useRef(false);
  const waitingNow = pending.loaded ? summarizePending(pending.actions).waiting : 0;
  useEffect(() => {
    if (triedOnOpen.current || !pending.loaded) return;
    triedOnOpen.current = true;
    if (waitingNow > 0 && overview.online && !syncing) void syncOnConnect();
  }, [pending.loaded, waitingNow, overview.online, syncing]);

  if (!isEngineeringRole(role)) return <Redirect href="/(app)/more" />;

  const summary = summarizePending(pending.actions);
  const lastConfirmed = formatClock(overview.lastSyncedAt, ctx);
  const attention = summary.needsAttention + claimConflicts.length + reports.length;

  const kindText = (a: PendingAction) => t(`engineeringSync.kind.${a.kind}`);
  const stateText = (a: PendingAction) =>
    syncing && (a.state === "waiting" || a.state === "retrying")
      ? t("engineeringSync.stateSyncing")
      : a.state === "refused" ? t(`engineeringSync.refused.${a.reason ?? "unknown"}`, { defaultValue: t("engineeringSync.refused.unknown") }) : t(`engineeringSync.state.${a.state}`);

  return (
    <SettingsScreen title={t("engineeringSync.title")} back>
      <Card style={styles.summary}>
        <View accessible accessibilityLiveRegion="polite" style={styles.summaryRow} testID="esync-summary">
          <Ionicons name={overview.online ? "wifi-outline" : "cloud-offline-outline"} size={22} color={overview.online ? theme.status.ready : theme.status.pickup} />
          <View style={styles.flex}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]}>
              {t(overview.online ? "engineeringSync.online" : "engineeringSync.offline")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="esync-last">
              {lastConfirmed ? t("engineeringSync.lastConfirmed", { time: lastConfirmed }) : t("engineeringSync.lastUnknown")}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="esync-counts">
          {pending.loaded
            ? [t("engineeringSync.waiting", { count: summary.waiting }), t("engineeringSync.attention", { count: attention })].join(" · ")
            : t("engineeringSync.unreadable")}
        </Text>
        <Button
          label={syncing ? t("settings.sync.syncingNow") : attention > 0 ? t("settings.sync.retrySync") : t("settings.sync.syncNow")}
          icon="sync"
          onPress={() => void runSync()}
          loading={syncing}
          disabled={!overview.online || syncing}
          testID="esync-now"
        />
      </Card>

      <SettingsSection title={t("engineeringSync.pendingTitle")} testID="esync-pending">
        {pending.actions.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="esync-empty">
            {pending.loaded ? t("engineeringSync.none") : t("engineeringSync.unreadable")}
          </Text>
        ) : (
          <View style={styles.list}>
            {pending.actions.map((a) => (
              <View key={a.key} style={[styles.item, { borderColor: a.state === "refused" || a.state === "stuck" ? theme.status.dirtyLine : theme.border }]} testID={`esync-item-${a.queueId}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]}>
                  {kindText(a)}
                  {a.label ? ` · ${a.label}` : ""}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: a.state === "refused" || a.state === "stuck" ? theme.status.dirty : theme.textSecondary }]}>
                  {stateText(a)}
                </Text>
                <View style={styles.actions}>
                  {a.woId && a.state === "refused" ? (
                    <Button label={t("engineeringSync.viewOrder")} variant="secondary" size="sm" onPress={() => router.push(`/(app)/work-orders/${a.woId}` as never)} testID={`esync-view-${a.queueId}`} />
                  ) : null}
                  {a.canRetry ? <Button label={t("common.retry")} variant="secondary" size="sm" onPress={() => void pending.retry(a.queueId)} testID={`esync-retry-${a.queueId}`} /> : null}
                  {confirming === a.queueId ? (
                    <Button
                      label={t("engineeringSync.confirmDiscard")}
                      variant="destructive"
                      size="sm"
                      onPress={() => {
                        setConfirming(null);
                        void pending.discard(a.queueId);
                      }}
                      testID={`esync-discard-confirm-${a.queueId}`}
                    />
                  ) : (
                    <Button label={t("engineeringSync.discard")} variant="ghost" size="sm" onPress={() => setConfirming(a.queueId)} testID={`esync-discard-${a.queueId}`} />
                  )}
                </View>
                {confirming === a.queueId ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                    {t("engineeringSync.discardWarning")}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </SettingsSection>

      <SettingsSection title={t("engineeringSync.draftsTitle")} testID="esync-drafts">
        {drafts.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="esync-drafts-empty">
            {t("engineeringSync.draftsNone")}
          </Text>
        ) : (
          drafts.map((d, index) => (
            <SettingsRow
              key={`draft-${d.woId}`}
              first={index === 0}
              icon="document-text-outline"
              label={`${t("engineeringSync.draftItem")}${d.label ? ` · ${d.label}` : ""}`}
              subtitle={t("engineeringSync.draftHint")}
              onPress={() => router.push(`/(app)/work-orders/${d.woId}` as never)}
              trailing={t("engineeringSync.openDraft")}
              testID={`esync-draft-${d.woId}`}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={t("engineeringSync.recentTitle")} testID="esync-recent">
        {synced.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="esync-recent-empty">
            {t("engineeringSync.recentNone")}
          </Text>
        ) : (
          synced.map((e, index) => (
            <SettingsRow
              key={`synced-${e.kind}-${e.woId}`}
              first={index === 0}
              icon="checkmark-circle-outline"
              label={`${t(e.kind === "claim" ? "engineeringSync.recentClaim" : "engineeringSync.recentComplete")}${e.label ? ` · ${e.label}` : ""}`}
              subtitle={formatClock(e.at, ctx) ?? undefined}
              onPress={() => router.push(`/(app)/work-orders/${e.woId}` as never)}
              testID={`esync-synced-${e.kind}-${e.woId}`}
            />
          ))
        )}
      </SettingsSection>

      {claimConflicts.length + reports.length > 0 ? (
        <SettingsSection title={t("engineeringSync.refusedTitle")} testID="esync-refused">
          {claimConflicts.map((c, index) => (
            <SettingsRow
              key={`claim-${c.woId}`}
              first={index === 0}
              icon="hand-right-outline"
              label={c.label ?? t("engineeringSync.kind.claim")}
              subtitle={t(`workQueue.claim${c.reason === "conflict" ? "Conflict" : c.reason === "forbidden" ? "Forbidden" : "Gone"}`)}
              onPress={() => router.push(`/(app)/work-orders/${c.woId}` as never)}
              trailing={t("engineeringSync.dismiss")}
              testID={`esync-claim-${c.woId}`}
            />
          ))}
          {reports.map((r, index) => (
            <SettingsRow
              key={`report-${r.requestId}`}
              first={claimConflicts.length === 0 && index === 0}
              icon="alert-circle-outline"
              label={r.title || t("engineeringSync.kind.report")}
              subtitle={r.message ?? t("engineeringSync.refused.unknown")}
              onPress={() => void dismissReportRecord(r.requestId)}
              trailing={t("engineeringSync.dismiss")}
              testID={`esync-report-${r.requestId}`}
            />
          ))}
        </SettingsSection>
      ) : null}
      {claimConflicts.length > 0 ? (
        <Button label={t("engineeringSync.dismissClaims")} variant="ghost" size="sm" onPress={() => claimConflicts.forEach((c) => void dismissClaimConflict(c.woId))} testID="esync-dismiss-claims" />
      ) : null}

      <SettingsRow icon="documents-outline" label={t("engineeringSync.fullDetails")} onPress={() => router.push("/(app)/profile/sync" as never)} first testID="esync-full" />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summary: { padding: 16, gap: 12 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  strong: { fontSize: 15.5, fontWeight: "800" },
  meta: { fontSize: 13, lineHeight: 18 },
  empty: { fontSize: 14, padding: 16 },
  list: { gap: 10, padding: 10 },
  item: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
});
