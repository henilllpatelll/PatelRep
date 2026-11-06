import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { RepairProgress, StageState } from "@/lib/engineering/repairProgress";

const ICON: Record<StageState, "checkmark-circle" | "ellipse" | "ellipse-outline" | "pause-circle" | "remove-circle-outline"> = {
  done: "checkmark-circle",
  current: "ellipse",
  pending: "ellipse-outline",
  paused: "pause-circle",
  unknown: "remove-circle-outline",
};

/**
 * Claim → Diagnose → Repair → Verify → Complete. Each stage is spoken as well as drawn ("Diagnose: not recorded"),
 * so state never rests on colour or shape alone. Unknown stages are neutral dashes, never checkmarks.
 */
export function WorkOrderProgress({ progress }: { progress: RepairProgress }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const summary = progress.stages.map((s) => `${t(`workOrders.repair.progress.stage.${s.id}`)}: ${t(`workOrders.repair.progress.state.${s.state}`)}`).join(", ");

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
      accessible
      accessibilityLabel={`${t("workOrders.repair.progress.title")}. ${progress.cancelled ? t("workOrders.repair.progress.cancelled") : summary}`}
      testID="wo-progress"
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, x.label, { color: theme.textMuted }]}>{t("workOrders.repair.progress.title")}</Text>
      <View style={styles.row}>
        {progress.stages.map((stage, index) => {
          const color = stage.state === "done" ? theme.primaryAction : stage.state === "current" ? theme.primaryAction : stage.state === "paused" ? theme.status.pickup : theme.textDisabled;
          return (
            <View key={stage.id} style={styles.stage} testID={`wo-progress-${stage.id}`}>
              <View style={styles.track}>
                <View style={[styles.line, index === 0 && styles.hidden, { backgroundColor: theme.borderSubtle }]} />
                <Ionicons name={ICON[stage.state]} size={20} color={color} />
                <View style={[styles.line, index === progress.stages.length - 1 && styles.hidden, { backgroundColor: theme.borderSubtle }]} />
              </View>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ color: stage.state === "pending" || stage.state === "unknown" ? theme.textMuted : theme.textPrimary, fontSize: 11.5, fontWeight: stage.state === "current" ? "800" : "600" }}
              >
                {t(`workOrders.repair.progress.stage.${stage.id}`)}
              </Text>
            </View>
          );
        })}
      </View>
      {progress.cancelled ? <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{t("workOrders.repair.progress.cancelled")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  title: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  row: { flexDirection: "row" },
  stage: { flex: 1, alignItems: "center", gap: 4 },
  track: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  line: { flex: 1, height: 2, borderRadius: 1 },
  hidden: { opacity: 0 },
});
