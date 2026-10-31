import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { RoomAvailability, RoomOccupancy } from "@/lib/engineering/roomModel";
import type { WorkOrderPriority } from "@/lib/engineering/workOrders";

/* Presentation only. Guest occupancy, availability (OOO / OOS) and active repairs each get their own badge:
   they are different facts and are never merged into one "room status". Every badge carries an icon and a word. */

export function OccupancyBadge({ occupancy, testID }: { occupancy: RoomOccupancy; testID?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const icon = occupancy === "occupied" ? "person" : occupancy === "vacant" ? "person-outline" : "help-circle-outline";
  return (
    <View style={[styles.badge, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} testID={testID}>
      <Ionicons name={icon} size={13} color={theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textSecondary }]}>
        {t(`engRooms.occupancy.${occupancy}`)}
      </Text>
    </View>
  );
}

export function AvailabilityBadge({ availability, testID }: { availability: RoomAvailability; testID?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = availability === "out_of_service" ? theme.status.pickup : theme.status.dirty;
  const soft = availability === "out_of_service" ? theme.status.pickupSoft : theme.status.dirtySoft;
  return (
    <View style={[styles.badge, { backgroundColor: soft, borderColor: tone }]} testID={testID}>
      <Ionicons name={availability === "out_of_service" ? "remove-circle-outline" : "ban-outline"} size={13} color={tone} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: tone }]}>
        {t(`engRooms.availability.${availability}`)}
      </Text>
    </View>
  );
}

export function MaintenanceBadge({ count, priority, testID }: { count: number; priority: WorkOrderPriority | null; testID?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const hot = priority === "emergency" || priority === "urgent";
  const tone = hot ? theme.status.dirty : theme.status.clean;
  const soft = hot ? theme.status.dirtySoft : theme.status.cleanSoft;
  return (
    <View style={[styles.badge, { backgroundColor: soft, borderColor: tone }]} testID={testID}>
      <Ionicons name="construct-outline" size={13} color={tone} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: tone }]}>
        {t("engRooms.maintenanceActive", { count })}
      </Text>
    </View>
  );
}

export function priorityColor(priority: WorkOrderPriority | null | undefined, theme: ReturnType<typeof useTheme>): string {
  if (priority === "emergency" || priority === "urgent") return theme.status.dirty;
  if (priority === "low") return theme.textDisabled;
  return theme.textSecondary;
}

/** "Mar 3, 4:30 PM" in the device language. */
export function formatWhen(value: string | Date | null | undefined, locale: string): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDay(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  text: { fontSize: 12, fontWeight: "700" },
});
