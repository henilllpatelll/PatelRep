import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { R, monoFont } from "@/components/shared/tokens";
import type { ReadyRoom } from "@/lib/api/inspections";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;
export type InspectionOutcome = "passed" | "failed" | "conditional";

/* One room waiting for inspection with its three outcome buttons. Shared by the queue list and the focused
   room card, so there is exactly one inspection control. It only reports which outcome was tapped. */
export function InspectQueueCard({
  room,
  timeSince,
  onOutcome,
  t,
  focused,
}: {
  room: ReadyRoom;
  timeSince: (iso: string | null) => string;
  onOutcome: (room: ReadyRoom, result: InspectionOutcome) => void;
  t: Translate;
  focused?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.queueCard, { backgroundColor: theme.surface, borderColor: focused ? theme.primaryAction : theme.border, shadowColor: theme.textPrimary }]}
      testID={`inspect-${room.room_number}`}
    >
      <View style={[styles.queueRail, { backgroundColor: theme.status.clean }]} />
      <View style={styles.queueBody}>
        <Text style={[styles.queueRoomNumber, { color: theme.textPrimary }]}>{room.room_number}</Text>
        <Text style={[styles.queueCleanedBy, { color: theme.textSecondary }]} numberOfLines={1}>
          {room.cleaned_by}
        </Text>
        <Text style={[styles.queueMeta, { color: theme.textMuted }]}>
          {t("inspect.doneAgo", { time: timeSince(room.cleaned_at) })}
          {room.clean_type ? ` · ${room.clean_type}` : ""}
        </Text>
      </View>
      <View style={styles.queueActions} collapsable={false}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.status.ready, borderColor: theme.status.ready }]}
          onPress={() => onOutcome(room, "passed")}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={t("inspect.confirmPass")}
        >
          <Ionicons name="checkmark" size={20} color={theme.onPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
          onPress={() => onOutcome(room, "conditional")}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={t("inspect.confirmTouchup")}
        >
          <Ionicons name="flash" size={17} color={theme.status.pickup} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
          onPress={() => onOutcome(room, "failed")}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={t("inspect.confirmFail")}
        >
          <Ionicons name="close" size={20} color={theme.status.dirty} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  queueCard: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  queueRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  queueBody: { flex: 1, minWidth: 0, gap: 2 },
  queueRoomNumber: { fontFamily: monoFont, fontSize: 24, lineHeight: 28, fontWeight: "800" },
  queueCleanedBy: { fontSize: 12.5, fontWeight: "700" },
  queueMeta: { fontSize: 11.5 },
  queueActions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1 },
});
