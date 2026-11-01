import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { RoomBoardRow } from "@/lib/engineering/roomModel";
import { AvailabilityBadge, MaintenanceBadge, OccupancyBadge, formatWhen, priorityColor } from "./roomUi";

interface Props {
  room: RoomBoardRow;
  locale: string;
  onPress: (roomId: string) => void;
}

function repairLabel(room: RoomBoardRow): string | null {
  const repair = room.top_repair;
  if (!repair) return null;
  const number = repair.work_order_number ? `WO-${String(repair.work_order_number).replace(/^WO-/i, "")}` : null;
  return [repair.title, number].filter(Boolean).join(" · ");
}

/** One room: its number, the four separate facts (occupancy, availability, active repairs, who holds them) and one tap to open it. */
export const RoomCard = memo(function RoomCard({ room, locale, onPress }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const summary = repairLabel(room);
  const down = room.availability != null;
  const rail = down ? (room.availability === "out_of_service" ? theme.status.pickup : theme.status.dirty) : room.top_priority === "emergency" || room.top_priority === "urgent" ? theme.status.dirty : theme.border;
  const context = [
    room.floor != null ? t("engRooms.floorShort", { floor: room.floor }) : null,
    room.building,
    room.room_type?.name,
  ].filter(Boolean).join(" · ");
  const a11y = [
    t("engRooms.roomLabel", { room: room.room_number }),
    t(`engRooms.occupancy.${room.occupancy}`),
    room.availability ? t(`engRooms.availability.${room.availability}`) : null,
    room.active_repair_count ? t("engRooms.maintenanceActive", { count: room.active_repair_count }) : t("engRooms.noActiveRepair"),
  ].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={() => onPress(room.id)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={t("engRooms.viewRoom")}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: rail, opacity: pressed ? 0.85 : 1 }]}
      testID={`room-card-${room.room_number}`}
    >
      <View style={styles.top}>
        <View style={styles.titleBlock}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
            {t("engRooms.roomKicker")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.number, { color: theme.textPrimary }]} numberOfLines={1}>
            {room.room_number}
          </Text>
          {context ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.context, { color: theme.textMuted }]} numberOfLines={1}>
              {context}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>

      <View style={styles.badges}>
        <OccupancyBadge occupancy={room.occupancy} />
        {room.availability ? <AvailabilityBadge availability={room.availability} /> : null}
        {room.active_repair_count > 0 ? <MaintenanceBadge count={room.active_repair_count} priority={room.top_priority} /> : null}
      </View>

      {summary ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: priorityColor(room.top_priority, theme) }]} numberOfLines={2}>
          {summary}
          {room.active_repair_count > 1 ? `  ${t("engRooms.moreRepairs", { count: room.active_repair_count - 1 })}` : ""}
        </Text>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: theme.textMuted }]}>
          {t("engRooms.noActiveRepair")}
        </Text>
      )}

      {room.others_active_count > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
          {t("engRooms.withColleagues", { count: room.others_active_count })}
        </Text>
      ) : null}

      {room.unavailability?.expected_return_at ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.small, { color: room.unavailability.is_past_eta ? theme.status.dirty : theme.textMuted, fontWeight: room.unavailability.is_past_eta ? "700" : "400" }]}
        >
          {room.unavailability.is_past_eta
            ? t("engRooms.returnOverdue", { time: formatWhen(room.unavailability.expected_return_at, locale) })
            : t("engRooms.expectedBack", { time: formatWhen(room.unavailability.expected_return_at, locale) })}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 14, padding: 14, gap: 9 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleBlock: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  number: { fontSize: 24, lineHeight: 28, fontWeight: "700" },
  context: { fontSize: 12.5, marginTop: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  summary: { fontSize: 13.5, fontWeight: "600" },
  small: { fontSize: 12.5 },
});
