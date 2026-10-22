import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { AttendanceChip, CapacityMeter, NoteLine } from "@/components/supervisor/assignments/TeamParts";
import type { StaffRoomPhase, TeamCardModel } from "@/lib/housekeeping/assignmentTeamView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A glyph beside the room number, so a room's stage is never colour alone. */
const PHASE_ICON: Record<StaffRoomPhase, string> = {
  in_progress: "ellipse",
  not_started: "ellipse-outline",
  completed: "checkmark-circle",
  unavailable: "ban-outline",
  unknown: "help-circle-outline",
};

/**
 * One housekeeper: who, whether they are verifiably working, how much is on their plate and how much room they
 * have left. Compact on purpose — a preview of a few room numbers, never every room (the drawer has those).
 */
function TeamStaffCardView({ model, onOpen, t }: { model: TeamCardModel; onOpen: (userId: string) => void; t: Translate }) {
  const theme = useTheme();
  const phaseColor = (phase: StaffRoomPhase) => (phase === "completed" ? theme.status.ready : phase === "in_progress" ? theme.status.pickup : theme.textSecondary);
  return (
    <Pressable
      onPress={() => onOpen(model.userId)}
      accessibilityRole="button"
      accessibilityLabel={model.a11yLabel}
      accessibilityHint={t("assignments.v2.team.openHint")}
      testID={`team-card-${model.userId}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.top}>
        <Avatar name={model.unnamed ? "?" : model.name} size={40} />
        <View style={styles.identity}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.name, { color: theme.textPrimary }]} testID={`team-card-name-${model.userId}`}>
            {model.name}
          </Text>
          <AttendanceChip badge={model.attendance} testID={`team-card-attendance-${model.userId}`} />
        </View>
        {model.badge ? (
          <View style={[styles.badge, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} testID={`team-card-badge-${model.userId}`}>
            <Ionicons name="alert-circle" size={12} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: theme.status.dirty }]}>
              {model.badge}
            </Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>

      <View style={styles.lines}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stats, { color: theme.textPrimary }]} testID={`team-card-stats-${model.userId}`}>
          {model.stats}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.remaining, { color: theme.textSecondary }]} testID={`team-card-remaining-${model.userId}`}>
          {model.remaining}
        </Text>
      </View>

      {model.capacity ? <CapacityMeter capacity={model.capacity} testID={`team-card-capacity-${model.userId}`} /> : null}

      {model.notes.map((note) => (
        <NoteLine key={note.key} note={note} testID={`team-card-note-${model.userId}-${note.key}`} />
      ))}

      {model.coverage ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.coverage, { color: theme.textMuted }]} testID={`team-card-coverage-${model.userId}`}>
          {model.coverage}
        </Text>
      ) : null}

      {model.preview.length > 0 ? (
        <View style={styles.rooms} testID={`team-card-rooms-${model.userId}`}>
          {model.preview.map((room) => (
            <View key={room.roomId} style={[styles.room, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessible accessibilityLabel={room.label} testID={`team-card-room-${model.userId}-${room.number}`}>
              <Ionicons name={PHASE_ICON[room.phase] as never} size={11} color={phaseColor(room.phase)} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomText, { color: theme.textPrimary }]}>
                {room.number}
              </Text>
            </View>
          ))}
          {model.more > 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.more, { color: theme.textSecondary }]} testID={`team-card-more-${model.userId}`}>
              {t("assignments.v2.team.moreRooms", { count: model.more })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export const TeamStaffCard = memo(TeamStaffCardView);

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 9 },
  top: { flexDirection: "row", alignItems: "center", gap: 11 },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 16, fontWeight: "800" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11.5, fontWeight: "800" },
  lines: { gap: 2 },
  stats: { fontSize: 14, fontWeight: "700" },
  remaining: { fontSize: 13.5, fontWeight: "600" },
  coverage: { fontSize: 12.5, fontWeight: "600" },
  rooms: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  room: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  roomText: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "800" },
  more: { fontSize: 12.5, fontWeight: "700" },
});
