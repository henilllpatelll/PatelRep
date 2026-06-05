import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, displayFont } from "@/components/shared/tokens";
import { CopilotHero, HandoffRow, HeroButton, IconButton, Mono, Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { listAssets, getFailurePredictions, acknowledgePrediction, createWorkOrderFromPrediction, type Asset, type FailurePrediction } from "@/lib/api/assets";

function riskTone(score: number): "alert" | "caution" | "ready" {
  if (score >= 70) return "alert";
  if (score >= 40) return "caution";
  return "ready";
}

function riskLabel(score: number): string {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MED";
  return "LOW";
}

export default function AssetsScreen() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [predictions, setPredictions] = useState<FailurePrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [assetsRes, predsRes] = await Promise.allSettled([
        listAssets(),
        getFailurePredictions(),
      ]);
      if (assetsRes.status === "fulfilled") setAssets(assetsRes.value.data);
      if (predsRes.status === "fulfilled") setPredictions(predsRes.value.data.filter((p) => !p.is_acknowledged));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleDismiss = useCallback(async () => {
    const pred = predictions[0];
    if (!pred || actionLoading) return;
    setActionLoading(true);
    try {
      await acknowledgePrediction(pred.id);
      setPredictions((prev) => prev.filter((p) => p.id !== pred.id));
    } catch {
      Alert.alert("Error", "Could not dismiss prediction. Try again.");
    } finally {
      setActionLoading(false);
    }
  }, [predictions, actionLoading]);

  const handlePreemptRepair = useCallback(async () => {
    const pred = predictions[0];
    if (!pred || actionLoading) return;
    setActionLoading(true);
    try {
      await createWorkOrderFromPrediction(pred.id);
      Alert.alert("Work order created", `Repair work order submitted for ${pred.assets?.name ?? "asset"}.`);
      setPredictions((prev) => prev.filter((p) => p.id !== pred.id));
    } catch {
      Alert.alert("Error", "Could not create work order. Try again.");
    } finally {
      setActionLoading(false);
    }
  }, [predictions, actionLoading]);

  const topPred = predictions[0];
  const highRisk = assets.filter((a) => a.failure_risk_score >= 70).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerMeta}>Engineering</Text>
        <Text style={styles.title}>Assets</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        >
          {topPred ? (
            <CopilotHero
              kicker="Failure prediction"
              confidence={topPred.risk_score}
              actions={
                <>
                  <HeroButton primary icon="construct-outline" onPress={handlePreemptRepair}>
                    {actionLoading ? "Working…" : "Pre-empt repair"}
                  </HeroButton>
                  <HeroButton onPress={handleDismiss}>Dismiss</HeroButton>
                </>
              }
            >
              <Text style={styles.heroText}>
                <Text style={styles.heroStrong}>{topPred.assets?.name ?? "Asset"}</Text>: {topPred.recommendation}
              </Text>
            </CopilotHero>
          ) : null}

          <View style={styles.statsRow}>
            {[
              { value: String(assets.length), label: "total assets", color: undefined },
              { value: String(highRisk), label: "high risk", color: highRisk > 0 ? C.alert : C.ready },
              { value: String(predictions.length), label: "predictions", color: predictions.length > 0 ? C.caution : undefined },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Text style={[styles.statValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          <View>
            <SectionLabel hint={`${assets.length} total`}>All assets</SectionLabel>
            <View style={styles.rows}>
              {assets.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No assets registered</Text>
                  <Text style={styles.emptySub}>Assets are added via the web dashboard.</Text>
                </View>
              ) : (
                assets.map((asset) => (
                  <HandoffRow
                    key={asset.id}
                    lead={<IconButton icon="cube-outline" tone={riskTone(asset.failure_risk_score)} size={46} />}
                    title={
                      <>
                        <Text style={styles.rowTitle}>{asset.name}</Text>
                        <Pill tone={riskTone(asset.failure_risk_score)}>{riskLabel(asset.failure_risk_score)}</Pill>
                      </>
                    }
                    sub={[asset.asset_categories?.name, asset.rooms?.room_number ? `Room ${asset.rooms.room_number}` : asset.location_text].filter(Boolean).join(" — ")}
                    right={<Mono style={styles.riskScore}>{asset.failure_risk_score}%</Mono>}
                  />
                ))
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line2, backgroundColor: C.paper },
  headerMeta: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, color: C.ink3 },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 34, color: C.ink, marginTop: 4 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 32, gap: 13 },
  heroText: { color: "rgba(241,237,228,0.9)", fontSize: 14, lineHeight: 20 },
  heroStrong: { fontWeight: "700", color: C.paper },
  statsRow: { flexDirection: "row", gap: 9 },
  statCard: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },
  statValue: { fontFamily: displayFont, fontSize: 26, lineHeight: 28, color: C.ink },
  statLabel: { color: C.ink3, fontSize: 11, marginTop: 5 },
  rows: { gap: 8 },
  rowTitle: { fontSize: 13.5, fontWeight: "600", color: C.ink },
  riskScore: { fontSize: 11, color: C.ink3 },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
});
