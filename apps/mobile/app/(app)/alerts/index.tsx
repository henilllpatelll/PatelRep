import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { C, R, monoFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";

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

type ToneType = "alert" | "caution" | "info" | "neutral";

const SEVERITY_TONES: Record<string, ToneType> = {
  critical: "alert",
  high: "alert",
  medium: "caution",
  low: "info",
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
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tabs.alerts")}</Text>
        <Text style={styles.subtitle}>{t("alerts.subtitle")}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {critical.length > 0 ? (
          <View>
            <SectionLabel hint={`${critical.length} ${t("alerts.items")}`}>{t("alerts.needsAttention")}</SectionLabel>
            {critical.map((alert) => (
              <View key={alert.id} style={[styles.card, styles.cardCritical]}>
                <View style={styles.cardTop}>
                  <Ionicons name="warning" size={16} color={C.alert} />
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <Pill tone={SEVERITY_TONES[alert.severity] ?? "neutral"}>{alert.severity}</Pill>
                </View>
                <Text style={styles.alertDesc}>{alert.description}</Text>
                {(alert.room_number || alert.asset_name) ? (
                  <Text style={styles.alertMeta}>
                    {alert.room_number ? `Room ${alert.room_number}` : alert.asset_name}
                    {" · "}{timeAgo(alert.created_at)}
                  </Text>
                ) : (
                  <Text style={styles.alertMeta}>{timeAgo(alert.created_at)}</Text>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {other.length > 0 ? (
          <View>
            <SectionLabel hint={`${other.length} ${t("alerts.items")}`}>{t("alerts.watchList")}</SectionLabel>
            {other.map((alert) => (
              <View key={alert.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Ionicons name="information-circle-outline" size={16} color={C.caution} />
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <Pill tone={SEVERITY_TONES[alert.severity] ?? "neutral"}>{alert.severity}</Pill>
                </View>
                <Text style={styles.alertDesc}>{alert.description}</Text>
                <Text style={styles.alertMeta}>{timeAgo(alert.created_at)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {alerts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-checkmark-outline" size={36} color={C.ready} />
            <Text style={styles.emptyTitle}>{t("alerts.allClear")}</Text>
            <Text style={styles.emptyText}>{t("alerts.noAlerts")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: {
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.line2, backgroundColor: C.paper, gap: 3,
  },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  subtitle: { fontSize: 12, color: C.ink3 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: R.lg, padding: 14, gap: 6,
  },
  cardCritical: { backgroundColor: C.alertSoft, borderColor: C.alertLine },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: C.ink },
  alertDesc: { fontSize: 13, color: C.ink2, lineHeight: 18 },
  alertMeta: { fontSize: 11, color: C.ink4, fontFamily: monoFont },
  emptyCard: { alignItems: "center", paddingVertical: 56, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ready },
  emptyText: { fontSize: 13, color: C.ink3 },
});
