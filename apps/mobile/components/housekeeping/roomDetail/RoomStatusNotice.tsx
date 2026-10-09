import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { AttentionCode } from "@/lib/housekeeping/needsAttention";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  /** Informational reasons from the resolver, strongest first. */
  advisories: AttentionCode[];
}

/**
 * The ONE operational warning Room Detail leads with when nothing blocks entry.
 * Hard restrictions and access problems have their own panels; this is for the
 * open work order, high risk or a note — never several at once.
 */
export function RoomStatusNotice({ room, advisories }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  const top = advisories[0];
  if (!top) return null;

  let title: string;
  let detail: string;
  if (top === "work_order") {
    const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
    title = t("rooms.detail.warnings.workOrder.label");
    detail = room.open_work_order_title ? `${room.open_work_order_title}${number}` : t("rooms.detail.warnings.workOrder.detail");
  } else if (top === "high_risk") {
    title = t("rooms.detail.warnings.risk.label");
    detail = t("rooms.detail.warnings.risk.detail");
  } else {
    title = t("rooms.detail.warnings.note.label");
    detail = room.latest_note?.trim() ?? "";
  }

  return (
    <View
      testID="room-status-notice"
      accessible
      accessibilityLabel={`${title}. ${detail}`}
      style={[styles.root, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
    >
      <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} />
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.status.pickup }]}>
          {title}
        </Text>
        {detail ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textPrimary }]}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  detail: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
