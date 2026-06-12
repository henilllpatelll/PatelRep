import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { CopilotHero, HandoffRow, HeroButton, IconButton, Mono } from "@/components/shared/mobileHandoff";
import { SectionHeader } from "@/components/shared/evening";
import {
  listAssets,
  getFailurePredictions,
  acknowledgePrediction,
  createWorkOrderFromPrediction,
  type Asset,
  type FailurePrediction,
} from "@/lib/api/assets";

/* ─── Assets tab — equipment health in the Evening Lobby language ───────────
   Dark shell hero with live fleet counts, the real AI failure-prediction
   hero (paid action stays behind an explicit tap), and the asset list. */

function riskTone(score: number): "alert" | "caution" | "ready" {
  if (score >= 70) return "alert";
  if (score >= 40) return "caution";
  return "ready";
}

export default function AssetsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [predictions, setPredictions] = useState<FailurePrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const riskLabel = (score: number): string =>
    score >= 70 ? t("assets.riskHigh") : score >= 40 ? t("assets.riskMed") : t("assets.riskLow");

  const load = useCallback(async () => {
    try {
      const [assetsRes, predsRes] = await Promise.allSettled([listAssets(), getFailurePredictions()]);
      if (assetsRes.status === "fulfilled") setAssets(assetsRes.value.data);
      if (predsRes.status === "fulfilled") {
        setPredictions(predsRes.value.data.filter((p) => !p.is_acknowledged));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      Alert.alert(t("common.error"), t("assets.dismissError"));
    } finally {
      setActionLoading(false);
    }
  }, [predictions, actionLoading, t]);

  const handlePreemptRepair = useCallback(async () => {
    const pred = predictions[0];
    if (!pred || actionLoading) return;
    setActionLoading(true);
    try {
      await createWorkOrderFromPrediction(pred.id);
      Alert.alert(
        t("assets.woCreatedTitle"),
        t("assets.woCreatedBody", { name: pred.assets?.name ?? t("assets.fallbackAsset") })
      );
      setPredictions((prev) => prev.filter((p) => p.id !== pred.id));
    } catch {
      Alert.alert(t("common.error"), t("assets.woCreateError"));
    } finally {
      setActionLoading(false);
    }
  }, [predictions, actionLoading, t]);

  const topPred = predictions[0];
  const highRisk = assets.filter((a) => a.failure_risk_score >= 70).length;

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        >
          <View style={styles.topBleed} />
          <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
            <Text style={styles.heroKicker}>{t("assets.kicker")}</Text>
            <Text style={styles.heroTitle}>{t("assets.title")}</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{assets.length}</Text>
                <Text style={styles.heroStatLabel}>{t("assets.statTotal")}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatValue, highRisk > 0 && { color: "#E7A9B0" }]}>{highRisk}</Text>
                <Text style={styles.heroStatLabel}>{t("assets.statHighRisk")}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatValue, predictions.length > 0 && { color: "#E4C174" }]}>
                  {predictions.length}
                </Text>
                <Text style={styles.heroStatLabel}>{t("assets.statPredictions")}</Text>
              </View>
            </View>
          </View>

          <View style={styles.body}>
            {topPred ? (
              <CopilotHero
                kicker={t("assets.predictionKicker")}
                confidence={topPred.risk_score}
                actions={
                  <>
                    <HeroButton primary icon="construct-outline" onPress={handlePreemptRepair}>
                      {actionLoading ? t("assets.working") : t("assets.preempt")}
                    </HeroButton>
                    <HeroButton onPress={handleDismiss}>{t("assets.dismiss")}</HeroButton>
                  </>
                }
              >
                <Text style={styles.heroText}>
                  <Text style={styles.heroStrong}>{topPred.assets?.name ?? t("assets.fallbackAsset")}</Text>:{" "}
                  {topPred.recommendation}
                </Text>
              </CopilotHero>
            ) : null}

            <View>
              <SectionHeader title={t("assets.allAssets")} hint={t("assets.totalHint", { count: assets.length })} />
              <View style={styles.rows}>
                {assets.length === 0 ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>{t("assets.empty")}</Text>
                    <Text style={styles.emptySub}>{t("assets.emptyHint")}</Text>
                  </View>
                ) : (
                  assets.map((asset) => (
                    <HandoffRow
                      key={asset.id}
                      lead={<IconButton icon="cube-outline" tone={riskTone(asset.failure_risk_score)} size={46} />}
                      title={
                        <>
                          <Text style={styles.rowTitle}>{asset.name}</Text>
                          <View style={[styles.riskChip, riskChipStyles[riskTone(asset.failure_risk_score)]]}>
                            <Text style={[styles.riskChipText, riskTextStyles[riskTone(asset.failure_risk_score)]]}>
                              {riskLabel(asset.failure_risk_score)}
                            </Text>
                          </View>
                        </>
                      }
                      sub={[
                        asset.asset_categories?.name,
                        asset.rooms?.room_number
                          ? t("assets.roomLabel", { room: asset.rooms.room_number })
                          : asset.location_text,
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                      right={<Mono style={styles.riskScore}>{asset.failure_risk_score}%</Mono>}
                    />
                  ))
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const riskChipStyles = StyleSheet.create({
  alert: { backgroundColor: C.alertSoft, borderColor: C.alertLine },
  caution: { backgroundColor: C.cautionSoft, borderColor: C.cautionLine },
  ready: { backgroundColor: C.readySoft, borderColor: C.readyLine },
});

const riskTextStyles = StyleSheet.create({
  alert: { color: C.alert },
  caution: { color: C.caution },
  ready: { color: C.ready },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: { color: shellTokens.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroStats: { flexDirection: "row", gap: 9, marginTop: 14 },
  heroStat: {
    flex: 1,
    backgroundColor: shellTokens.surface,
    borderWidth: 1,
    borderColor: shellTokens.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroStatValue: { color: shellTokens.ink, fontSize: 22, lineHeight: 26, fontWeight: "700", fontFamily: monoFont },
  heroStatLabel: { color: shellTokens.ink2, fontSize: 10.5, marginTop: 3 },

  body: { paddingHorizontal: 18, paddingTop: 14, gap: 13 },
  heroText: { color: "rgba(241,237,228,0.9)", fontSize: 14, lineHeight: 20 },
  heroStrong: { fontWeight: "700", color: C.paper },
  rows: { gap: 8 },
  rowTitle: { fontSize: 13.5, fontWeight: "600", color: C.ink },
  riskChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  riskChipText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  riskScore: { fontSize: 11, color: C.ink3 },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
});
