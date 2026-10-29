import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { ScheduleStatusBadge } from "@/components/scheduling/ScheduleStatusBadge";
import type { ShiftGroup } from "@/lib/scheduling/teamScheduleModel";
import { draftText, groupTitle, groupWindowText, periodLabel, personName, rolesLine, statusLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  group: ShiftGroup;
  onOpen: (userId: string, shiftId?: string) => void;
  t: Translate;
}

/** One shift window for the day and everybody on it. A person with two shifts appears once in each. */
export const ShiftGroupCard = memo(function ShiftGroupCard({ group, onOpen, t }: Props) {
  const theme = useTheme();
  const title = groupTitle(group, t);
  const window = groupWindowText(group, t);
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={`team-schedule-group-${group.key}`}>
      <View
        style={styles.head}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${title}. ${window}. ${periodLabel(group.period, t)}. ${t("teamSchedule.week.groupCount", { count: group.members.length })}`}
      >
        <View style={styles.headText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
            {title}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.window, { color: theme.textSecondary }]}>
            {window}
          </Text>
        </View>
        <View style={[styles.period, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.periodText, { color: theme.textSecondary }]} numberOfLines={1}>
            {periodLabel(group.period, t)}
          </Text>
        </View>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]}>
        {t("teamSchedule.week.groupCount", { count: group.members.length })}
      </Text>
      {group.members.map(({ person, shift }) => {
        const name = personName(person, t);
        const role = rolesLine(person.roles, t);
        return (
          <Pressable
            key={`${shift.id}`}
            onPress={() => onOpen(person.userId, shift.id)}
            accessibilityRole="button"
            accessibilityLabel={[name, role, person.status ? statusLabel(person.status, t) : null, shift.draft ? draftText(shift, t) : null].filter(Boolean).join(". ")}
            accessibilityHint={t("teamSchedule.openShift")}
            testID={`team-schedule-member-${shift.id}`}
            style={({ pressed }) => [styles.member, { borderTopColor: theme.borderSubtle }, pressed && { opacity: 0.75 }]}
          >
            <Avatar name={name} size={32} />
            <View style={styles.memberText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
                {name}
              </Text>
              {role ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textSecondary }]} numberOfLines={1}>
                  {role}
                  {shift.draft ? `  ·  ${draftText(shift, t)}` : ""}
                </Text>
              ) : shift.draft ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textSecondary }]}>
                  {draftText(shift, t)}
                </Text>
              ) : null}
            </View>
            {person.status ? <ScheduleStatusBadge status={person.status} t={t} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, gap: 4 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16, fontWeight: "800" },
  window: { fontSize: 14, fontWeight: "600" },
  period: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  periodText: { fontSize: 11.5, fontWeight: "700" },
  count: { fontSize: 12.5, fontWeight: "600", paddingBottom: 4 },
  member: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET + 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  memberText: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: 15, fontWeight: "700" },
  role: { fontSize: 12.5 },
});
