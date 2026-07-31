import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";

export type StatusKey =
  | "ready"
  | "clean"
  | "dirty"
  | "occupied"
  | "pickup"
  | "outOfOrder"
  | "emergency"
  | "urgent"
  | "low"
  | "onHold"
  | "overdue"
  | "inProgress"
  | "completed";

interface StatusBadgeProps {
  statusKey: StatusKey;
  /** Caller-provided, already-translated label. No default and no internal translation call. */
  label: string;
  style?: StyleProp<ViewStyle>;
}

/** StatusBadge — formalizes WorkOrderCard's icon+color+label convention into
 * one component driven by a statusKey prop. Covers BOTH room-status states
 * and work-order priority/SLA states (D-10). Always renders icon + label +
 * color together — no icon-only mode (D-11). Colors resolve through
 * useTheme().status from day one (D-12) — never an inline status hex. */
export function StatusBadge({ statusKey, label, style }: StatusBadgeProps) {
  const theme = useTheme();
  const s = theme.status;

  const meta: Record<
    StatusKey,
    { icon: React.ComponentProps<typeof Ionicons>["name"]; bg: string; fg: string; border: string }
  > = {
    ready: { icon: "checkmark-circle", bg: s.readySoft, fg: s.ready, border: s.readyLine },
    clean: { icon: "checkmark-done-outline", bg: s.cleanSoft, fg: s.clean, border: s.cleanLine },
    dirty: { icon: "brush-outline", bg: s.dirtySoft, fg: s.dirty, border: s.dirtyLine },
    occupied: { icon: "person-outline", bg: s.dirtySoft, fg: s.occupied, border: s.dirtyLine },
    pickup: { icon: "alert-circle-outline", bg: s.pickupSoft, fg: s.pickup, border: s.pickupLine },
    outOfOrder: {
      icon: "close-circle-outline",
      bg: s.outOfOrderSoft,
      fg: s.outOfOrder,
      border: s.outOfOrderLine,
    },
    emergency: { icon: "warning", bg: s.dirtySoft, fg: s.dirty, border: s.dirtyLine },
    urgent: { icon: "flash", bg: s.dirtySoft, fg: s.dirty, border: s.dirtyLine },
    // "low" has no dedicated status token; nearest themed neutral (theme.textMuted)
    // keeps it theme-reactive per D-12 — do not inline the UI-SPEC's ink4 hex.
    low: { icon: "arrow-down", bg: theme.surfaceMuted, fg: theme.textMuted, border: theme.border },
    onHold: { icon: "pause-circle-outline", bg: s.pickupSoft, fg: s.pickup, border: s.pickupLine },
    overdue: { icon: "alert-circle", bg: s.dirtySoft, fg: s.dirty, border: s.dirtyLine },
    inProgress: {
      icon: "stopwatch-outline",
      bg: s.inProgressSoft,
      fg: s.inProgress,
      border: s.inProgressLine,
    },
    completed: { icon: "checkmark-circle", bg: s.readySoft, fg: s.ready, border: s.readyLine },
  };

  const { icon, bg, fg, border } = meta[statusKey];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.container, { backgroundColor: bg, borderColor: border }, style]}
    >
      <Ionicons name={icon} size={12} color={fg} accessible={false} />
      <Text accessible={false} style={[styles.label, { color: fg }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 22,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    flexShrink: 1,
  },
});
