import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { HOLD_REASON_CODES, type HoldReasonCode } from "@/lib/engineering/workOrders";

interface Props {
  visible: boolean;
  onSelect: (reason: HoldReasonCode) => void;
  onCancel: () => void;
}

/** The API requires a structured reason to put a work order on hold, so the engineer picks one — it is never guessed. */
export function HoldReasonSheet({ visible, onSelect, onCancel }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={t("common.cancel")}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 16 }]}
          onPress={() => undefined}
          testID="hold-reason-sheet"
        >
          <Text style={[styles.title, { color: theme.textPrimary }]}>{t("workOrders.holdReason.title")}</Text>
          {HOLD_REASON_CODES.map((code) => (
            <Pressable
              key={code}
              style={({ pressed }) => [styles.row, { borderColor: theme.borderSubtle, opacity: pressed ? 0.7 : 1 }]}
              onPress={() => onSelect(code)}
              accessibilityRole="button"
              testID={`hold-reason-${code}`}
            >
              <Text style={[styles.rowText, { color: theme.textPrimary }]}>{t(`workOrders.holdReason.${code}`)}</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
            </Pressable>
          ))}
          <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button">
            <Text style={[styles.cancelText, { color: theme.textMuted }]}>{t("common.cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 18, gap: 4 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
  },
  rowText: { fontSize: 15 },
  cancel: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: "700" },
});
