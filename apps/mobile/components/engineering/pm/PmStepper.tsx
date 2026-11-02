import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { PM_SECTIONS, type PmSection, type PmSectionStatus } from "@/lib/engineering/pmChecklist";

interface Props {
  current: PmSection;
  status: Record<PmSection, PmSectionStatus>;
  onSelect: (section: PmSection) => void;
}

/**
 * The four parts of an inspection as a row of tabs. Moving between them never touches the draft, so nothing recorded is
 * lost; the status of each part is drawn as an icon and spelled out for screen readers, never colour alone.
 */
export function PmStepper({ current, status, onSelect }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityRole="tablist" accessibilityLabel={t("pm.stepper.label")} testID="pm-stepper">
      {PM_SECTIONS.map((section, index) => {
        const selected = section === current;
        const state = status[section];
        const tone = state === "attention" ? theme.status.dirty : state === "complete" ? theme.status.ready : theme.textMuted;
        const icon = state === "attention" ? "alert-circle" : state === "complete" ? "checkmark-circle" : "ellipse-outline";
        const name = t(`pm.stepper.${section}`);
        const spoken = [t("pm.stepper.position", { current: index + 1, total: PM_SECTIONS.length, name }), state === "complete" ? t("pm.stepper.complete") : state === "attention" ? t("pm.stepper.attention") : null]
          .filter(Boolean)
          .join(", ");
        return (
          <Pressable
            key={section}
            onPress={() => onSelect(section)}
            style={[styles.tab, selected && { backgroundColor: theme.primarySoft }]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={spoken}
            testID={`pm-step-${section}`}
          >
            <Ionicons name={icon} size={18} color={tone} />
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.label, { color: selected ? theme.primaryAction : theme.textSecondary, fontWeight: selected ? "800" : "600" }]}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4, gap: 2 },
  tab: { flex: 1, minHeight: 52, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 2 },
  label: { fontSize: 12 },
});
