import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SectionHeader } from "@/components/shared/evening";
import { formatClock, type WorkOrder } from "@/lib/engineering/workOrders";
import type { RepairActions } from "@/lib/engineering/repairWorkspace";

export type ToolId = "arrive" | "acknowledge" | "labor" | "diagnosis" | "evidence" | "parts" | "note" | "resumeWork" | "hold" | "escalate" | "assist";

interface Props {
  wo: WorkOrder;
  actions: RepairActions;
  locale: string;
  online: boolean;
  busy: string | null;
  laborLabel: string;
  photoCount: number;
  partsCount: number;
  noteCount: number;
  /** Repair Assist is offered (feature switched on, allowed for this role and status). */
  assistable: boolean;
  onTool: (tool: ToolId) => void;
}

interface Row {
  id: ToolId;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  /** The row does something when pressed. A recorded fact (arrival time) is shown but not pressable. */
  active: boolean;
  needsConnection: boolean;
  destructive?: boolean;
}

/**
 * The Work tab: the repair tools as labelled rows, grouped by what the engineer is doing. Each shows its recorded
 * state; pressing opens the matching sheet or performs the one-tap action. Rows appear only when the state machine
 * allows them (or, for recorded facts, when the server has a value), so none is a dead button.
 */
export function WorkOrderRepairTools({ wo, actions, locale, online, busy, laborLabel, photoCount, partsCount, noteCount, assistable, onTool }: Props) {
  const { t } = useTranslation();
  const { can } = actions;
  const arrivedAt = formatClock(wo.arrived_at, locale);
  const ackAt = formatClock(wo.acknowledged_at, locale);
  const diagnosis = wo.problem_code?.label ?? wo.problem_other_text ?? null;
  const closed = actions.block === "closed";

  const site: Row[] = [];
  if (can.acknowledge || ackAt) {
    site.push({ id: "acknowledge", icon: "checkmark-done-outline", label: t("workOrders.repair.tools.acknowledge"), value: ackAt ? t("workOrders.repair.tools.acknowledgedAt", { time: ackAt }) : t("workOrders.repair.tools.tapToAcknowledge"), active: can.acknowledge && !ackAt, needsConnection: true });
  }
  if (can.arrive || arrivedAt) {
    site.push({ id: "arrive", icon: "location-outline", label: t("workOrders.repair.tools.arrive"), value: arrivedAt ? t("workOrders.repair.tools.arrivedAt", { time: arrivedAt }) : t("workOrders.repair.tools.tapToArrive"), active: can.arrive && !arrivedAt, needsConnection: true });
  }

  const repair: Row[] = [
    { id: "labor", icon: "timer-outline", label: t("workOrders.repair.tools.labor"), value: laborLabel, active: true, needsConnection: false },
    { id: "diagnosis", icon: "search-outline", label: t("workOrders.repair.tools.diagnosis"), value: diagnosis ?? t("workOrders.repair.tools.notRecorded"), active: can.diagnose, needsConnection: true },
    { id: "evidence", icon: "camera-outline", label: t("workOrders.repair.tools.evidence"), value: t("workOrders.repair.tools.photos", { count: photoCount }), active: true, needsConnection: false },
    { id: "parts", icon: "construct-outline", label: t("workOrders.repair.tools.parts"), value: t("workOrders.repair.tools.partsCount", { count: partsCount }), active: true, needsConnection: false },
  ];
  if (can.note) {
    repair.push({ id: "note", icon: "create-outline", label: t("workOrders.repair.tools.note"), value: noteCount > 0 ? t("workOrders.repair.tools.notesCount", { count: noteCount }) : t("workOrders.repair.tools.addNote"), active: true, needsConnection: true });
  }

  const more: Row[] = [];
  if (can.resumeWork) more.push({ id: "resumeWork", icon: "play-outline", label: t("workOrders.repair.more.resumeWork"), value: t("workOrders.repair.tools.resumeHint"), active: true, needsConnection: true });
  if (can.hold) more.push({ id: "hold", icon: "pause-outline", label: t("workOrders.repair.more.hold"), value: t("workOrders.repair.tools.holdHint"), active: true, needsConnection: true });
  if (can.escalate) more.push({ id: "escalate", icon: "alert-circle-outline", label: t("workOrders.repair.more.escalate"), value: t("workOrders.repair.tools.escalateHint"), active: true, needsConnection: true, destructive: true });
  if (assistable) more.push({ id: "assist", icon: "sparkles-outline", label: t("repairAssist.open"), value: t("workOrders.repair.tools.assistHint"), active: true, needsConnection: false });

  const groups: { key: string; title: string; rows: Row[] }[] = [
    { key: "site", title: t("workOrders.repair.work.site"), rows: site },
    { key: "repair", title: t(closed ? "workOrders.repair.tools.recordTitle" : "workOrders.repair.work.repair"), rows: repair },
    { key: "more", title: t("workOrders.repair.work.more"), rows: more },
  ].filter((g) => g.rows.length > 0);

  return (
    <View testID="wo-tools" style={{ gap: 4 }}>
      {groups.map((group) => (
        <View key={group.key} testID={`wo-tools-${group.key}`}>
          <SectionHeader title={group.title} />
          <ToolGroup rows={group.rows} online={online} busy={busy} onTool={onTool} />
        </View>
      ))}
    </View>
  );
}

function ToolGroup({ rows, online, busy, onTool }: { rows: Row[]; online: boolean; busy: string | null; onTool: (tool: ToolId) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {rows.map((row, index) => {
        const disabled = !row.active || busy != null || (row.needsConnection && !online);
        const tint = row.destructive ? theme.status.dirty : row.active ? theme.primaryAction : theme.textMuted;
        return (
          <Pressable
            key={row.id}
            onPress={() => onTool(row.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}. ${row.value}`}
            accessibilityState={{ disabled, busy: busy === row.id }}
            testID={`wo-tool-${row.id}`}
            style={[styles.row, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: 1 }, { opacity: disabled && row.active ? 0.55 : 1 }]}
          >
            <Ionicons name={row.icon} size={20} color={tint} />
            <View style={styles.text}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: row.destructive ? theme.status.dirty : theme.textPrimary, fontSize: 15, fontWeight: "700" }}>{row.label}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={{ color: theme.textMuted, fontSize: 13 }}>{row.value}</Text>
            </View>
            {row.active ? <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10 },
  text: { flex: 1, gap: 1 },
});
