import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { MAX_FONT_SCALE } from "./BottomSheet";

/** Out of order / out of service. Informational: a housekeeper cannot override it. */
export function UnavailableRoomView({ room }: { room: Room }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
  const workOrder = room.open_work_order_title
    ? `${room.open_work_order_title}${number}`
    : room.open_work_order_id
      ? t("rooms.detail.warnings.workOrder.detail")
      : null;

  return (
    <View style={styles.root} testID="unavailable-room-view">
      <View
        accessibilityRole="alert"
        style={[styles.hero, { backgroundColor: theme.status.outOfOrderSoft, borderColor: theme.status.outOfOrderLine }]}
      >
        <Ionicons name="close-circle" size={44} color={theme.status.outOfOrder} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {t("rooms.work.unavailable.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("rooms.work.unavailable.body")}
        </Text>
      </View>
      {workOrder ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="unavailable-work-order">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eyebrow, { color: theme.textMuted }]}>
            {t("rooms.work.unavailable.workOrder")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.workOrder, { color: theme.textPrimary }]}>
            {workOrder}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  hero: { borderWidth: 1.5, borderRadius: 18, padding: 20, alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "900", textAlign: "center" },
  body: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  workOrder: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
});
