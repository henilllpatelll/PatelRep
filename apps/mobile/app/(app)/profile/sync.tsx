import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SyncChangesSheet } from "@/components/settings/SyncChangesSheet";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { useSyncOverview } from "@/lib/offline/useSyncOverview";
import type { CategoryKey, OverviewCategory, OverviewStatus } from "@/lib/offline/syncOverview";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Tone = "ok" | "info" | "warn" | "alert" | "muted";

const STATUS_VIEW: Record<OverviewStatus, { icon: IconName; tone: Tone }> = {
  saved: { icon: "checkmark-circle", tone: "ok" },
  waiting: { icon: "cloud-upload-outline", tone: "info" },
  syncing: { icon: "sync-outline", tone: "info" },
  attention: { icon: "alert-circle", tone: "alert" },
  // Being offline is an expected state on the floor, not a failure.
  offline: { icon: "cloud-offline-outline", tone: "warn" },
  unavailable: { icon: "help-circle-outline", tone: "muted" },
};

const CATEGORY_ICON: Record<CategoryKey, IconName> = {
  rooms: "bed-outline",
  tasks: "construct-outline",
  sessions: "sparkles-outline",
  other: "documents-outline",
};

export default function SyncSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const ctx = useTextContext();
  const { overview, syncing, lastRun, runSync, clearLastRun } = useSyncOverview();
  const [sheet, setSheet] = useState<{ open: boolean; category: CategoryKey | null }>({ open: false, category: null });

  const view = STATUS_VIEW[overview.status];
  const toneColor: Record<Tone, string> = {
    ok: theme.status.ready,
    info: theme.primary,
    warn: theme.status.pickup,
    alert: theme.status.dirty,
    muted: theme.textMuted,
  };
  const lastConfirmed = formatClock(overview.lastSyncedAt, ctx);
  const canSync = overview.online && !syncing;
  const syncLabel = syncing ? "settings.sync.syncingNow" : overview.attention > 0 ? "settings.sync.retrySync" : "settings.sync.syncNow";

  const openSheet = useCallback(
    (category: CategoryKey | null) => {
      clearLastRun();
      setSheet({ open: true, category });
    },
    [clearLastRun],
  );
  const closeSheet = useCallback(() => setSheet((s) => ({ ...s, open: false })), []);

  const categoryText = (c: OverviewCategory) => {
    if (c.attention > 0) return t("settings.sync.categoryState.attention", { count: c.attention });
    if (c.pending > 0) return t("settings.sync.categoryState.waiting", { count: c.pending });
    return overview.reliable ? t("settings.sync.categoryState.synced") : t("settings.sync.status.unavailable.title");
  };

  return (
    <SettingsScreen title={t("settings.sync.title")} back>
      <View
        style={[styles.summary, { backgroundColor: theme.surface, borderColor: overview.status === "attention" ? theme.status.dirty : theme.border }]}
        accessible
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${t(`settings.sync.status.${overview.status}.title`)}. ${t(`settings.sync.status.${overview.status}.body`)}`}
        testID="sync-summary"
      >
        <Ionicons name={view.icon} size={30} color={toneColor[view.tone]} />
        <View style={styles.summaryText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summaryTitle, { color: theme.textPrimary }]} testID="sync-summary-title">
            {t(`settings.sync.status.${overview.status}.title`)}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summaryBody, { color: theme.textSecondary }]}>
            {t(`settings.sync.status.${overview.status}.body`)}
          </Text>
        </View>
      </View>

      <SettingsSection testID="sync-details">
        <SettingsRow
          first
          icon={overview.online ? "wifi-outline" : "cloud-offline-outline"}
          label={t("settings.sync.connection")}
          subtitle={overview.online ? t("settings.sync.connOnline") : t("settings.sync.connOffline")}
          testID="sync-connection"
        />
        <SettingsRow
          icon="time-outline"
          label={t("settings.sync.lastLabel")}
          subtitle={lastConfirmed ? t("settings.sync.lastConfirmed", { time: lastConfirmed }) : t("settings.sync.lastUnknown")}
          testID="sync-last"
        />
        <SettingsRow
          icon="cloud-upload-outline"
          label={overview.pending > 0 ? t("settings.sync.pendingCount", { count: overview.pending }) : t("settings.sync.noPending")}
          onPress={overview.pending > 0 ? () => openSheet(null) : undefined}
          testID="sync-pending"
        />
        <SettingsRow
          icon="alert-circle-outline"
          label={overview.attention > 0 ? t("settings.sync.attentionCount", { count: overview.attention }) : t("settings.sync.noAttention")}
          onPress={overview.attention > 0 ? () => openSheet(null) : undefined}
          destructive={overview.attention > 0}
          testID="sync-attention"
        />
      </SettingsSection>

      {overview.categories.length > 0 ? (
        <SettingsSection title={t("settings.sync.savedWork")} testID="sync-categories">
          {overview.categories.map((c, index) => (
            <SettingsRow
              key={c.key}
              first={index === 0}
              icon={CATEGORY_ICON[c.key]}
              label={t(`settings.sync.categories.${c.key}`)}
              subtitle={categoryText(c)}
              onPress={c.rows.length > 0 ? () => openSheet(c.key) : undefined}
              testID={`sync-category-${c.key}`}
            />
          ))}
        </SettingsSection>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t(syncLabel)}
          icon="sync"
          onPress={() => void runSync()}
          loading={syncing}
          disabled={!canSync}
          testID="sync-now"
        />
        {!overview.online ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="sync-offline-info">
            {t("settings.sync.offlineInfo")}
          </Text>
        ) : null}
      </View>

      <SyncChangesSheet
        visible={sheet.open}
        category={sheet.category}
        categories={overview.categories}
        online={overview.online}
        syncing={syncing}
        lastRun={lastRun}
        onRetry={() => void runSync()}
        onOpenRoom={(roomId) => {
          closeSheet();
          router.push(`/(app)/my-rooms/${roomId}` as never);
        }}
        onOpenTasks={() => {
          closeSheet();
          router.push("/(app)/tasks" as never);
        }}
        onClose={closeSheet}
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderRadius: 16, padding: 16 },
  summaryText: { flex: 1, minWidth: 0, gap: 2 },
  summaryTitle: { fontSize: 18, fontWeight: "800" },
  summaryBody: { fontSize: 14, lineHeight: 20 },
  actions: { gap: 8 },
  hint: { fontSize: 12.5, lineHeight: 17, textAlign: "center" },
});
