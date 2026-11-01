import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SectionHeader } from "@/components/shared/evening";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

interface Props {
  wo: WorkOrder;
  /** Completed repairs on the same asset, newest first. */
  related: readonly WorkOrder[];
  relatedFailed: boolean;
  locale: string;
  /** "summary" (Overview): the equipment and a pointer to its history. "history" (History tab): the earlier repairs themselves. */
  variant: "summary" | "history";
}

/**
 * Linked equipment and the earlier repairs on it. A relationship here is one the data states (same asset id),
 * never a guess from a shared room number. Asset lookup never gates the repair: an order without one just omits this.
 */
export function WorkOrderAssetContext({ wo, related, relatedFailed, locale, variant }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const asset = wo.assets;
  if (!asset?.name) return null;
  const history = variant === "history";
  const sub = [asset.asset_categories?.name, asset.asset_tag, asset.location_text].filter(Boolean).join("  ·  ");

  return (
    <View testID={history ? "wo-asset-history" : "wo-asset"}>
      <SectionHeader title={t(history ? "workOrders.repair.asset.historyTitle" : "workOrders.repair.asset.title")} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {history ? <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{t("workOrders.repair.asset.historyNote", { name: asset.name })}</Text> : null}
        {history ? null : <View style={styles.head}>
          <View style={[styles.tile, { backgroundColor: theme.primarySoft }]}>
            <Ionicons name="cube-outline" size={17} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textPrimary, fontSize: 14.5, fontWeight: "700" }}>{asset.name}</Text>
            {sub ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5, marginTop: 2 }}>{sub}</Text> : null}
          </View>
        </View>}

        {history ? (
          <>
          <Text style={[styles.label, { color: theme.textMuted }]}>{t("workOrders.repair.asset.previous", { count: related.length })}</Text>
          {relatedFailed ? (
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t("workOrders.repair.asset.relatedFailed")}</Text>
          ) : related.length === 0 ? (
            <Text style={{ color: theme.textDisabled, fontSize: 13 }}>{t("workOrders.repair.asset.noPrevious")}</Text>
          ) : (
            related.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId: row.id } })}
                accessibilityRole="button"
                accessibilityLabel={t("workOrders.repair.asset.open", { title: row.title })}
                style={[styles.related, { borderTopColor: theme.borderSubtle }]}
                testID={`wo-related-${row.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={{ color: theme.textPrimary, fontSize: 14 }}>{row.title}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {[workOrderLabel(row), row.completed_at ? new Date(row.completed_at).toLocaleDateString(locale, { month: "short", day: "numeric" }) : null].filter(Boolean).join("  ·  ")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
              </Pressable>
            ))
          )}
          </>
        ) : (
          <Text style={{ color: relatedFailed ? theme.textMuted : theme.textSecondary, fontSize: 13 }} testID="wo-asset-summary-line">
            {relatedFailed ? t("workOrders.repair.asset.relatedFailed") : related.length === 0 ? t("workOrders.repair.asset.noPrevious") : t("workOrders.repair.asset.seeHistory", { count: related.length })}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 4 },
  related: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderTopWidth: 1, paddingTop: 8 },
});
