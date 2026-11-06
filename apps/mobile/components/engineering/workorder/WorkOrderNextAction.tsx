import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { NextStepId } from "@/lib/engineering/repairProgress";

interface Props {
  step: NextStepId;
  /** The sticky bar carries the button for this step; the card only says what comes next and why. */
  barVisible: boolean;
}

/** Guidance, not a second control: the single actionable button stays in the sticky bar so the two can never disagree. */
export function WorkOrderNextAction({ step, barVisible }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const quiet = step === "viewRecord" || step === "cancelled" || step === "viewOnly" || step === "elsewhere";
  const hint = t(`workOrders.repair.next.${step}.hint`) + (barVisible && !quiet ? ` ${t("workOrders.repair.next.useBar")}` : "");

  return (
    <View
      style={[styles.card, { backgroundColor: quiet ? theme.surface : theme.primarySoft, borderColor: quiet ? theme.border : theme.primaryLine }]}
      accessible
      accessibilityLabel={`${t("workOrders.repair.next.title")}: ${t(`workOrders.repair.next.${step}.label`)}. ${hint}`}
      testID="wo-next-action"
    >
      <Ionicons name={quiet ? "information-circle-outline" : "arrow-forward-circle-outline"} size={22} color={quiet ? theme.textMuted : theme.primaryAction} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, x.label, { color: theme.textMuted }]}>{t("workOrders.repair.next.title")}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textPrimary, fontSize: 16, fontWeight: "800" }} testID="wo-next-label">
          {t(`workOrders.repair.next.${step}.label`)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 18 }}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1, borderRadius: R.lg, padding: 14 },
  kicker: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
});
