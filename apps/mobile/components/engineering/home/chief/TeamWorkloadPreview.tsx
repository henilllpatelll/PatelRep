import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { R } from "@/components/shared/tokens";
import { workloadPreview, type WorkloadRow } from "@/lib/engineering/chiefHomeModel";
import type { Technician } from "@/lib/api/engineeringTeam";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MAX_FONT, HOME_MIN_TOUCH, homeStyles } from "../homeStyles";

interface Props {
  technicians: readonly Technician[];
  onOpenTechnician: (userId: string) => void;
  onViewTeam: () => void;
}

function detail(tech: Technician, t: (key: string, o?: Record<string, unknown>) => string): string {
  const parts = [t("engineeringTeam.load.active", { count: tech.active })];
  if (tech.urgent > 0) parts.push(t("engineeringTeam.load.urgent", { count: tech.urgent }));
  if (tech.overdue > 0) parts.push(t("engineeringTeam.load.overdue", { count: tech.overdue }));
  if (tech.on_hold > 0) parts.push(t("engineeringTeam.load.onHold", { count: tech.on_hold }));
  return parts.join(" · ");
}

function Row({ row, onOpen }: { row: WorkloadRow; onOpen: (userId: string) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const text = detail(row.tech, t as never);
  return (
    <Pressable
      onPress={() => onOpen(row.tech.user_id)}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}. ${text}. ${t("engineeringTeam.viewWorkFor", { name: row.name })}`}
      style={styles.row}
      testID={`workload-${row.tech.user_id}`}
    >
      <View style={styles.rowTop}>
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={1} style={[styles.name, { color: theme.textPrimary }]}>
          {row.name}
        </Text>
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.count, { color: theme.textPrimary }]}>
          {row.tech.active}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </View>
      {/* Bar = this person's active jobs relative to the busiest person listed. The number beside it is the real fact. */}
      <View style={[styles.track, { backgroundColor: theme.surfaceSubtle }]} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${Math.round(row.ratio * 100)}%`, backgroundColor: theme.primaryAction }]} testID={`workload-bar-${row.tech.user_id}`} />
      </View>
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: row.tech.urgent > 0 || row.tech.overdue > 0 ? theme.status.dirty : theme.textMuted }]}>
        {text}
      </Text>
    </Pressable>
  );
}

/**
 * A short look at who is carrying what. Job counts only: no shift, clock-in or capacity data exists, so nothing here says
 * a person is free, busy or overloaded. Everyone is in Team Overview.
 */
export function TeamWorkloadPreview({ technicians, onOpenTechnician, onViewTeam }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { rows, total } = workloadPreview(technicians, t("engineeringTeam.technician"));
  return (
    <View style={styles.section} testID="chief-workload">
      <View style={styles.titleRow}>
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[homeStyles.sectionTitle, { color: theme.textMuted, flex: 1 }]}>
          {t("home.chief.workloadTitle")}
        </Text>
        <Pressable onPress={onViewTeam} accessibilityRole="button" style={styles.viewTeam} testID="workload-view-team">
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.primaryAction }]}>
            {total > rows.length ? t("home.chief.viewTeamCount", { count: total }) : t("home.chief.viewTeam")}
          </Text>
        </Pressable>
      </View>
      <Card style={styles.card}>
        {rows.length === 0 ? (
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textMuted }]} testID="workload-empty">
            {t("engineeringTeam.noTechnicians")}
          </Text>
        ) : (
          rows.map((row) => <Row key={row.tech.user_id} row={row} onOpen={onOpenTechnician} />)
        )}
        {rows.length > 0 ? (
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textDisabled }]}>
            {t("home.chief.workloadNote")}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  viewTeam: { minHeight: HOME_MIN_TOUCH, justifyContent: "center", paddingLeft: 8 },
  card: { gap: 12, padding: 14 },
  row: { gap: 6, minHeight: HOME_MIN_TOUCH },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: "700" },
  count: { fontSize: 15, fontWeight: "800" },
  track: { height: 6, borderRadius: R.md, overflow: "hidden" },
  fill: { height: 6, borderRadius: R.md },
});
