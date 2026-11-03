import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { ManagementHeader, SectionTitle } from "@/components/engineering/pm/management/ManagementChrome";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { getAssetOverview, type AssetOverview, type AssetOverviewSection } from "@/lib/api/pmManagement";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { useManagementResource } from "@/lib/engineering/useManagementResource";
import { canRetireAssets } from "@/lib/engineering/roles";
import { assetRoute, ASSETS_LIST_ROUTE } from "@/lib/engineering/routes";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

type Group = "critical" | "out_of_service" | "active_repairs" | "warranty_expiring" | "warranty_expired";
const GROUPS: readonly Group[] = ["critical", "out_of_service", "active_repairs", "warranty_expiring", "warranty_expired"];

/**
 * Asset Management: equipment that needs a manager's attention, from recorded facts only - the criticality the property
 * assigned, recorded warranty dates, open downtime and open repairs. Nothing is inferred from a prediction, and nothing
 * here changes a record: each row opens the equipment, where the guarded actions live.
 */
export default function AssetManagementScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const timezone = useAppStore((s) => s.hotelTimezone);
  const allowed = canRetireAssets(user?.effective_role ?? user?.role);
  const overview = useManagementResource(getAssetOverview, [], allowed);
  const data: AssetOverview | null = overview.data;
  const [group, setGroup] = useState<Group>("critical");

  const state = resolveLoadState({ loading: overview.loading && !data, failure: allowed ? overview.failure : "forbidden", count: data ? 1 : 0, offline: !isOnline && !data });
  const section: AssetOverviewSection | null = data ? data[group] : null;
  const tiles = useMemo(
    () => [
      { key: "critical" as const, tone: theme.status.dirty, soft: theme.status.dirtySoft },
      { key: "out_of_service" as const, tone: theme.status.outOfOrder, soft: theme.status.outOfOrderSoft },
      { key: "active_repairs" as const, tone: theme.status.pickup, soft: theme.status.pickupSoft },
      { key: "warranty_expiring" as const, tone: theme.status.inProgress, soft: theme.status.inProgressSoft },
      { key: "warranty_expired" as const, tone: theme.status.clean, soft: theme.status.cleanSoft },
    ],
    [theme],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="asset-management-screen">
      <ManagementHeader title={t("assets.management.title")} subtitle={t("assets.management.subtitle")} testID="asset-mgmt" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void overview.reload()} tintColor={theme.primaryAction} />}>
        {state.status !== "ready" || !data ? (
          <EngineeringState status={state.status === "ready" ? "loading" : state.status} onRetry={() => void overview.reload()} emptyTitle={t("assets.management.empty")} />
        ) : (
          <>
            <View style={styles.grid}>
              {tiles.map((tile) => {
                const selected = group === tile.key;
                return (
                  <Pressable
                    key={tile.key}
                    onPress={() => setGroup(tile.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${t(`assets.management.group.${tile.key}`)}: ${data[tile.key].count}`}
                    testID={`asset-mgmt-card-${tile.key}`}
                    style={[styles.tile, { backgroundColor: tile.soft, borderColor: selected ? tile.tone : theme.borderSubtle, borderWidth: selected ? 2 : 1 }]}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileValue, { color: tile.tone }]}>{data[tile.key].count}</Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileLabel, { color: tile.tone }]} numberOfLines={2}>{t(`assets.management.group.${tile.key}`)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionTitle>{t(`assets.management.group.${group}`)}</SectionTitle>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>{t(`assets.management.about.${group}`, { days: data.warranty_window_days })}</Text>
            {section && section.items.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="asset-mgmt-none">{t("assets.management.none")}</Text>
            ) : (
              section?.items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    const target = assetRoute(item.id);
                    router.push((target ?? ASSETS_LIST_ROUTE) as never);
                  }}
                  accessibilityRole="button"
                  testID={`asset-mgmt-row-${item.id}`}
                >
                  <Card style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} numberOfLines={1}>
                        {[item.asset_tag, item.location_text, item.criticality ? t(`assets.criticality.${item.criticality}`) : null].filter(Boolean).join(" · ")}
                      </Text>
                      {group.startsWith("warranty") && item.warranty_expires ? (
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>
                          {t("assets.management.warrantyDate", { date: formatDayYear(item.warranty_expires, timezone, i18n.language) ?? item.warranty_expires })}
                        </Text>
                      ) : null}
                      {group === "out_of_service" && item.downtime_impact ? (
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>{t(`assets.history.impact.${item.downtime_impact}`, { defaultValue: item.downtime_impact })}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </Card>
                </Pressable>
              ))
            )}
            {section && section.count > section.items.length ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="asset-mgmt-more">{t("assets.management.showingFirst", { shown: section.items.length, total: section.count })}</Text>
            ) : null}

            <SectionTitle>{t("assets.management.sectionRecords")}</SectionTitle>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="asset-mgmt-summary">
              {t("assets.management.summary", { active: data.active_assets, retired: data.retired.count, unknown: data.warranty_unknown })}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>{t("assets.management.disclaimer")}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "30%", minHeight: 76, borderRadius: 14, padding: 12, justifyContent: "center", gap: 2 },
  tileValue: { fontSize: 26, fontWeight: "700" },
  tileLabel: { fontSize: 12, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 56 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "700" },
  rowSub: { fontSize: 13, lineHeight: 18 },
});
