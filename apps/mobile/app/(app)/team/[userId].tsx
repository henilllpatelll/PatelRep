import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { Button } from "@/components/ui/Button";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { WorkOrderCard } from "@/components/engineering/WorkOrderCard";
import { AssignTechnicianSheet, type AssignTarget } from "@/components/engineering/team/AssignTechnicianSheet";
import { listWorkOrderPage } from "@/lib/api/workOrders";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { onAssignmentChanged } from "@/lib/engineering/teamEvents";
import { canManageTeam, teamScope, technicianName } from "@/lib/engineering/teamModel";
import { useTeamOverview } from "@/lib/engineering/useTeamOverview";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import { ACTIVE_WORK_ORDER_STATUSES, priorityRank, type WorkOrder } from "@/lib/engineering/workOrders";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

/** One technician's open work (focused list for a chief engineer / GM). Read from the same work-order API as the queue. */
export default function TechnicianWorkScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const locale = user?.language_pref === "es" ? "es" : "en";
  const scope = teamScope(user);
  const allowed = canManageTeam(role);
  const techId = String(userId);

  const overview = useTeamOverview(scope, allowed);
  const tech = overview.data?.technicians.find((x) => x.user_id === techId) ?? null;
  const orders = useAsyncResource(
    async (signal) => {
      void signal;
      const page = await listWorkOrderPage({ assigned_to: techId, statuses: [...ACTIVE_WORK_ORDER_STATUSES], sort_by: "due_at", sort_dir: "asc" }, 1, 50);
      return page;
    },
    { scope, key: `tech:${techId}`, enabled: allowed },
  );
  const { reload } = orders;
  useEffect(() => onAssignmentChanged(() => void reload()), [reload]);

  const [target, setTarget] = useState<AssignTarget | null>(null);
  const list = useMemo(
    () => [...(orders.data?.orders ?? [])].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)),
    [orders.data],
  );
  const state = resolveLoadState({ loading: orders.loading, failure: orders.failure, count: list.length, offline: !isOnline });

  const openAssign = useCallback(
    (wo: WorkOrder) =>
      setTarget({ id: wo.id, code: workOrderLabel(wo), title: wo.title, priority: wo.priority, assignedTo: wo.assigned_to ?? null, assignedToName: wo.assigned_to_name }),
    [],
  );

  if (!allowed) return <Redirect href="/(app)/more" />;
  const name = tech ? technicianName(tech, t("engineeringTeam.technician")) : t("engineeringTeam.technician");

  return (
    <SettingsScreen title={name} back>
      {tech ? (
        <Text style={[styles.summary, { color: theme.textSecondary }]} testID="tech-summary">
          {[
            t("engineeringTeam.load.active", { count: tech.active }),
            tech.urgent > 0 ? t("engineeringTeam.load.urgent", { count: tech.urgent }) : null,
            tech.on_hold > 0 ? t("engineeringTeam.load.onHold", { count: tech.on_hold }) : null,
            tech.overdue > 0 ? t("engineeringTeam.load.overdue", { count: tech.overdue }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}

      {state.status !== "ready" ? (
        <EngineeringState status={state.status} onRetry={() => void orders.reload()} emptyIcon="checkmark-done-outline" emptyTitle={t("engineeringTeam.techEmpty")} emptyBody={t("engineeringTeam.techEmptyBody")} />
      ) : (
        <View style={styles.list}>
          {state.stale ? <StaleBanner onRetry={() => void orders.reload()} /> : null}
          {list.map((wo) => (
            <View key={wo.id} style={styles.item}>
              <WorkOrderCard wo={wo} locale={locale} timeZone={hotelTimezone} view="team" viewerId={user?.id} onOpen={() => router.push(`/(app)/work-orders/${wo.id}` as never)} />
              <Button label={t("engineeringTeam.assign.reassignShort")} variant="secondary" size="sm" icon="swap-horizontal-outline" onPress={() => openAssign(wo)} testID={`tech-reassign-${wo.id}`} />
            </View>
          ))}
          {orders.data?.hasMore ? <Text style={{ color: theme.textMuted }}>{t("engineeringTeam.techMore")}</Text> : null}
        </View>
      )}

      <AssignTechnicianSheet
        visible={target != null}
        target={target}
        scope={scope}
        online={isOnline}
        onClose={() => setTarget(null)}
        onNeedsRefresh={() => void orders.reload()}
        onAssigned={(next, changed) => toast.success(changed ? t("engineeringTeam.assign.done", { name: next.name ?? t("engineeringTeam.technician") }) : t("engineeringTeam.assign.alreadyDone"))}
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 14, marginTop: -4 },
  list: { gap: 12 },
  item: { gap: 8 },
});
