import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { formatDay } from "@/lib/engineering/assetFormat";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { isActiveWorkOrder, type WorkOrder } from "@/lib/engineering/workOrders";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import type { AssetWorkOrders } from "@/lib/engineering/useAssetWorkOrders";
import { Fact, Panel, Pill } from "./assetUi";

interface Props {
  active: AssetWorkOrders;
  completed: AssetWorkOrders;
  /** Engineers only see their own and unclaimed orders; the section says so rather than implying a full history. */
  scoped: boolean;
  /** The 90-day count when the API reports it for the inventory list; null when unknown. */
  repeats90d: number | null;
  language: string;
  timezone: string | null | undefined;
  initialKind?: "active" | "completed";
}

function Row({ wo, language, timezone }: { wo: WorkOrder; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const number = workOrderLabel(wo);
  const isActive = isActiveWorkOrder(wo);
  const when = isActive ? formatDay(wo.created_at, timezone, language) : formatDay(wo.completed_at ?? wo.updated_at, timezone, language);
  const due = isActive ? formatDay(wo.due_at, timezone, language) : null;
  const resolution = !isActive ? wo.resolution_code?.label || wo.resolution_other_text : null;
  const verification = !isActive && wo.verification_result ? t(`assets.workOrders.verification.${wo.verification_result}`) : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId: wo.id } })}
      accessibilityRole="button"
      accessibilityLabel={t("assets.workOrders.open", { title: wo.title })}
      style={[styles.row, { borderTopColor: theme.borderSubtle }]}
      testID={`asset-wo-${wo.id}`}
    >
      <View style={styles.rowBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.rowTitle, { color: theme.textPrimary }]}>
          {wo.title}
        </Text>
        <View style={styles.facts}>
          {number ? <Fact icon="pricetag-outline" text={number} /> : null}
          <Fact icon="flag-outline" text={t(`workQueue.priority.${wo.priority}`)} tone={wo.priority === "emergency" || wo.priority === "urgent" ? "alert" : undefined} />
          <Fact icon="ellipse-outline" text={t(`workOrders.status.${wo.status}`)} />
          {wo.assigned_to_name ? <Fact icon="person-outline" text={wo.assigned_to_name} /> : null}
          {when ? <Fact icon="calendar-outline" text={isActive ? t("assets.workOrders.created", { date: when }) : t("assets.workOrders.completedOn", { date: when })} /> : null}
          {due ? <Fact icon="time-outline" text={t("assets.workOrders.due", { date: due })} /> : null}
        </View>
        {resolution ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.resolution, { color: theme.textSecondary }]}>
            {resolution}
          </Text>
        ) : null}
        {verification ? <Fact icon="shield-checkmark-outline" text={verification} /> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
    </Pressable>
  );
}

function List({ source, emptyBody, language, timezone }: { source: AssetWorkOrders; emptyBody: string; language: string; timezone: string | null | undefined }) {
  const { t } = useTranslation();
  const res = source.resource;
  const state = resolveLoadState({ loading: res.loading, failure: res.failure, count: source.orders.length });
  const finished = res.data != null;
  if (state.status !== "ready") {
    return (
      <EngineeringState
        status={finished ? "empty" : state.status}
        onRetry={() => void res.reload()}
        emptyIcon="construct-outline"
        emptyTitle={t("assets.workOrders.emptyTitle")}
        emptyBody={emptyBody}
      />
    );
  }
  return (
    <View>
      {state.stale ? <Text style={styles.stale}>{t("assets.workOrders.refreshFailed")}</Text> : null}
      {source.orders.map((wo) => (
        <Row key={wo.id} wo={wo} language={language} timezone={timezone} />
      ))}
      {source.loadingMore ? <ActivityIndicator style={styles.more} accessibilityLabel={t("common.loading")} /> : null}
      {source.moreFailed ? <Text style={styles.stale}>{t("assets.workOrders.moreFailed")}</Text> : null}
      {source.hasMore && !source.loadingMore ? (
        <Button label={t("assets.workOrders.loadMore")} variant="ghost" onPress={source.loadMore} testID="asset-wo-more" />
      ) : null}
    </View>
  );
}

/** Work orders linked to this asset by its canonical id: active repairs first, then the completed history, paged. */
export function AssetWorkOrdersSection({ active, completed, scoped, repeats90d, language, timezone, initialKind = "active" }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [kind, setKind] = useState<"active" | "completed">(initialKind);
  const source = kind === "active" ? active : completed;
  return (
    <Panel testID="asset-work-orders">
      <View style={styles.pills} accessibilityRole="tablist">
        <Pill label={t("assets.workOrders.active")} selected={kind === "active"} onPress={() => setKind("active")} testID="asset-wo-kind-active" />
        <Pill label={t("assets.workOrders.completed")} selected={kind === "completed"} onPress={() => setKind("completed")} testID="asset-wo-kind-completed" />
      </View>
      {repeats90d != null && repeats90d >= 2 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.repeat, { color: theme.textSecondary }]} testID="asset-repeat-note">
          {t("assets.workOrders.repeat90d", { count: repeats90d })}
        </Text>
      ) : null}
      <List
        source={source}
        language={language}
        timezone={timezone}
        emptyBody={kind === "active" ? t("assets.workOrders.noActive") : t("assets.workOrders.noCompleted")}
      />
      {scoped ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.scope, { color: theme.textMuted }]} testID="asset-wo-scope">
          {t("assets.workOrders.scoped")}
        </Text>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, minHeight: 56 },
  rowBody: { flex: 1, gap: 5 },
  rowTitle: { fontSize: 14.5, fontWeight: "700" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  resolution: { fontSize: 13 },
  more: { paddingVertical: 12 },
  stale: { fontSize: 12.5, paddingVertical: 6 },
  repeat: { fontSize: 13 },
  scope: { fontSize: 12.5, lineHeight: 17 },
});
