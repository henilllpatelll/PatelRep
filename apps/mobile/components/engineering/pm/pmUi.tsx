import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { formatDueDate, type PmDueState, type PmScheduleView } from "@/lib/engineering/pmSchedules";

export function useDueTone(state: PmDueState): { fg: string; bg: string } {
  const theme = useTheme();
  switch (state) {
    case "overdue":
      return { fg: theme.status.dirty, bg: theme.status.dirtySoft };
    case "due_today":
      return { fg: theme.status.pickup, bg: theme.status.pickupSoft };
    case "due_soon":
    case "upcoming":
      return { fg: theme.status.clean, bg: theme.status.cleanSoft };
    default:
      return { fg: theme.textMuted, bg: theme.surfaceSubtle };
  }
}

/** "3 days overdue" / "Due today" / "Due Nov 4" / "No due date". Overdue is a plain fact, not an emergency. */
export function dueLabel(schedule: PmScheduleView, t: TFunction, language?: string): string {
  if (schedule.state === "overdue" && schedule.daysUntilDue != null) return t("pm.overdueBy", { count: Math.abs(schedule.daysUntilDue) });
  if (schedule.state === "due_today") return t("pmSchedules.dueToday");
  const date = formatDueDate(schedule.dueDate, language);
  return date ? t("pmSchedules.dueOn", { date }) : t("pmSchedules.unscheduled");
}

export function frequencyLabel(schedule: PmScheduleView, t: TFunction): string | null {
  if (schedule.intervalType === "custom" && schedule.intervalDays) return t("pmSchedules.everyDays", { count: schedule.intervalDays });
  return schedule.intervalType ? t(`pmSchedules.interval.${schedule.intervalType}`) : null;
}

export function locationLabel(schedule: PmScheduleView, t: TFunction): string | null {
  return schedule.location ?? (schedule.roomNumber ? t("workQueue.roomLabel", { room: schedule.roomNumber }) : null);
}

/** Small icon + text pair used for card meta rows. */
export function Meta({ icon, text, color }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string; color?: string }) {
  const theme = useTheme();
  const tint = color ?? theme.textMuted;
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={13} color={tint} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metaText, { color: tint }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12 },
});
