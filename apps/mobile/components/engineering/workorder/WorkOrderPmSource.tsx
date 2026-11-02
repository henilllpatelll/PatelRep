import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SectionHeader } from "@/components/shared/evening";
import { formatDay } from "@/lib/engineering/assetFormat";
import { pmRecordRoute } from "@/lib/engineering/routes";
import type { WorkOrder } from "@/lib/engineering/workOrders";

interface Props {
  wo: WorkOrder;
  language: string;
  timezone: string | null | undefined;
}

/**
 * Where a PM-generated repair came from. Shown only when the server returned a source for this order (a real
 * `pm_completion_id` link inside this property); a repair with no such link shows nothing, never an empty card. The
 * inspection stays the record of what was found: finishing this repair does not change it.
 */
export function WorkOrderPmSource({ wo, language, timezone }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const source = wo.pm_source;
  if (!source) return null;
  const record = source.details_unavailable ? null : pmRecordRoute(source.completion_id, source.schedule_id);
  const failed = (source.failed_items ?? []).filter((item) => item.label);
  const done = formatDay(source.completed_at, timezone, language);
  const defect = wo.description?.trim();

  return (
    <View testID="wo-pm-source">
      <SectionHeader title={t("workOrders.pmSource.title")} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {source.details_unavailable ? (
          <Text style={{ color: theme.textMuted, fontSize: 13 }} testID="wo-pm-source-unavailable">
            {t("workOrders.pmSource.unavailable")}
          </Text>
        ) : (
          <>
            {source.schedule_name ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                {source.schedule_name}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
              {[wo.assets?.name, done ? t("workOrders.pmSource.completedOn", { date: done }) : null].filter(Boolean).join("  ·  ")}
            </Text>
            {failed.length > 0 ? (
              <>
                <Text style={[styles.label, { color: theme.textMuted }]}>{t("workOrders.pmSource.failed", { count: failed.length })}</Text>
                {failed.map((item, index) => (
                  <Text key={`${item.label}-${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textPrimary, fontSize: 14 }}>
                    {item.note ? `${item.label}: ${item.note}` : item.label}
                  </Text>
                ))}
              </>
            ) : null}
            {defect ? (
              <>
                <Text style={[styles.label, { color: theme.textMuted }]}>{t("workOrders.pmSource.recorded")}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={6} style={{ color: theme.textSecondary, fontSize: 13.5 }}>
                  {defect}
                </Text>
              </>
            ) : null}
            <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>
              {t("workOrders.pmSource.priority", { priority: t(`workQueue.priority.${wo.priority}`) })}
              {source.evidence_count ? `  ·  ${t("workOrders.pmSource.evidence", { count: source.evidence_count })}` : ""}
            </Text>
          </>
        )}
        {record ? (
          <Pressable
            onPress={() => router.push(record as never)}
            accessibilityRole="button"
            accessibilityLabel={t("workOrders.pmSource.view")}
            style={[styles.action, { borderColor: theme.border }]}
            testID="wo-pm-source-open"
          >
            <Ionicons name="clipboard-outline" size={16} color={theme.primary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.primary, fontSize: 14, fontWeight: "700", flex: 1 }}>
              {t("workOrders.pmSource.view")}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 6 },
  name: { fontSize: 14.5, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderTopWidth: 1, paddingTop: 10, marginTop: 6 },
});
