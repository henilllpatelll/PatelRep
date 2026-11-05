import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { StateBlock } from "@/components/ui/StateBlock";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { AssignTechnicianSheet, type AssignTarget } from "@/components/engineering/team/AssignTechnicianSheet";
import { AttentionRow, SummaryTileView, TechnicianCard } from "@/components/engineering/team/TeamParts";
import type { AttentionItem } from "@/lib/api/engineeringTeam";
import { chiefSummaryRoute } from "@/lib/engineering/homeNavigation";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { attentionRoute, canManageTeam, summaryTiles, teamScope, workOrderCode } from "@/lib/engineering/teamModel";
import { useTeamOverview } from "@/lib/engineering/useTeamOverview";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

/* ─── Team Overview (chief engineer / GM) ───────────────────────────────────
   Counts, what needs attention, and each technician's open work - all from GET /engineering/team/overview. The
   figures are plain counts: no shift, clock-in or availability data exists for engineers, so none is shown. */

export default function TeamOverviewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const role = user?.effective_role ?? user?.role;
  const scope = teamScope(user);
  const allowed = canManageTeam(role);
  const overview = useTeamOverview(scope, allowed);
  const [target, setTarget] = useState<AssignTarget | null>(null);

  const data = overview.data;
  const tiles = useMemo(() => (data ? summaryTiles(data.counts) : null), [data]);
  const state = resolveLoadState({ loading: overview.loading, failure: overview.failure, count: data ? 1 : 0, offline: !isOnline });

  // Routes exist for every role; only managers have a Team Overview. The API refuses anyone else regardless.
  if (!allowed) return <Redirect href="/(app)/more" />;

  function openAssign(item: AttentionItem) {
    setTarget({
      id: item.id,
      code: workOrderCode(item),
      title: item.title ?? "",
      priority: item.priority,
      assignedTo: item.assigned_to,
      assignedToName: item.assigned_to_name,
    });
  }

  return (
    <SettingsScreen title={t("engineeringTeam.title")} back v2Chrome={false}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
        {t("engineeringTeam.subtitle")}
      </Text>

      {state.status !== "ready" || !data || !tiles ? (
        <EngineeringState status={state.status} onRetry={() => void overview.reload()} emptyTitle={t("engineeringTeam.empty")} />
      ) : (
        <>
          {state.stale ? <StaleBanner onRetry={() => void overview.reload()} /> : null}
          {data.truncated ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.pickup }]} testID="team-truncated">
              {t("engineeringTeam.truncated")}
            </Text>
          ) : null}

          <View style={styles.tiles}>
            {tiles.primary.map((tile) => (
              <SummaryTileView key={tile.key} tile={tile} />
            ))}
          </View>
          {tiles.secondary.length > 0 ? (
            <View style={styles.tiles}>
              {tiles.secondary.map((tile) => (
                <SummaryTileView
                  key={tile.key}
                  tile={tile}
                  onPress={tile.key === "pm_overdue" ? () => router.push("/(app)/pm-schedules" as never) : undefined}
                />
              ))}
            </View>
          ) : null}

          <SettingsSection title={t("engineeringTeam.needsAttention")} testID="team-attention">
            {data.needs_attention.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="team-attention-empty">
                {t("engineeringTeam.attentionEmpty")}
              </Text>
            ) : (
              <View style={styles.attentionList}>
                {data.needs_attention.map((item) => (
                  <AttentionRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onOpen={() => router.push(attentionRoute(item) as never)}
                    onAssign={item.status === "on_hold" && !item.assigned_to ? undefined : () => openAssign(item)}
                  />
                ))}
              </View>
            )}
          </SettingsSection>
          <Pressable
            onPress={() => router.push(chiefSummaryRoute("needsOwner") as never)}
            accessibilityRole="button"
            accessibilityHint={t("engineeringTeam.unassignedHint")}
            style={styles.moreLink}
            testID="team-unassigned"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.link, { color: theme.primaryAction }]}>
              {t("engineeringTeam.unassignedLink")}
            </Text>
          </Pressable>
          {Object.values(data.attention_counts).reduce((a, b) => a + b, 0) > data.needs_attention.length ? (
            <Pressable
              onPress={() => router.push("/(app)/work-orders" as never)}
              accessibilityRole="button"
              style={styles.moreLink}
              testID="team-attention-more"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.link, { color: theme.primaryAction }]}>
                {t("engineeringTeam.seeAllWork")}
              </Text>
            </Pressable>
          ) : null}

          <SettingsSection title={t("engineeringTeam.workload")} testID="team-workload">
            {data.technicians.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="team-no-technicians">
                {t("engineeringTeam.noTechnicians")}
              </Text>
            ) : (
              <View style={styles.attentionList}>
                {data.technicians.map((tech) => (
                  <TechnicianCard key={tech.user_id} tech={tech} onViewWork={() => router.push(`/(app)/team/${tech.user_id}` as never)} />
                ))}
              </View>
            )}
          </SettingsSection>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textDisabled }]}>
            {t("engineeringTeam.workloadNote")}
          </Text>

          <SettingsSection title={t("engineeringTeam.oversight")} testID="team-oversight">
            <SettingsRow
              first
              icon="calendar-outline"
              label={t("engineeringTeam.pmOversight")}
              subtitle={data.counts.pm_overdue == null ? t("engineeringTeam.tiles.unknown") : t("engineeringTeam.pmOverdueCount", { count: data.counts.pm_overdue })}
              onPress={() => router.push("/(app)/pm-schedules" as never)}
              testID="team-pm"
            />
            {data.pm_oversight == null ? (
              <SettingsRow icon="alert-circle-outline" label={t("engineeringTeam.pmDetailUnavailable")} testID="team-pm-unavailable" />
            ) : null}
            {data.pm_oversight?.overdue.map((item) => (
              <SettingsRow
                key={item.id}
                icon="time-outline"
                label={item.name ?? t("engineeringTeam.pmOversight")}
                subtitle={[item.asset_name, t("engineeringTeam.pmOverdueLabel")].filter(Boolean).join(" · ")}
                onPress={() => router.push(`/(app)/pm-schedules/${item.id}` as never)}
                testID={`team-pm-overdue-${item.id}`}
              />
            ))}
            {data.pm_oversight?.repeat_defects.map((item) => (
              <SettingsRow
                key={item.asset_id}
                icon="warning-outline"
                label={item.asset_name ?? t("engineeringTeam.equipment")}
                subtitle={t("engineeringTeam.repeatDefects", { count: item.count, days: data.pm_oversight?.repeat_window_days ?? 90 })}
                onPress={() => router.push(`/(app)/assets/${item.asset_id}` as never)}
                testID={`team-pm-repeat-${item.asset_id}`}
              />
            ))}
            <SettingsRow
              icon="bed-outline"
              label={t("engineeringTeam.roomOversight")}
              subtitle={
                data.rooms_down == null
                  ? t("engineeringTeam.tiles.unknown")
                  : t("engineeringTeam.roomsDown", { count: data.rooms_down.total, late: data.rooms_down.past_expected_return })
              }
              onPress={() => router.push("/(app)/room-status" as never)}
              testID="team-rooms"
            />
          </SettingsSection>
        </>
      )}

      {overview.refreshing ? <StateBlock status="loading" style={styles.refreshing} /> : null}

      <AssignTechnicianSheet
        visible={target != null}
        target={target}
        scope={scope}
        online={isOnline}
        onClose={() => setTarget(null)}
        onNeedsRefresh={() => void overview.reload()}
        onAssigned={(tech, changed) => toast.success(changed ? t("engineeringTeam.assign.done", { name: tech.name ?? t("engineeringTeam.technician") }) : t("engineeringTeam.assign.alreadyDone"))}
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 14, marginTop: -4 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  attentionList: { gap: 10, padding: 10 },
  empty: { fontSize: 14, padding: 16 },
  note: { fontSize: 12.5, lineHeight: 17 },
  moreLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  link: { fontSize: 14, fontWeight: "800" },
  refreshing: { paddingVertical: 8 },
});
