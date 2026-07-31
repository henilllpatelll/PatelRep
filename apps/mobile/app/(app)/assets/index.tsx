import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { monoFont } from "@/components/shared/tokens";
import { CopilotHero } from "@/components/shared/mobileHandoff";
import { SectionHeader } from "@/components/shared/evening";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
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

function AssetCard({ asset, sub }: { asset: Asset; sub: string }) {
  const theme = useTheme();
  const toneColors = {
    alert: { fg: theme.status.dirty, bg: theme.status.dirtySoft },
    caution: { fg: theme.status.pickup, bg: theme.status.pickupSoft },
    ready: { fg: theme.status.ready, bg: theme.status.readySoft },
  } as const;
  const tone = toneColors[riskTone(asset.failure_risk_score)];
  const score = Math.max(0, Math.min(100, asset.failure_risk_score));
  return (
    <Card style={cardStyles.card}>
      <View style={[cardStyles.rail, { backgroundColor: tone.fg }]} />
      <View style={[cardStyles.tile, { backgroundColor: tone.bg }]}>
        <Ionicons name="cube-outline" size={17} color={tone.fg} />
      </View>
      <View style={cardStyles.body}>
        <Text style={[cardStyles.name, { color: theme.textPrimary }]} numberOfLines={1}>
          {asset.name}
        </Text>
        {sub ? (
          <Text style={[cardStyles.sub, { color: theme.textMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
        <View style={[cardStyles.meterTrack, { backgroundColor: theme.surfaceMuted }]}>
          <View style={[cardStyles.meterFill, { width: `${score}%`, backgroundColor: tone.fg }]} />
        </View>
      </View>
      <Text style={[cardStyles.score, { color: tone.fg }]}>{asset.failure_risk_score}%</Text>
    </Card>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingLeft: 15,
    paddingRight: 13,
    paddingVertical: 12,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 14, fontWeight: "700" },
  sub: { fontSize: 11.5 },
  meterTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 2 },
  meterFill: { height: 4, borderRadius: 2 },
  score: { fontSize: 12.5, fontWeight: "800", fontFamily: monoFont },
});

export default function AssetsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
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
      toast.error(t("assets.dismissError"));
    } finally {
      setActionLoading(false);
    }
  }, [predictions, actionLoading, t, toast]);

  const handlePreemptRepair = useCallback(async () => {
    const pred = predictions[0];
    if (!pred || actionLoading) return;
    setActionLoading(true);
    try {
      await createWorkOrderFromPrediction(pred.id);
      toast.success(
        `${t("assets.woCreatedTitle")}: ${t("assets.woCreatedBody", {
          name: pred.assets?.name ?? t("assets.fallbackAsset"),
        })}`
      );
      setPredictions((prev) => prev.filter((p) => p.id !== pred.id));
    } catch {
      toast.error(t("assets.woCreateError"));
    } finally {
      setActionLoading(false);
    }
  }, [predictions, actionLoading, t, toast]);

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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {loading ? (
        <View style={styles.center}>
          <StateBlock status="loading" />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        >
          <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
          <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
            <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>{t("assets.kicker")}</Text>
            <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("assets.title")}</Text>
            <View style={styles.heroStats}>
              <View style={[styles.heroStat, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
                <Text style={[styles.heroStatValue, { color: theme.shell.ink }]}>{assets.length}</Text>
                <Text style={[styles.heroStatLabel, { color: theme.shell.ink2 }]}>{t("assets.statTotal")}</Text>
              </View>
              <View style={[styles.heroStat, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
                <Text style={[styles.heroStatValue, { color: highRisk > 0 ? theme.status.dirty : theme.shell.ink }]}>{highRisk}</Text>
                <Text style={[styles.heroStatLabel, { color: theme.shell.ink2 }]}>{t("assets.statHighRisk")}</Text>
              </View>
              <View style={[styles.heroStat, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
                <Text style={[styles.heroStatValue, { color: predictions.length > 0 ? theme.accentBrass : theme.shell.ink }]}>
                  {predictions.length}
                </Text>
                <Text style={[styles.heroStatLabel, { color: theme.shell.ink2 }]}>{t("assets.statPredictions")}</Text>
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
                    <Button
                      label={actionLoading ? t("assets.working") : t("assets.preempt")}
                      icon="construct-outline"
                      loading={actionLoading}
                      onPress={handlePreemptRepair}
                      size="sm"
                    />
                    <Button
                      label={t("assets.dismiss")}
                      onPress={handleDismiss}
                      disabled={actionLoading}
                      variant="secondary"
                      size="sm"
                    />
                  </>
                }
              >
                <Text style={styles.heroText}>
                  <Text style={[styles.heroStrong, { color: theme.background }]}>
                    {topPred.assets?.name ?? t("assets.fallbackAsset")}
                  </Text>: {" "}
                  {topPred.recommendation}
                </Text>
              </CopilotHero>
            ) : null}

            {assets.length === 0 ? (
              <StateBlock
                status="empty"
                emptyIcon="cube-outline"
                emptyTitle={t("assets.empty")}
                emptyBody={t("assets.emptyHint")}
                style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}
              />
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
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroStats: { flexDirection: "row", gap: 9, marginTop: 14 },
  heroStat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroStatValue: { fontSize: 22, lineHeight: 26, fontWeight: "700", fontFamily: monoFont },
  heroStatLabel: { fontSize: 10.5, marginTop: 3 },

  body: { paddingHorizontal: 18, paddingTop: 14, gap: 13 },
  heroText: { color: "rgba(241,237,228,0.9)", fontSize: 14, lineHeight: 20 },
  heroStrong: { fontWeight: "700" },
  rows: { gap: 8 },
  empty: { borderWidth: 1, padding: 20, alignItems: "center" },
});
