import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { ScheduleStatusBadge } from "@/components/scheduling/ScheduleStatusBadge";
import type { RosterPerson } from "@/lib/scheduling/teamScheduleModel";
import { personA11y, personName, rolesLine, windowText, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const SHIFTS_SHOWN = 2;

interface Props {
  person: RosterPerson;
  onOpen: (userId: string, shiftId?: string) => void;
  t: Translate;
}

/**
 * One person for the day: who, role, WHEN they are scheduled, and (only when the day makes an attendance claim)
 * whether they have started. Expected vs. actual are on separate lines on purpose.
 */
export const PersonScheduleCard = memo(function PersonScheduleCard({ person, onOpen, t }: Props) {
  const theme = useTheme();
  const name = personName(person, t);
  const role = rolesLine(person.roles, t);
  const shown = person.shifts.slice(0, SHIFTS_SHOWN);
  const hidden = person.shifts.length - shown.length;
  return (
    <Pressable
      onPress={() => onOpen(person.userId)}
      accessibilityRole="button"
      accessibilityLabel={personA11y(person, t)}
      accessibilityHint={t("teamSchedule.openShift")}
      testID={`team-schedule-person-${person.userId}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }, pressed && { opacity: 0.8 }]}
    >
      <Avatar name={name} size={40} />
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
          {name}
        </Text>
        {role ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textSecondary }]} numberOfLines={1}>
            {role}
          </Text>
        ) : null}
        {person.scheduled ? (
          <View style={styles.shifts}>
            {shown.map((shift) => (
              <Text key={shift.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.textPrimary }]} testID={`team-schedule-person-time-${shift.id}`}>
                {windowText(shift, t)}
                {shift.draft ? `  ·  ${t("teamSchedule.draft")}` : ""}
                {shift.carried ? `  ·  ${t("teamSchedule.carried")}` : ""}
              </Text>
            ))}
            {hidden > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textMuted }]}>
                {t("teamSchedule.moreShifts", { count: hidden })}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textMuted }]} testID={`team-schedule-person-unscheduled-${person.userId}`}>
            {t("teamSchedule.notScheduled")}
          </Text>
        )}
        {person.status ? <ScheduleStatusBadge status={person.status} t={t} testID={`team-schedule-person-status-${person.userId}`} /> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: MIN_TARGET + 12, borderWidth: 1, borderRadius: R.lg, padding: 12 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 16, fontWeight: "700" },
  role: { fontSize: 13, lineHeight: 18 },
  shifts: { gap: 1 },
  time: { fontSize: 14, fontWeight: "600" },
});
