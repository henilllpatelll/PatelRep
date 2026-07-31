import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";

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
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      // Back-button press does nothing — the housekeeper must explicitly confirm
      onRequestClose={() => undefined}
    >
      <ScrollView
        style={{ backgroundColor: theme.shell.bg }}
        contentContainerStyle={styles.root}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconRow}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
            ]}
          >
            <Ionicons name="hand-left-outline" size={42} color={theme.status.pickup} />
          </View>
        </View>

        <Text style={[styles.title, { color: theme.shell.ink }]}>{t("rooms.detail.knock.title")}</Text>

        <View style={styles.stepsList}>
          {KNOCK_STEPS.map((key, index) => (
            <View
              key={key}
              style={[styles.stepRow, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}
            >
              <View style={[styles.stepNum, { backgroundColor: theme.status.pickup }]}>
                <Text style={[styles.stepNumText, { color: theme.onPrimary }]}>{index + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: theme.shell.ink }]}>{t(key)}</Text>
            </View>
          ))}
        </View>

        <Button
          label={t("rooms.detail.knock.cta")}
          onPress={onConfirm}
          icon="checkmark-circle-outline"
          size="lg"
          style={styles.ctaBtn}
        />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
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
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  stepsList: { width: "100%", gap: 12 },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumText: { fontSize: 12, fontWeight: "900" },
  stepText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  ctaBtn: {
    width: "100%",
    borderRadius: 16,
  },
});
