import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Body, Mark, Notice } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import type { MidshiftRoom } from "@/lib/housekeeping/assignmentMidshift";
import { changeText, destinationChangeText, nameOrFallback, protectedWhy, offersRoomBoard } from "@/lib/housekeeping/assignmentMidshiftText";
import type { MidshiftController } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* Small pieces shared by the three midshift steps. Nothing here decides anything: the controller and the pure
   domain do, these only draw. */

/** What moved under the supervisor, and the one way forward: refresh and look at the recalculated plan. */
export function ChangesNotice({ midshift, t }: { midshift: MidshiftController; t: Translate }) {
  const changes = midshift.changes;
  if (!changes) return null;
  const nameOf = (userId: string) => nameOrFallback(midshift.destinations.find((candidate) => candidate.userId === userId)?.name ?? null, t);
  return (
    <View style={styles.changes} testID="midshift-changed">
      <Notice tone="alert" icon="alert-circle-outline" live>
        {t("assignments.v2.midshift.changed.title")}
      </Notice>
      {changes.rooms.map((change) => (
        <Body key={change.roomId} tone="secondary" testID={`midshift-changed-room-${change.roomNumber || change.roomId}`}>
          {changeText(change, t)}
        </Body>
      ))}
      {changes.destinations.map((change) => (
        <Body key={change.userId} tone="secondary" testID={`midshift-changed-destination-${change.userId}`}>
          {destinationChangeText(change, nameOf(change.userId), t)}
        </Body>
      ))}
      <Button label={t("assignments.v2.midshift.changed.refresh")} variant="secondary" icon="refresh-outline" onPress={() => void midshift.refreshPlan()} testID="midshift-refresh" />
    </View>
  );
}

/** A room that cannot move, with the reason in words. A started room offers the Room Board to verify its real status. */
export function ProtectedRoomRow({ room, name, onOpenBoard, t }: { room: MidshiftRoom; name: string; onOpenBoard?: (roomId: string) => void; t: Translate }) {
  const theme = useTheme();
  const why = protectedWhy(room, name, t);
  return (
    <View
      style={[styles.protectedRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
      accessible
      accessibilityLabel={`${t("assignments.v2.card.roomLabel", { room: room.roomNumber })}. ${t("assignments.v2.midshift.protectedTag")}. ${why}`}
      testID={`midshift-protected-${room.roomNumber}`}
    >
      <View style={styles.protectedHead}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
          {room.roomNumber}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tag, { color: theme.textSecondary, borderColor: theme.border }]}>
          {t("assignments.v2.midshift.protectedTag")}
        </Text>
      </View>
      <Body tone="secondary" testID={`midshift-protected-why-${room.roomNumber}`}>
        {why}
      </Body>
      {offersRoomBoard(room) && onOpenBoard ? (
        <Pressable
          onPress={() => onOpenBoard(room.roomId)}
          accessibilityRole="button"
          accessibilityLabel={`${t("assignments.v2.midshift.select.openBoard")}, ${t("assignments.v2.card.roomLabel", { room: room.roomNumber })}`}
          style={styles.link}
          testID={`midshift-open-board-${room.roomNumber}`}
        >
          <Body strong style={{ color: theme.primaryAction }}>
            {t("assignments.v2.midshift.select.openBoard")}
          </Body>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A movable room: a large checkbox row. */
export function MovableRoomRow({ room, selected, onToggle, t }: { room: MidshiftRoom; selected: boolean; onToggle: (roomId: string) => void; t: Translate }) {
  const theme = useTheme();
  const { entry } = room;
  const parts = [
    entry.estimate ? t("assignments.v2.card.estimateShort", { minutes: Math.round(entry.estimate.minutes) }) : t("assignments.v2.assign.picker.noEstimate"),
    entry.room.building ? t("roomBoard.building", { building: entry.room.building }) : null,
    entry.room.floorKnown ? t("roomBoard.floor", { floor: entry.room.floor }) : null,
  ].filter((part): part is string => part !== null);
  const detail = parts.join(" · ");
  return (
    <Pressable
      onPress={() => onToggle(room.roomId)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${t("assignments.v2.card.roomLabel", { room: room.roomNumber })}. ${detail}`}
      accessibilityHint={t("assignments.v2.midshift.select.roomHint")}
      style={({ pressed }) => [styles.movableRow, { backgroundColor: theme.surface, borderColor: selected ? theme.primaryAction : theme.border }, pressed && { opacity: 0.85 }]}
      testID={`midshift-room-${room.roomNumber}`}
    >
      <Mark checked={selected} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
        {room.roomNumber}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textSecondary }]} numberOfLines={2}>
        {detail}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  changes: { gap: 8 },
  protectedRow: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  protectedHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { fontSize: 12, fontWeight: "800", borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  link: { minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start" },
  movableRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TARGET + 12, borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
  roomNumber: { fontFamily: monoFont, fontSize: 19, fontWeight: "800", minWidth: 52 },
  detail: { flex: 1, fontSize: 13.5, lineHeight: 19 },
});
