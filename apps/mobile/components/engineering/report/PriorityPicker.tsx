import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { REPORT_PRIORITIES } from "@/lib/engineering/reportIssue";
import type { WorkOrderPriority } from "@/lib/engineering/workOrders";

interface Props {
  value: WorkOrderPriority;
  emergencyConfirmed: boolean;
  onChange: (priority: WorkOrderPriority) => void;
  onConfirmEmergency: (confirmed: boolean) => void;
  showErrors: boolean;
  disabled?: boolean;
}

/** The same four priorities, words and colours as the Work tab. Emergency needs a second, deliberate tick. */
export function PriorityPicker({ value, emergencyConfirmed, onChange, onConfirmEmergency, showErrors, disabled }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = (priority: WorkOrderPriority) => (priority === "emergency" || priority === "urgent" ? theme.status.dirty : priority === "low" ? theme.textMuted : theme.primaryAction);
  return (
    <View style={styles.stack} accessibilityRole="radiogroup" testID="report-priority">
      {REPORT_PRIORITIES.map((priority) => {
        const selected = value === priority;
        return (
          <Pressable
            key={priority}
            onPress={() => onChange(priority)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={`${t(`workQueue.priority.${priority}`)}. ${t(`report.priority.hints.${priority}`)}`}
            testID={`report-priority-${priority}`}
            style={[styles.row, { borderColor: selected ? tone(priority) : theme.border, backgroundColor: selected ? theme.surfaceSubtle : theme.surface, opacity: disabled ? 0.6 : 1 }]}
          >
            <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? tone(priority) : theme.textMuted} />
            <View style={styles.body}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: tone(priority) }]}>
                {t(`workQueue.priority.${priority}`)}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t(`report.priority.hints.${priority}`)}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {value === "emergency" ? (
        <Pressable
          onPress={() => onConfirmEmergency(!emergencyConfirmed)}
          disabled={disabled}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: emergencyConfirmed }}
          testID="report-emergency-confirm"
          style={[styles.confirm, { borderColor: showErrors && !emergencyConfirmed ? theme.status.dirty : theme.border, backgroundColor: theme.status.dirtySoft }]}
        >
          <Ionicons name={emergencyConfirmed ? "checkbox" : "square-outline"} size={22} color={theme.status.dirty} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.confirmText, { color: theme.textPrimary }]}>
            {t("report.priority.emergencyConfirm")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  body: { flex: 1 },
  label: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12.5, marginTop: 1 },
  confirm: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  confirmText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
});
