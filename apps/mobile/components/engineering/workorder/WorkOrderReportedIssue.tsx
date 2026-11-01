import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { CATEGORY_META } from "@/components/engineering/WorkOrderCard";
import { SectionHeader } from "@/components/shared/evening";
import { workOrderLocation, type WorkOrder } from "@/lib/engineering/workOrders";

interface Props {
  wo: WorkOrder;
  locale: string;
  occupancy: "occupied" | "vacant" | null;
  technicianName: string | null;
}

function when(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The original request, in full, plus where it is and who reported and holds it. Only what the API returned. */
export function WorkOrderReportedIssue({ wo, locale, occupancy, technicianName }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { room, text: locationText } = workOrderLocation(wo);
  const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
  const category = CATEGORY_META[categoryKey];
  const rows: { label: string; value: string; roomId?: string }[] = [];
  if (room) rows.push({ roomId: wo.room_id ?? undefined, label: t("workOrders.location"), value: `${t("workOrders.repair.complete.room", { room })}${wo.rooms?.floor != null ? `  ·  ${t("workOrders.floor", { floor: wo.rooms.floor })}` : ""}${occupancy ? `  ·  ${t(`workOrders.roomOccupancy.${occupancy}`)}` : ""}` });
  else if (locationText) rows.push({ label: t("workOrders.location"), value: locationText });
  if (wo.source) rows.push({ label: t("workOrders.repair.issue.source"), value: t(`workOrders.repair.issue.sources.${wo.source}`, { defaultValue: wo.source }) });
  if (wo.guest_reported) rows.push({ label: t("workOrders.repair.issue.source"), value: t("workOrders.chipGuest") });
  const created = when(wo.created_at, locale);
  if (created) rows.push({ label: t("workOrders.factCreated"), value: created });
  rows.push({ label: t("workOrders.repair.issue.assignedTo"), value: technicianName ?? (wo.assigned_to ? t("workOrders.repair.issue.assigned") : t("workOrders.repair.issue.unassigned")) });

  return (
    <View testID="wo-issue">
      <SectionHeader title={t("workOrders.repair.issue.title")} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.cat}>
          <View style={[styles.tile, { backgroundColor: category.bg }]}>
            <Ionicons name={category.icon} size={13} color={category.fg} />
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "700" }}>
            {t(`workOrders.category.${categoryKey}`)}
          </Text>
        </View>
        {wo.description ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.description, { color: theme.textPrimary }]} testID="wo-description">
            {wo.description}
          </Text>
        ) : (
          <Text style={{ color: theme.textDisabled, fontSize: 13.5 }}>{t("workOrders.repair.issue.noDescription")}</Text>
        )}
        {rows.map((row) =>
          row.roomId ? (
            <Pressable
              key={`${row.label}-${row.value}`}
              onPress={() => router.push({ pathname: "/(app)/room-status/[roomId]", params: { roomId: row.roomId } } as never)}
              accessibilityRole="link"
              accessibilityLabel={t("workOrders.repair.issue.openRoom", { room })}
              style={[styles.row, { borderTopColor: theme.borderSubtle, minHeight: 44, alignItems: "center" }]}
              testID="wo-open-room"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>{row.label}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.primaryAction, textDecorationLine: "underline" }]}>{row.value}</Text>
            </Pressable>
          ) : (
            <View key={`${row.label}-${row.value}`} style={[styles.row, { borderTopColor: theme.borderSubtle }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>{row.label}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>{row.value}</Text>
            </View>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 10 },
  cat: { flexDirection: "row", alignItems: "center", gap: 8 },
  tile: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  description: { fontSize: 15, lineHeight: 22 },
  row: { flexDirection: "row", gap: 12, borderTopWidth: 1, paddingTop: 9, justifyContent: "space-between" },
  rowLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0, maxWidth: "40%" },
  rowValue: { fontSize: 14, flex: 1, textAlign: "right" },
});
