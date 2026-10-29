import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import type { TeamPerson } from "@/lib/api/schedulingTeam";
import { departmentLabel, rolesLine, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const SHOWN = 60;

interface Props {
  visible: boolean;
  people: readonly TeamPerson[];
  /** Limits the list to one department; null = everyone the supervisor may schedule. */
  departmentId: string | null;
  selectedId: string | null;
  /** What each person already has on the chosen day ("7:00 AM – 3:00 PM"), so a clash is visible before saving. */
  existing: ReadonlyMap<string, string[]>;
  dateLabel: string;
  onSelect: (person: TeamPerson) => void;
  onClose: () => void;
  t: Translate;
}

const norm = (value: string) => value.trim().toLowerCase();

/**
 * Searchable list of the people this supervisor may schedule (the server already limits the roster to the
 * supervisor's departments and to active staff). Appearing here says nothing about availability: the only thing
 * shown about a person's day is what is actually on the schedule.
 */
export function EmployeePicker({ visible, people, departmentId, selectedId, existing, dateLabel, onSelect, onClose, t }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = norm(query);
    return people
      .filter((person) => (departmentId ? person.departmentId === departmentId : true))
      .filter((person) => !q || norm(person.name ?? "").includes(q) || person.roles.some((role) => norm(role).includes(q)))
      .sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));
  }, [people, departmentId, query]);
  const shown = rows.slice(0, SHOWN);

  return (
    <BottomSheet visible={visible} title={t("teamSchedule.manage.picker.title")} onClose={onClose} tall testID="employee-picker">
      <View style={styles.body}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("teamSchedule.manage.picker.search")}
          placeholderTextColor={theme.textMuted}
          accessibilityLabel={t("teamSchedule.manage.picker.search")}
          autoCorrect={false}
          clearButtonMode="while-editing"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          testID="employee-picker-search"
          style={[styles.search, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
        />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("teamSchedule.manage.picker.hint", { date: dateLabel })}
        </Text>
        {shown.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="employee-picker-empty">
            {t(people.length === 0 ? "teamSchedule.manage.picker.nobody" : "teamSchedule.manage.picker.noMatch")}
          </Text>
        ) : (
          shown.map((person) => {
            const name = person.name ?? t("teamSchedule.unnamed");
            const selected = person.userId === selectedId;
            const already = existing.get(person.userId) ?? [];
            const meta = [rolesLine(person.roles, t), person.departmentCode ? departmentLabel(person.departmentCode, t) : null].filter(Boolean).join(" · ");
            return (
              <Pressable
                key={person.userId}
                onPress={() => onSelect(person)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={[name, meta, already.length > 0 ? t("teamSchedule.manage.picker.already", { times: already.join(", ") }) : null].filter(Boolean).join(". ")}
                testID={`employee-picker-${person.userId}`}
                style={({ pressed }) => [styles.row, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }, pressed && { opacity: 0.8 }]}
              >
                <Avatar name={name} size={36} />
                <View style={styles.text}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.name, { color: theme.textPrimary }]}>
                    {name}
                  </Text>
                  {meta ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
                      {meta}
                    </Text>
                  ) : null}
                  {already.length > 0 ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                      {t("teamSchedule.manage.picker.already", { times: already.join(", ") })}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={22} color={theme.primaryAction} /> : null}
              </Pressable>
            );
          })
        )}
        {rows.length > SHOWN ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("teamSchedule.manage.picker.more", { count: rows.length - SHOWN })}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  search: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, fontSize: 16 },
  hint: { fontSize: 13, lineHeight: 18 },
  empty: { fontSize: 15, lineHeight: 21, paddingVertical: 12 },
  row: { minHeight: MIN_TARGET + 8, borderWidth: 1, borderRadius: R.md, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 13.5, lineHeight: 18 },
});
