import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { C, shellTokens } from "@/components/shared/tokens";

const KNOCK_STEPS = [
  "rooms.detail.knock.steps.step1",
  "rooms.detail.knock.steps.step2",
  "rooms.detail.knock.steps.step3",
  "rooms.detail.knock.steps.step4",
  "rooms.detail.knock.steps.step5",
] as const;

interface Props {
  visible: boolean;
  onConfirm: () => void;
}

export default function KnockModal({ visible, onConfirm }: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      // Back-button press does nothing — the housekeeper must explicitly confirm
      onRequestClose={() => undefined}
    >
      <View style={styles.root}>
        <View style={styles.iconRow}>
          <View style={styles.iconCircle}>
            <Ionicons name="hand-left-outline" size={42} color={C.caution} />
          </View>
        </View>

        <Text style={styles.title}>{t("rooms.detail.knock.title")}</Text>

        <View style={styles.stepsList}>
          {KNOCK_STEPS.map((key, index) => (
            <View key={key} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{t(key)}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.ctaBtn} onPress={onConfirm} activeOpacity={0.86}>
          <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
          <Text style={styles.ctaText}>{t("rooms.detail.knock.cta")}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: shellTokens.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 28,
  },
  iconRow: { alignItems: "center" },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.cautionSoft,
    borderWidth: 2,
    borderColor: C.cautionLine,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: shellTokens.ink,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  stepsList: { width: "100%", gap: 12 },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: shellTokens.raised,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: shellTokens.line,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.caution,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  stepText: { flex: 1, color: shellTokens.ink, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  ctaBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: C.accent,
    borderRadius: 16,
    minHeight: 56,
    paddingHorizontal: 24,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "900" },
});
