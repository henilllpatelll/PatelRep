import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { monoFont } from "@/components/shared/tokens";
import { AIBriefingCard } from "@/components/shared/evening";
import { useHousekeeperAccent, useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import type { ShiftRecap } from "@/lib/ai/shiftRecap";

export interface HandoffRoom {
  roomNumber: string;
  workOrderId: string;
  title: string | null;
}

interface Props {
  message: string;
  subMessage: string;
  roomsCleanedLabel: string;
  shiftDurationLabel: string | null;
  clockOutLabel: string;
  clockedOutLabel: string;
  clockedOut: boolean;
  clockingOut: boolean;
  onClockOut: () => void;
  /** AI recap card — null until fetchShiftRecap resolves (or fails and falls
   *  back to the local heuristic, which still returns a real value). */
  aiRecap: ShiftRecap | null;
  aiRecapLoading: boolean;
  /** Rooms this housekeeper cleaned today that still have an open work order
   *  attached — a real signal already carried on Room, no fabricated data. */
  handoffRooms: HandoffRoom[];
  /** Count of lost & found items this housekeeper logged today. */
  foundItemsCount: number;
  onOpenWorkOrder: (workOrderId: string) => void;
  onOpenLostFound: () => void;
  beforeClockOutLabel: string;
  handoffLabel: (room: HandoffRoom) => string;
  foundItemsLabel: (count: number) => string;
  aiRecapKicker: string;
  aiRecapFootNoteAi: string;
  aiRecapFootNoteLocal: string;
}

/** Home's stage==="done" state — every assigned room handled. The core stats
 *  (rooms cleaned, shift duration) are both derived from real myRooms/shift
 *  data, never invented — there's no per-room pass-rate or pace-average
 *  tracked client-side, so those mockup stats are intentionally left out.
 *  The AI recap and before-you-clock-out checklist are real too: the recap
 *  falls back to a deterministic on-device summary, and the checklist only
 *  ever surfaces work orders / lost-found items that actually exist. */
export function EndOfShiftState({
  message,
  subMessage,
  roomsCleanedLabel,
  shiftDurationLabel,
  clockOutLabel,
  clockedOutLabel,
  clockedOut,
  clockingOut,
  onClockOut,
  aiRecap,
  aiRecapLoading,
  handoffRooms,
  foundItemsCount,
  onOpenWorkOrder,
  onOpenLostFound,
  beforeClockOutLabel,
  handoffLabel,
  foundItemsLabel,
  aiRecapKicker,
  aiRecapFootNoteAi,
  aiRecapFootNoteLocal,
}: Props) {
  const theme = useTheme();
  const accent = useHousekeeperAccent();
  const showChecklist = handoffRooms.length > 0 || foundItemsCount > 0;

  return (
    <View style={styles.wrap} testID="end-of-shift-state">
      <View style={[styles.summaryCard, { backgroundColor: theme.shell.bg }]}>
        <View style={styles.summaryHeader}>
          <Ionicons name="checkmark-circle" size={14} color={theme.status.ready} />
          <Text style={[styles.summaryKicker, { color: theme.shell.ink2 }]}>{message}</Text>
        </View>
        <View style={styles.statsRow}>
          <Text style={[styles.statValue, { color: theme.shell.ink }]}>{roomsCleanedLabel}</Text>
          {shiftDurationLabel ? (
            <Text style={[styles.statValue, styles.statMono, { color: theme.shell.ink }]}>{shiftDurationLabel}</Text>
          ) : null}
        </View>
        <Text style={[styles.subMessage, { color: theme.shell.ink2 }]}>{subMessage}</Text>
      </View>

      {aiRecap || aiRecapLoading ? (
        <AIBriefingCard
          kicker={aiRecapKicker}
          headline={aiRecap?.headline ?? ""}
          watchouts={aiRecap?.note ? [aiRecap.note] : undefined}
          loading={aiRecapLoading}
          footNote={aiRecap ? (aiRecap.source === "ai" ? aiRecapFootNoteAi : aiRecapFootNoteLocal) : undefined}
        />
      ) : null}

      {showChecklist ? (
        <View testID="end-of-shift-checklist">
          <Text style={[styles.checklistTitle, { color: theme.textMuted }]}>{beforeClockOutLabel}</Text>
          <View style={[styles.checklistCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
            {handoffRooms.map((room, index) => (
              <TouchableOpacity
                key={room.workOrderId}
                style={[
                  styles.checklistRow,
                  index < handoffRooms.length - 1 || foundItemsCount > 0
                    ? { borderBottomWidth: 1, borderBottomColor: theme.borderSubtle }
                    : null,
                ]}
                onPress={() => onOpenWorkOrder(room.workOrderId)}
                activeOpacity={0.8}
                testID={`end-of-shift-handoff-${room.roomNumber}`}
              >
                <View style={[styles.checklistIcon, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
                  <Ionicons name="build-outline" size={12} color={theme.status.pickup} />
                </View>
                <Text style={[styles.checklistText, { color: theme.textPrimary }]} numberOfLines={1}>
                  {handoffLabel(room)}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
              </TouchableOpacity>
            ))}
            {foundItemsCount > 0 ? (
              <TouchableOpacity
                style={styles.checklistRow}
                onPress={onOpenLostFound}
                activeOpacity={0.8}
                testID="end-of-shift-lost-found"
              >
                <View style={[styles.checklistIcon, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}>
                  <Ionicons name="briefcase-outline" size={12} color={theme.status.clean} />
                </View>
                <Text style={[styles.checklistText, { color: theme.textPrimary }]} numberOfLines={1}>
                  {foundItemsLabel(foundItemsCount)}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {clockedOut ? (
        <View style={[styles.clockedOutRow, { borderColor: theme.status.readyLine, backgroundColor: theme.status.readySoft }]}>
          <Ionicons name="checkmark-circle-outline" size={16} color={theme.status.ready} />
          <Text style={[styles.clockedOutText, { color: theme.status.ready }]}>{clockedOutLabel}</Text>
        </View>
      ) : (
        <Button
          label={clockOutLabel}
          onPress={onClockOut}
          loading={clockingOut}
          size="lg"
          testID="clock-out-button"
          style={[styles.clockOutBtn, { backgroundColor: accent.bg }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  summaryCard: {
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  summaryKicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  statsRow: { flexDirection: "row", alignItems: "baseline", gap: 18 },
  statValue: { fontSize: 26, fontWeight: "800", letterSpacing: -0.3 },
  statMono: { fontFamily: monoFont, fontSize: 20 },
  subMessage: { fontSize: 13, lineHeight: 18 },
  checklistTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  checklistCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 13,
  },
  checklistIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  checklistText: { flex: 1, fontSize: 13, fontWeight: "500" },
  clockOutBtn: { borderRadius: 12 },
  clockedOutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
  },
  clockedOutText: { fontSize: 14, fontWeight: "700" },
});
