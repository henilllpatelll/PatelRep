import { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { R, monoFont } from "@/components/shared/tokens";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { useTheme } from "@/lib/theme/useTheme";

type RiskAlert = {
  id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  room_number: string | null;
  asset_name: string | null;
  created_at: string;
  is_read: boolean;
};

const SEVERITY_STATUS: Partial<Record<RiskAlert["severity"], StatusKey>> = {
  critical: "emergency",
  high: "urgent",
  low: "low",
};

function useTimeAgo() {
  const { t } = useTranslation();
  return (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t("alerts.minsAgo", { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("alerts.hoursAgo", { count: hrs });
    return t("alerts.daysAgo", { count: Math.floor(hrs / 24) });
  };
}

export default function AlertsScreen() {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const theme = useTheme();
  const { isOnline } = useAppStore();
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAlerts = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: RiskAlert[] }>("/ai/risk-alerts");
      setAlerts(res.data ?? []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAlerts();
    setRefreshing(false);
  }, [loadAlerts]);

  const critical = alerts.filter((a) => a.severity === "critical" || a.severity === "high");
  const other = alerts.filter((a) => a.severity === "medium" || a.severity === "low");

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.background, borderBottomColor: theme.borderSubtle },
        ]}
      >
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("tabs.alerts")}</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t("alerts.subtitle")}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primaryAction}
          />
        }
      >
        {critical.length > 0 ? (
          <View>
            <SectionLabel hint={`${critical.length} ${t("alerts.items")}`}>{t("alerts.needsAttention")}</SectionLabel>
            {critical.map((alert) => (
              <Card
                key={alert.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.status.dirtySoft,
                    borderColor: theme.status.dirtyLine,
                  },
                ]}
              >
                <View style={styles.cardTop}>
                  <Ionicons name="warning" size={16} color={theme.status.dirty} />
                  <Text style={[styles.alertTitle, { color: theme.textPrimary }]}>{alert.title}</Text>
                  <StatusBadge
                    statusKey={SEVERITY_STATUS[alert.severity] ?? "urgent"}
                    label={alert.severity}
                  />
                </View>
                <Text style={[styles.alertDesc, { color: theme.textSecondary }]}>
                  {alert.description}
                </Text>
                {(alert.room_number || alert.asset_name) ? (
                  <Text style={[styles.alertMeta, { color: theme.textDisabled }]}>
                    {alert.room_number ? `Room ${alert.room_number}` : alert.asset_name}
                    {" · "}{timeAgo(alert.created_at)}
                  </Text>
                ) : (
                  <Text style={[styles.alertMeta, { color: theme.textDisabled }]}>
                    {timeAgo(alert.created_at)}
                  </Text>
                )}
              </Card>
            ))}
          </View>
        ) : null}

        {other.length > 0 ? (
          <View>
            <SectionLabel hint={`${other.length} ${t("alerts.items")}`}>{t("alerts.watchList")}</SectionLabel>
            {other.map((alert) => (
              <Card key={alert.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={theme.status.pickup}
                  />
                  <Text style={[styles.alertTitle, { color: theme.textPrimary }]}>{alert.title}</Text>
                  {SEVERITY_STATUS[alert.severity] ? (
                    <StatusBadge
                      statusKey={SEVERITY_STATUS[alert.severity] as StatusKey}
                      label={alert.severity}
                    />
                  ) : (
                    <View
                      style={[
                        styles.severityChip,
                        {
                          backgroundColor: theme.status.pickupSoft,
                          borderColor: theme.status.pickupLine,
                        },
                      ]}
                    >
                      <Text style={[styles.severityChipText, { color: theme.status.pickup }]}>
                        {alert.severity}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.alertDesc, { color: theme.textSecondary }]}>
                  {alert.description}
                </Text>
                <Text style={[styles.alertMeta, { color: theme.textDisabled }]}>
                  {timeAgo(alert.created_at)}
                </Text>
              </Card>
            ))}
          </View>
        ) : null}

        {alerts.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="shield-checkmark-outline"
            emptyTitle={t("alerts.allClear")}
            emptyBody={t("alerts.noAlerts")}
            style={styles.emptyCard}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, gap: 3,
  },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  card: { borderRadius: R.lg, padding: 14, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertTitle: { flex: 1, fontSize: 14, fontWeight: "700" },
  alertDesc: { fontSize: 13, lineHeight: 18 },
  alertMeta: { fontSize: 11, fontFamily: monoFont },
  severityChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 22,
  },
  severityChipText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  emptyCard: { alignItems: "center", paddingVertical: 56, gap: 8 },
});
