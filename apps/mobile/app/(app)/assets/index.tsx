import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { CopilotHero, HeroButton } from "@/components/shared/mobileHandoff";
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
   hero (paid action stays behind an explicit tap), and the fleet split into
   a risk-sorted watch list and the healthy remainder. */

function riskTone(score: number): "alert" | "caution" | "ready" {
  if (score >= 70) return "alert";
  if (score >= 40) return "caution";
  return "ready";
}

const TONE_COLORS = {
  alert: { fg: C.alert, bg: C.alertSoft, line: C.alertLine },
  caution: { fg: C.caution, bg: C.cautionSoft, line: C.cautionLine },
  ready: { fg: C.ready, bg: C.readySoft, line: C.readyLine },
} as const;

function AssetCard({ asset, sub }: { asset: Asset; sub: string }) {
  const tone = TONE_COLORS[riskTone(asset.failure_risk_score)];
  const score = Math.max(0, Math.min(100, asset.failure_risk_score));
  return (
    <View style={cardStyles.card}>
      <View style={[cardStyles.rail, { backgroundColor: tone.fg }]} />
      <View style={[cardStyles.tile, { backgroundColor: tone.bg }]}>
        <Ionicons name="cube-outline" size={17} color={tone.fg} />
      </View>
      <View style={cardStyles.body}>
        <Text style={cardStyles.name} numberOfLines={1}>
          {asset.name}
        </Text>
        {sub ? (
          <Text style={cardStyles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
        <View style={cardStyles.meterTrack}>
          <View style={[cardStyles.meterFill, { width: `${score}%`, backgroundColor: tone.fg }]} />
        </View>
      </View>
      <Text style={[cardStyles.score, { color: tone.fg }]}>{asset.failure_risk_score}%</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingLeft: 15,
    paddingRight: 13,
    paddingVertical: 12,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 4 },
  name: { color: C.ink, fontSize: 14, fontWeight: "700" },
  sub: { color: C.ink3, fontSize: 11.5 },
  meterTrack: { height: 4, borderRadius: 2, backgroundColor: C.surface3, overflow: "hidden", marginTop: 2 },
  meterFill: { height: 4, borderRadius: 2 },
  score: { fontSize: 12.5, fontWeight: "800", fontFamily: monoFont },
});

export default function AssetsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [predictions, setPredictions] = useState<FailurePrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

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

  const { watch, healthy } = useMemo(() => {
    const sorted = [...assets].sort((a, b) => b.failure_risk_score - a.failure_risk_score);
    return {
      watch: sorted.filter((a) => a.failure_risk_score >= 40),
      healthy: sorted.filter((a) => a.failure_risk_score < 40),
    };
  }, [assets]);

  const assetSub = (asset: Asset): string =>
    [
      asset.asset_categories?.name,
      asset.rooms?.room_number ? t("assets.roomLabel", { room: asset.rooms.room_number }) : asset.location_text,
    ]
      .filter(Boolean)
      .join(" — ");

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

            {assets.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t("assets.empty")}</Text>
                <Text style={styles.emptySub}>{t("assets.emptyHint")}</Text>
              </View>
            ) : (
              <>
                {watch.length > 0 ? (
                  <View>
                    <SectionHeader title={t("assets.watchList")} hint={String(watch.length)} />
                    <View style={styles.rows}>
                      {watch.map((asset) => (
                        <AssetCard key={asset.id} asset={asset} sub={assetSub(asset)} />
                      ))}
                    </View>
                  </View>
                ) : null}
                {healthy.length > 0 ? (
                  <View>
                    <SectionHeader title={t("assets.healthy")} hint={String(healthy.length)} />
                    <View style={styles.rows}>
                      {healthy.map((asset) => (
                        <AssetCard key={asset.id} asset={asset} sub={assetSub(asset)} />
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

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
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
});
