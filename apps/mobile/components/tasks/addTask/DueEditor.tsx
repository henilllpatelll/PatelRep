import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip, ChipRow, FieldError, FieldLabel, inputStyle } from "@/components/tasks/addTask/formBits";
import { formatHotelTime, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { useTheme } from "@/lib/theme/useTheme";
import { resolveDue, type DueDraft } from "@/lib/tasks/addTask/draft";

interface Props {
  due: DueDraft;
  zone: string | null | undefined;
  language: string;
  now: Date;
  onChange: (due: DueDraft) => void;
  onBack: () => void;
}

/** Short date for a due that is neither today nor tomorrow, in the hotel's calendar. */
export function formatOtherDay(iso: string | null, zone: string | null | undefined, language: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(language.startsWith("es") ? "es-US" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: resolveTimeZone(zone),
  });
}

/** The time as the field shows it for the current language ("2:00 PM"). */
export function dueTimeLabel(due: DueDraft, zone: string | null | undefined, language: string): string {
  if (due.mode !== "set") return "";
  return (due.iso ? formatHotelTime(due.iso, zone, language) : null) ?? due.time;
}

/**
 * Optional due day + time in the hotel's own clock (a phone set to another zone still records the
 * hotel's 2:00 PM). Only today / tomorrow are offered; a later date the AI understood is kept and
 * shown, and replaced the moment the person picks a day. An unresolved suggestion stays flagged until
 * a time is set or the due time is removed.
 */
export function DueEditor({ due, zone, language, now, onChange, onBack }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const result = resolveDue(due, zone, now);
  const error = !result.ok ? t(`tasks.hk.add.error.due.${result.reason}`) : null;

  const day = due.mode === "set" ? due.day : null;
  const time = due.mode === "set" ? due.time : "";
  const setDay = (next: "today" | "tomorrow") =>
    onChange({ mode: "set", day: next, time: time || "", iso: null });

  return (
    <View style={styles.wrap} testID="add-task-due-editor">
      <ChipRow label={t("tasks.hk.add.due.title")}>
        <Chip
          label={t("tasks.hk.add.due.clear")}
          selected={due.mode === "none"}
          onPress={() => onChange({ mode: "none" })}
          testID="due-none"
        />
        <Chip label={t("tasks.hk.add.due.today")} selected={day === "today"} onPress={() => setDay("today")} testID="due-today" />
        <Chip label={t("tasks.hk.add.due.tomorrow")} selected={day === "tomorrow"} onPress={() => setDay("tomorrow")} testID="due-tomorrow" />
        {due.mode === "set" && due.day === "other" ? (
          <Chip
            label={t("tasks.hk.add.due.other", { date: formatOtherDay(due.iso, zone, language) })}
            selected
            onPress={() => undefined}
            testID="due-other"
          />
        ) : null}
      </ChipRow>

      {due.mode === "set" && due.day !== "other" ? (
        <View style={styles.wrap}>
          <FieldLabel>{t("tasks.hk.add.due.time")}</FieldLabel>
          <TextInput
            value={time}
            onChangeText={(value) => onChange({ mode: "set", day: due.day as "today" | "tomorrow", time: value, iso: null })}
            placeholder={t("tasks.hk.add.due.timePlaceholder")}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t("tasks.hk.add.due.time")}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[inputStyle, { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: error ? theme.status.dirty : theme.borderSubtle }]}
            testID="due-time"
          />
        </View>
      ) : null}

      {due.mode === "unresolved" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.dirty }]} accessibilityRole="alert">
          {t("tasks.hk.add.error.due.unresolved")}
        </Text>
      ) : (
        <FieldError message={error} testID="due-error" />
      )}

      <Button label={t("tasks.hk.add.due.done")} onPress={onBack} testID="due-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  note: { fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
});
