import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import type { AttentionItem, Technician } from "@/lib/api/engineeringTeam";
import { technicianName, workOrderCode, type SummaryTile } from "@/lib/engineering/teamModel";
import { useTheme } from "@/lib/theme/useTheme";

const FONT_CAP = 1.5;

/** One figure. "Needs attention" is a word on the tile, not only a colour. */
export function SummaryTileView({ tile, onPress }: { tile: SummaryTile; onPress?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const unknown = tile.value === null;
  const value = unknown ? "—" : String(tile.value);
  const label = t(`engineeringTeam.tiles.${tile.key}`);
  const content = (
    <>
      <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.tileValue, { color: tile.alert ? theme.status.dirty : theme.textPrimary }]}>
        {value}
      </Text>
      <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.tileLabel, { color: theme.textMuted }]} numberOfLines={2}>
        {label}
      </Text>
      {unknown ? (
        <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.tileHint, { color: theme.textMuted }]}>
          {t("engineeringTeam.tiles.unknown")}
        </Text>
      ) : null}
    </>
  );
  const style = [styles.tile, { backgroundColor: theme.surface, borderColor: tile.alert ? theme.status.dirtyLine : theme.border }];
  const a11y = unknown ? `${label}: ${t("engineeringTeam.tiles.unknown")}` : `${label}: ${tile.value}${tile.alert ? `. ${t("engineeringTeam.needsAttention")}` : ""}`;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={style} testID={`team-tile-${tile.key}`}>
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={a11y} style={style} testID={`team-tile-${tile.key}`}>
      {content}
    </View>
  );
}

/** A "needs attention" row. Opens the real work order. */
export function AttentionRow({ item, onOpen, onAssign }: { item: AttentionItem; onOpen: () => void; onAssign?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const code = workOrderCode(item);
  const reason = t(`engineeringTeam.attention.${item.kind}`);
  const detail =
    item.kind === "on_hold"
      ? [item.hold_reason_code ? t(`workOrders.holdReason.${item.hold_reason_code}`, { defaultValue: t("workQueue.holdReasonOther") }) : t("workQueue.holdReasonUnrecorded"), item.assigned_to_name]
          .filter(Boolean)
          .join(" · ")
      : item.assigned_to_name
        ? t("workQueue.assignedTo", { name: item.assigned_to_name })
        : t("workQueue.unassigned");
  const urgent = item.kind === "emergency_unassigned" || item.kind === "urgent_overdue";
  return (
    <Card style={styles.attention}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={[reason, code, item.room_number ? t("workQueue.roomLabel", { room: item.room_number }) : null, item.title, detail].filter(Boolean).join(", ")}
        style={styles.attentionMain}
        testID={`team-attention-${item.id}`}
      >
        <View style={styles.attentionTop}>
          <Ionicons name={urgent ? "alert-circle" : "pause-circle-outline"} size={16} color={urgent ? theme.status.dirty : theme.status.pickup} />
          <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.reason, { color: urgent ? theme.status.dirty : theme.status.pickup }]}>
            {reason}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.attentionTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.attentionMeta, { color: theme.textMuted }]} numberOfLines={2}>
          {[code, item.room_number ? t("workQueue.roomLabel", { room: item.room_number }) : null, detail].filter(Boolean).join(" · ")}
        </Text>
      </Pressable>
      {onAssign ? (
        <Pressable
          onPress={onAssign}
          accessibilityRole="button"
          accessibilityLabel={`${item.assigned_to ? t("engineeringTeam.assign.reassignTitle") : t("engineeringTeam.assign.title")}: ${item.title}`}
          style={[styles.assignBtn, { borderColor: theme.border }]}
          testID={`team-attention-assign-${item.id}`}
        >
          <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.assignText, { color: theme.primaryAction }]}>
            {item.assigned_to ? t("engineeringTeam.assign.reassignShort") : t("engineeringTeam.assign.assignShort")}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** One technician: plain counts and a way to see their work. No presence or availability is shown (none is recorded). */
export function TechnicianCard({ tech, onViewWork }: { tech: Technician; onViewWork: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const name = technicianName(tech, t("engineeringTeam.technician"));
  const lines = [t("engineeringTeam.load.active", { count: tech.active })];
  if (tech.urgent > 0) lines.push(t("engineeringTeam.load.urgent", { count: tech.urgent }));
  if (tech.on_hold > 0) lines.push(t("engineeringTeam.load.onHold", { count: tech.on_hold }));
  if (tech.overdue > 0) lines.push(t("engineeringTeam.load.overdue", { count: tech.overdue }));
  return (
    <Card style={styles.techCard}>
      <View style={styles.techText}>
        <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.techName, { color: theme.textPrimary }]} numberOfLines={1}>
          {name}
        </Text>
        <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.techLoad, { color: tech.urgent > 0 || tech.overdue > 0 ? theme.status.dirty : theme.textMuted }]}>
          {lines.join(" · ")}
        </Text>
      </View>
      <Pressable
        onPress={onViewWork}
        accessibilityRole="button"
        accessibilityLabel={t("engineeringTeam.viewWorkFor", { name })}
        style={[styles.assignBtn, { borderColor: theme.border }]}
        testID={`team-tech-${tech.user_id}`}
      >
        <Text maxFontSizeMultiplier={FONT_CAP} style={[styles.assignText, { color: theme.primaryAction }]}>
          {t("engineeringTeam.viewWork")}
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 96, minHeight: 84, borderWidth: 1, borderRadius: 14, padding: 12, justifyContent: "center", gap: 2 },
  tileValue: { fontSize: 26, fontWeight: "800" },
  tileLabel: { fontSize: 12.5, fontWeight: "600" },
  tileHint: { fontSize: 11 },
  attention: { flexDirection: "row", alignItems: "center", gap: 8, padding: 0, overflow: "hidden" },
  attentionMain: { flex: 1, minWidth: 0, padding: 14, gap: 3 },
  attentionTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  reason: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  attentionTitle: { fontSize: 15.5, fontWeight: "700", lineHeight: 21 },
  attentionMeta: { fontSize: 12.5 },
  assignBtn: { minHeight: 44, minWidth: 64, marginRight: 12, paddingHorizontal: 12, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  assignText: { fontSize: 13.5, fontWeight: "800" },
  techCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  techText: { flex: 1, minWidth: 0, gap: 2 },
  techName: { fontSize: 16, fontWeight: "800" },
  techLoad: { fontSize: 13 },
});
