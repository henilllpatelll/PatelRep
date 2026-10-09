import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { RoomClassification } from "@/lib/housekeeping/needsAttention";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";

const MAX_FONT_SCALE = 1.6;
const RUSH_REASONS = new Set(["early_arrival", "vip", "guest_waiting", "front_desk_request", "operational_priority", "other"]);

/**
 * Rush context for Room Detail: the deadline (kept apart from the guest's
 * arrival), the reason and the supervisor's note. The card in My Rooms stays
 * short; the note lives here.
 */
export function RushPriorityPanel({ room, classification, ctx }: { room: Room; classification: RoomClassification; ctx: TextContext }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rush = classification.rush;
  if (!rush) return null;

  const deadline = formatClock(rush.neededBy, ctx);
  const arrival = formatClock(room.checkin_time, ctx);
  const reason = rush.reason && RUSH_REASONS.has(rush.reason) ? t(`rooms.dash.rush.reasons.${rush.reason}`) : null;

  return (
    <View
      testID="rush-panel"
      style={[styles.panel, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
    >
      <View style={styles.header}>
        <Ionicons name="flash" size={15} color={theme.status.dirty} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.status.dirty }]}>
          {t("rooms.dash.rush.title")}
          {reason ? ` · ${reason}` : ""}
        </Text>
      </View>
      {deadline ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: rush.overdue ? theme.status.dirty : theme.textPrimary }]}>
          {rush.overdue ? t("rooms.dash.rush.overdue", { time: deadline }) : t("rooms.dash.detail.rush.deadline", { time: deadline })}
        </Text>
      ) : null}
      {arrival ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]}>
          {t("rooms.dash.detail.rush.arrival", { time: arrival })}
        </Text>
      ) : null}
      {rush.note ? (
        <View style={styles.note}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteLabel, { color: theme.textMuted }]}>
            {t("rooms.dash.rush.noteLabel")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary }]}>
            {rush.note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4, marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 14, fontWeight: "900", letterSpacing: 0.4 },
  line: { fontSize: 14.5, lineHeight: 20, fontWeight: "600" },
  note: { marginTop: 4, gap: 2 },
  noteLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
});
