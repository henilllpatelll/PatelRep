import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";

/**
 * Entry point for the work-order checklist. The mobile API exposes no work-order checklist yet (Phase 4), so this says
 * so plainly: no items, no progress count, nothing that could be read as a task being done.
 */
export function WorkOrderChecklistShell() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="wo-checklist-shell">
      <Ionicons name="list-outline" size={24} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={{ color: theme.textPrimary, fontSize: 16, fontWeight: "700" }}>
        {t("workOrders.repair.checklist.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5, lineHeight: 20, textAlign: "center" }}>
        {t("workOrders.repair.checklist.unavailable")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 20, alignItems: "center", gap: 8 },
});
