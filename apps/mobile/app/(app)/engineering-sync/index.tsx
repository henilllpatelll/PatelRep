import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SheetNotice } from "@/components/home/sheetParts";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { DiscardChangeSheet, type ConfirmMode } from "@/components/engineering/sync/DiscardChangeSheet";
import { SyncIssueRow } from "@/components/engineering/sync/SyncIssueRow";
import { SyncIssueSheet, issueTitle } from "@/components/engineering/sync/SyncIssueSheet";
import { PmSyncSection } from "@/components/engineering/pm/PmSyncSection";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { dismissClaimConflict, useClaimConflicts } from "@/lib/engineering/claimConflicts";
import { dismissReportRecord, useReportRecords } from "@/lib/engineering/pendingReports";
import type { PendingAction } from "@/lib/engineering/offlineActions";
import { isEngineeringRole } from "@/lib/engineering/roles";
import { usePendingActions } from "@/lib/engineering/usePendingActions";
import { usePmSyncItems } from "@/lib/engineering/usePmSyncItems";
import { buildPmQueuedItems } from "@/lib/engineering/pmSyncItems";
import { buildMoreSyncStatus, buildSyncIssues, isPmIssue, resolvePrimaryAction, shownCount, summarizeRun, type SyncIssue } from "@/lib/engineering/syncStatusModel";
import { useEngineeringSyncSummaryFrom } from "@/lib/engineering/useEngineeringSyncSummary";
import { loadRecentlySynced, type SyncedEntry } from "@/lib/engineering/syncedHistory";
import { listCompletionDrafts, type SavedCompletionDraftRow } from "@/lib/engineering/workOrderDrafts";
import { syncOnConnect } from "@/lib/offline/sync";
import { useSyncOverview } from "@/lib/offline/useSyncOverview";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Engineering Sync Center ────────────────────────────────────────────────
   Everything here is read from the real queues and the recorded refusals; nothing is invented. Order is by what the
   person has to do: needs attention, waiting, saved drafts, then what the server already confirmed. "Last sync" only
   moves when a sync left nothing waiting. A refused change keeps what was typed; discarding is confirmed in a sheet
   and only ever removes an unsent change from this phone - it never reverses anything the server confirmed. */

interface Confirm {
  mode: ConfirmMode;
  subject: string | null;
  body?: string;
  all?: boolean;
  run: () => Promise<void>;
}

