import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SectionHeader } from "@/components/shared/evening";
import { formatClock, type WorkOrder } from "@/lib/engineering/workOrders";
import type { RepairActionId, RepairActions } from "@/lib/engineering/repairWorkspace";

export type ToolId = "arrive" | "acknowledge" | "labor" | "diagnosis" | "evidence" | "parts" | "note";

interface Props {
  wo: WorkOrder;
  actions: RepairActions;
  locale: string;
  online: boolean;
  busy: string | null;
  laborLabel: string;
  photoCount: number;
  partsCount: number;
  onTool: (tool: ToolId) => void;
}

interface Tile {
  id: ToolId;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  /** The tile does something when pressed. A recorded fact (arrival time) is shown but not pressable. */
  active: boolean;
  needsConnection: boolean;
  gate?: RepairActionId;
}

/** The repair tools as a grid. Each shows its recorded state; pressing opens the matching sheet or performs the one-tap action. */
export function WorkOrderRepairTools({ wo, actions, locale, online, busy, laborLabel, photoCount, partsCount, onTool }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { can } = actions;
  const arrivedAt = formatClock(wo.arrived_at, locale);
  const ackAt = formatClock(wo.acknowledged_at, locale);
  const diagnosis = wo.problem_code?.label ?? wo.problem_other_text ?? null;
  const closed = actions.block === "closed";

  const tiles: Tile[] = [];
  if (can.acknowledge || ackAt) {
    tiles.push({ id: "acknowledge", icon: "checkmark-done-outline", label: t("workOrders.repair.tools.acknowledge"), value: ackAt ? t("workOrders.repair.tools.acknowledgedAt", { time: ackAt }) : t("workOrders.repair.tools.tapToAcknowledge"), active: can.acknowledge && !ackAt, needsConnection: true });
  }
  if (can.arrive || arrivedAt) {
    tiles.push({ id: "arrive", icon: "location-outline", label: t("workOrders.repair.tools.arrive"), value: arrivedAt ? t("workOrders.repair.tools.arrivedAt", { time: arrivedAt }) : t("workOrders.repair.tools.tapToArrive"), active: can.arrive && !arrivedAt, needsConnection: true });
  }
  tiles.push({ id: "labor", icon: "timer-outline", label: t("workOrders.repair.tools.labor"), value: laborLabel, active: true, needsConnection: false });
  tiles.push({ id: "diagnosis", icon: "search-outline", label: t("workOrders.repair.tools.diagnosis"), value: diagnosis ?? t("workOrders.repair.tools.notRecorded"), active: can.diagnose, needsConnection: true });
  tiles.push({ id: "evidence", icon: "camera-outline", label: t("workOrders.repair.tools.evidence"), value: t("workOrders.repair.tools.photos", { count: photoCount }), active: true, needsConnection: false });
  tiles.push({ id: "parts", icon: "construct-outline", label: t("workOrders.repair.tools.parts"), value: t("workOrders.repair.tools.partsCount", { count: partsCount }), active: true, needsConnection: false });
  if (can.note) tiles.push({ id: "note", icon: "create-outline", label: t("workOrders.repair.tools.note"), value: t("workOrders.repair.tools.addNote"), active: true, needsConnection: true });

  return (
    <View testID="wo-tools">
      <SectionHeader title={t(closed ? "workOrders.repair.tools.recordTitle" : "workOrders.repair.tools.title")} />
      <View style={styles.grid}>
        {tiles.map((tile) => {
          const disabled = !tile.active || busy != null || (tile.needsConnection && !online);
          return (
            <Pressable
              key={tile.id}
              onPress={() => onTool(tile.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${tile.label}. ${tile.value}`}
              accessibilityState={{ disabled, busy: busy === tile.id }}
              testID={`wo-tool-${tile.id}`}
              style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border, opacity: disabled && tile.active ? 0.55 : 1 }]}
            >
              <Ionicons name={tile.icon} size={19} color={tile.active ? theme.primaryAction : theme.textMuted} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>{tile.label}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.value, { color: theme.textPrimary }]}>{tile.value}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexBasis: "47%", flexGrow: 1, minHeight: 88, borderWidth: 1, borderRadius: R.lg, padding: 12, gap: 3 },
  label: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2 },
  value: { fontSize: 14, fontWeight: "600" },
});
