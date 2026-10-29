import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { ScheduleStatusBadge } from "@/components/scheduling/ScheduleStatusBadge";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import type { DayRoster, RosterPerson } from "@/lib/scheduling/teamScheduleModel";
import { periodLabel, personName, rolesLine, windowText, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/** The part-of-day label, unless the shift is already named that ("Morning · Morning" adds nothing). */
function periodText(name: string | null, period: Parameters<typeof periodLabel>[0], t: Translate): string | null {
  const label = periodLabel(period, t);
  return label && name && label.trim().toLowerCase() === name.trim().toLowerCase() ? null : label;
}

interface Props {
  person: RosterPerson | null;
  roster: DayRoster | null;
  language?: string;
  /** Opens the same person in Assignments (who cleans which rooms). Scheduling never edits room work. */
  onOpenAssignments: (userId: string) => void;
  onClose: () => void;
  t: Translate;
}

/**
 * Read-only shift information for one person on the selected day. There is deliberately nothing to edit here:
 * adding, changing and covering shifts arrive in a later phase, and a button that does nothing is worse than none.
 */
export function ShiftDetailSheet({ person, roster, language, onOpenAssignments, onClose, t }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = person !== null;
  const name = person ? personName(person, t) : "";
  const role = person ? rolesLine(person.roles, t) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="team-schedule-detail-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID="team-schedule-detail-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          {person && roster ? (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.who}>
                <Avatar name={name} size={48} />
                <View style={styles.whoText}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.name, { color: theme.textPrimary }]} numberOfLines={3}>
                    {name}
                  </Text>
                  {role ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                      {role}
                    </Text>
                  ) : null}
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                    {formatLongDate(roster.date, language)}
                  </Text>
                </View>
              </View>

              {person.status ? (
                <View style={styles.block}>
                  <ScheduleStatusBadge status={person.status} t={t} testID="team-schedule-detail-status" />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                    {t(`teamSchedule.detail.statusHint.${person.status}`)}
                  </Text>
                </View>
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="team-schedule-detail-plan-only">
                  {t("teamSchedule.detail.planOnly")}
                </Text>
              )}

              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
                {t("teamSchedule.detail.shifts").toUpperCase()}
              </Text>
              {person.shifts.length === 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="team-schedule-detail-unscheduled">
                  {t("teamSchedule.detail.noShift")}
                </Text>
              ) : (
                person.shifts.map((shift) => (
                  <View key={shift.id} style={[styles.shift, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={`team-schedule-detail-shift-${shift.id}`}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.shiftTime, { color: theme.textPrimary }]}>
                      {windowText(shift, t)}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                      {[shift.name, periodText(shift.name, shift.period, t), shift.draft ? t("teamSchedule.draft") : null, shift.carried ? t("teamSchedule.carried") : null].filter(Boolean).join(" · ")}
                    </Text>
                    {shift.notes ? (
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notes, { color: theme.textSecondary }]}>
                        {shift.notes}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}

              <Pressable
                onPress={() => onOpenAssignments(person.userId)}
                accessibilityRole="button"
                accessibilityLabel={t("teamSchedule.detail.openAssignments")}
                testID="team-schedule-detail-assignments"
                style={({ pressed }) => [styles.link, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="people-outline" size={18} color={theme.primaryAction} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
                  {t("teamSchedule.detail.openAssignments")}
                </Text>
              </Pressable>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t("teamSchedule.detail.assignmentsHint")}
              </Text>
            </ScrollView>
          ) : null}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="team-schedule-detail-close" style={({ pressed }) => [styles.close, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }, pressed && { opacity: 0.8 }]}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.closeText, { color: theme.textPrimary }]}>
              {t("common.close")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  whoText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 20, fontWeight: "800" },
  sub: { fontSize: 14, lineHeight: 19 },
  block: { gap: 6 },
  hint: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
  shift: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 2 },
  shiftTime: { fontSize: 17, fontWeight: "700" },
  notes: { fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  link: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  linkText: { fontSize: 15, fontWeight: "700" },
  close: { minHeight: MIN_TARGET, marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 15, fontWeight: "700" },
});