export default function EngineeringSyncScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const ctx = useTextContext();
  const user = useAppStore((s) => s.user);
  const role = user?.effective_role ?? user?.role;
  const { overview, syncing, runSync, lastRun } = useSyncOverview();
  const pending = usePendingActions();
  const pm = usePmSyncItems();
  const claimConflicts = useClaimConflicts(user?.id ?? null);
  const reports = useReportRecords();
  const summary = useEngineeringSyncSummaryFrom(pm, pending);
  const [synced, setSynced] = useState<SyncedEntry[]>([]);
  const [drafts, setDrafts] = useState<SavedCompletionDraftRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
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

  const pmItems = useMemo(() => buildPmQueuedItems(pm.rows, pm.active, t("pm.inspection")), [pm.rows, pm.active, t]);
  const issues = useMemo(() => buildSyncIssues({ actions: pending.actions, claimConflicts, reports, pmItems }), [pending.actions, claimConflicts, reports, pmItems]);
  const openIssue: SyncIssue | null = issues.find((i) => i.id === openId) ?? null;

  // Opening the Sync Center is one of the moments to try: once, and only when something is actually waiting.
  const triedOnOpen = useRef(false);
  useEffect(() => {
    if (triedOnOpen.current || !pending.loaded || !pm.loaded) return;
    triedOnOpen.current = true;
    if (summary.waiting > 0 && overview.online && !syncing) void syncOnConnect();
  }, [pending.loaded, pm.loaded, summary.waiting, overview.online, syncing]);

  if (!isEngineeringRole(role)) return <Redirect href="/(app)/more" />;

  const status = buildMoreSyncStatus({ online: overview.online, sending: syncing || summary.sending, counts: summary });
  const lastConfirmed = formatClock(overview.lastSyncedAt, ctx);
  const primary = resolvePrimaryAction({ online: overview.online, syncing: syncing || summary.sending, attention: summary.attention });
  const primaryLabel = { connect: t("engineeringSync.primaryConnect"), syncing: t("settings.sync.syncingNow"), retry: t("engineeringSync.primaryRetry"), sync: t("settings.sync.syncNow") }[primary];
  const statusText = t(`engineeringMore.syncState.${status.textKey}`, { count: status.count, shown: status.shown });
  const run = lastRun ? summarizeRun(lastRun) : null;
  const waitingActions = pending.actions.filter((a) => a.state === "waiting" || a.state === "retrying");
  const waitingPm = pmItems.filter((i) => !isPmIssue(i.state));
  const claimIssues = issues.filter((i) => i.source === "claim");

  // Guards a double tap: the second press while a change is being removed or retried does nothing.
  async function guarded(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }
  const viewOrder = (woId: string) => {
    setOpenId(null);
    router.push(`/(app)/work-orders/${woId}` as never);
  };
  const askDiscard = (c: Confirm) => {
    setOpenId(null);
    setConfirm(c);
  };
  const discardAction = (a: PendingAction) =>
    askDiscard({ mode: "discard", subject: `${t(`engineeringSync.kind.${a.kind}`)}${a.label ? ` · ${a.label}` : ""}`, run: () => pending.discard(a.queueId) });

  function requestDiscard(issue: SyncIssue) {
    if (issue.source === "action") {
      askDiscard({ mode: "discard", subject: issueTitle(issue, t), run: () => pending.discard(issue.queueId) });
    } else if (issue.source === "pm") {
      askDiscard({ mode: "discard", subject: issue.label, body: t("engineeringSync.discardSheet.bodyPm"), run: () => pm.discard(issue.rowId) });
    }
  }
  function requestDismiss(issue: SyncIssue) {
    if (issue.source === "claim") askDiscard({ mode: "dismiss", subject: issueTitle(issue, t), run: () => dismissClaimConflict(issue.woId) });
    else if (issue.source === "report") askDiscard({ mode: "dismiss", subject: issueTitle(issue, t), run: () => dismissReportRecord(issue.requestId) });
  }
  const dismissAllClaims = () =>
    askDiscard({
      mode: "dismiss",
      all: true,
      subject: null,
      run: async () => {
        for (const c of claimConflicts) await dismissClaimConflict(c.woId);
      },
    });

  return (
    <SettingsScreen title={t("engineeringSync.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]} testID="esync-subtitle">
        {t("engineeringSync.subtitle")}
      </Text>

      <Card style={styles.summary}>
        <View accessible accessibilityLiveRegion="polite" style={styles.summaryRow} testID="esync-summary">
          <Ionicons name={overview.online ? "wifi-outline" : "cloud-offline-outline"} size={22} color={overview.online ? theme.status.ready : theme.status.pickup} />
          <View style={styles.flex}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]} testID="esync-connection">
              {t(overview.online ? "engineeringSync.online" : "engineeringSync.offline")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]} testID="esync-status">
              {statusText}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="esync-last">
              {lastConfirmed ? t("engineeringSync.lastConfirmed", { time: lastConfirmed }) : t("engineeringSync.lastUnknown")}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="esync-counts">
          {summary.verified
            ? [t("engineeringSync.summaryWaiting", { count: summary.waiting, shown: shownCount(summary.waiting) }), t("engineeringSync.summaryAttention", { count: summary.attention, shown: shownCount(summary.attention) })].join(" · ")
            : t("engineeringSync.unreadable")}
        </Text>
        <Button label={primaryLabel} icon="sync" onPress={() => void runSync()} loading={primary === "syncing"} disabled={primary === "syncing"} testID="esync-now" />
        {run ? (
          <View accessibilityLiveRegion="polite" testID="esync-run">
            <SheetNotice
              tone={run.kind === "done" ? "info" : run.kind === "partial" || run.kind === "offline" ? "warn" : "error"}
              text={
                run.kind === "conflicts"
                  ? t("home.syncSheet.run.conflicts", { count: run.count })
                  : run.kind === "failed_items"
                    ? t("home.syncSheet.run.itemsFailed", { count: run.count })
                    : run.kind === "partial"
                      ? t("home.syncSheet.run.partial", { count: run.count })
                      : t(`home.syncSheet.run.${run.kind}`)
              }
            />
          </View>
        ) : null}
      </Card>

      {issues.length > 0 ? (
        <SettingsSection title={t("engineeringSync.attentionTitle")} testID="esync-attention">
          <View style={styles.list}>
            {issues.map((issue) => (
              <SyncIssueRow key={issue.id} issue={issue} onOpen={(i) => setOpenId(i.id)} />
            ))}
          </View>
          {claimIssues.length > 1 ? <Button label={t("engineeringSync.dismissAllClaims")} variant="ghost" size="sm" onPress={dismissAllClaims} testID="esync-dismiss-claims" /> : null}
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("engineeringSync.waitingTitle")} testID="esync-pending">
        {waitingActions.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="esync-empty">
            {pending.loaded ? t("engineeringSync.none") : t("engineeringSync.unreadable")}
          </Text>
        ) : (
          <View style={styles.list}>
            {waitingActions.map((a) => (
              <View key={a.key} style={[styles.item, { borderColor: theme.border }]} testID={`esync-item-${a.queueId}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]}>
                  {t(`engineeringSync.kind.${a.kind}`)}
                  {a.label ? ` · ${a.label}` : ""}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                  {syncing ? t("engineeringSync.stateSyncing") : t(`engineeringSync.state.${a.state}`)}
                </Text>
                <View style={styles.actions}>
                  <Button label={t("engineeringSync.discard")} variant="ghost" size="sm" onPress={() => discardAction(a)} testID={`esync-discard-${a.queueId}`} />
                </View>
              </View>
            ))}
          </View>
        )}
      </SettingsSection>

      <PmSyncSection
        part="queue"
        items={waitingPm}
        drafts={pm.drafts}
        loaded={pm.loaded}
        onRetry={(rowId) => void guarded(() => pm.retry(rowId))}
        onSubmitAnyway={(rowId) => void guarded(() => pm.submitDespiteConflict(rowId))}
        onDiscard={(rowId, label) => askDiscard({ mode: "discard", subject: label, body: t("engineeringSync.discardSheet.bodyPm"), run: () => pm.discard(rowId) })}
      />

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
      <PmSyncSection part="drafts" items={[]} drafts={pm.drafts} loaded={pm.loaded} onRetry={() => undefined} onSubmitAnyway={() => undefined} onDiscard={() => undefined} />

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

      <SettingsRow icon="documents-outline" label={t("engineeringSync.fullDetails")} subtitle={t("engineeringSync.fullDetailsHint")} onPress={() => router.push("/(app)/profile/sync" as never)} first testID="esync-full" />

      <SyncIssueSheet
        issue={openIssue}
        onClose={() => setOpenId(null)}
        onViewOrder={viewOrder}
        onOpenInspection={(scheduleId) => {
          setOpenId(null);
          router.push(`/(app)/pm-schedules/inspect/${scheduleId}` as never);
        }}
        onRetryAction={(queueId) => void guarded(() => pending.retry(queueId))}
        onRetryPm={(rowId) => void guarded(() => pm.retry(rowId))}
        onSubmitAnyway={(rowId) => void guarded(() => pm.submitDespiteConflict(rowId))}
        onDiscard={requestDiscard}
        onDismiss={requestDismiss}
      />
      <DiscardChangeSheet
        visible={confirm !== null}
        mode={confirm?.mode ?? "discard"}
        subject={confirm?.subject ?? null}
        body={confirm?.body}
        all={confirm?.all}
        busy={busy}
        onKeep={() => setConfirm(null)}
        onConfirm={() => {
          const current = confirm;
          if (!current) return;
          void guarded(async () => {
            await current.run();
            setConfirm(null);
          });
        }}
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  summary: { padding: 16, gap: 12 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  strong: { fontSize: 15.5, fontWeight: "800" },
  meta: { fontSize: 13, lineHeight: 18 },
  empty: { fontSize: 14, padding: 16 },
  list: { gap: 10, padding: 10 },
  item: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
});
