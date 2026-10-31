import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { ShiftDetail } from "@/lib/api/schedulingManage";
import type { DetailState } from "@/lib/scheduling/useShiftDetail";
import type { DayShift } from "@/lib/scheduling/teamScheduleModel";
import { buildTimeline, type TimelineEvent } from "@/lib/scheduling/shiftTimeline";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { departmentLabel, rolesLine, windowText, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const EVENT_ICON: Record<TimelineEvent["kind"], "calendar-outline" | "play-circle-outline" | "cafe-outline" | "checkmark-done-outline"> = {
  scheduled: "calendar-outline",
  started: "play-circle-outline",
  break: "cafe-outline",
  ended: "checkmark-done-outline",
};

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

interface Props {
  shift: DayShift;
  roles: readonly string[];
  state: DetailState;
  zone: string | null;
  language?: string;
  t: Translate;
}

/** Everything the schedule and the server know about one shift. Missing facts are named as missing, never zero. */
export function ShiftDetailBody({ shift, roles, state, zone, language, t }: Props) {
  const theme = useTheme();
  const detail: ShiftDetail | null = state.status === "ready" ? state.detail : null;
  const timeline = detail ? buildTimeline(detail, shift.startLabel, zone, language) : null;
  const updated = detail?.updatedAt ? formatHotelTime(detail.updatedAt, zone, language) : null;
  const role = rolesLine(roles, t);

  return (
    <View style={styles.wrap} testID="shift-detail-body">
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <Row label={t("teamSchedule.manage.detail.scheduled")} value={windowText(shift, t)} testID="shift-detail-window" />
        {shift.name ? <Row label={t("teamSchedule.manage.detail.shift")} value={shift.name} /> : null}
        {detail?.departmentCode ? <Row label={t("teamSchedule.manage.detail.department")} value={departmentLabel(detail.departmentCode, t)} /> : null}
        {role ? <Row label={t("teamSchedule.manage.detail.role")} value={role} /> : null}
        <Row label={t("teamSchedule.manage.detail.schedule")} value={t(shift.draft ? "teamSchedule.manage.detail.draft" : "teamSchedule.manage.detail.published")} />
        {updated ? <Row label={t("teamSchedule.manage.detail.updated")} value={updated} testID="shift-detail-updated" /> : null}
        {shift.notes ? <Row label={t("teamSchedule.manage.detail.notes")} value={shift.notes} testID="shift-detail-notes" /> : null}
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
        {t("teamSchedule.manage.detail.timeline").toUpperCase()}
      </Text>
      {state.status === "loading" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="shift-detail-loading">
          {t("teamSchedule.manage.detail.loading")}
        </Text>
      ) : timeline ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="shift-detail-timeline">
          {timeline.events.map((event) => (
            <View key={event.key} style={styles.event} testID={`shift-detail-event-${event.kind}`}>
              <Ionicons name={EVENT_ICON[event.kind]} size={18} color={theme.textSecondary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eventText, { color: theme.textPrimary }]}>
                {event.kind === "break" && event.ongoing
                  ? t("teamSchedule.manage.timeline.onBreakSince", { time: event.time ?? "—" })
                  : event.kind === "break"
                    ? t("teamSchedule.manage.timeline.breakTotal", { minutes: event.breakMinutes ?? 0 })
                    : t(`teamSchedule.manage.timeline.${event.kind}`, { time: event.time ?? "—" })}
              </Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="shift-detail-attendance-note">
            {t(`teamSchedule.manage.timeline.note.${timeline.note}`)}
          </Text>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="shift-detail-failed">
          {t("teamSchedule.manage.detail.loadFailed")}
        </Text>
      )}

      {detail?.rooms.applicable ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
            {t("teamSchedule.manage.detail.rooms").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textPrimary }]} testID="shift-detail-rooms">
            {detail.rooms.available && detail.rooms.count !== null ? t("teamSchedule.manage.detail.roomsCount", { count: detail.rooms.count }) : t("teamSchedule.manage.detail.roomsUnavailable")}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 8 },
  row: { gap: 1 },
  rowLabel: { fontSize: 12, fontWeight: "700" },
  rowValue: { fontSize: 15.5, lineHeight: 21, fontWeight: "600" },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
  event: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  eventText: { flex: 1, fontSize: 15, lineHeight: 20 },
  note: { fontSize: 13.5, lineHeight: 19 },
});
