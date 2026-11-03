import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError } from "@/components/engineering/workorder/sheetKit";
import { useThemeMode } from "@/lib/theme/ThemeProvider";
import { useTheme } from "@/lib/theme/useTheme";
import { fromIsoDate, toIsoDate } from "@/lib/engineering/assetForm";

interface Props {
  label: string;
  /** `YYYY-MM-DD`, or empty for "not set". */
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  testID: string;
}

/** A tappable date that opens the platform's own picker, so nobody types ISO dates on a phone. Empty means "not recorded". */
export function DateField({ label, value, onChange, error, testID }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const mode = useThemeMode();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(new Date());
  const date = fromIsoDate(value);
  const shown = date ? date.toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" }) : value ? value : t("assets.form.notSet");

  const show = () => {
    const start = date ?? new Date();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start,
        mode: "date",
        onChange: (event: DateTimePickerEvent, picked?: Date) => {
          if (event.type === "set" && picked) onChange(toIsoDate(picked));
        },
      });
      return;
    }
    setDraft(start);
    setOpen(true);
  };

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <Pressable
          onPress={show}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${shown}`}
          accessibilityHint={t("assets.form.dateHint")}
          style={[styles.value, { backgroundColor: theme.surfaceSubtle, borderColor: error ? theme.status.dirty : theme.border }]}
          testID={testID}
        >
          <Ionicons name="calendar-outline" size={18} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.valueText, { color: date || value ? theme.textPrimary : theme.textDisabled }]}>
            {shown}
          </Text>
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange("")} accessibilityRole="button" accessibilityLabel={t("assets.form.clearDate", { field: label })} hitSlop={8} style={styles.clear} testID={`${testID}-clear`}>
            <Ionicons name="close-circle" size={22} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <InlineError testID={`${testID}-error`}>{error}</InlineError> : null}

      {Platform.OS === "ios" ? (
        <BottomSheet visible={open} title={label} onClose={() => setOpen(false)} testID={`${testID}-sheet`}>
          <DateTimePicker value={draft} mode="date" display="inline" onChange={(_event, picked) => picked && setDraft(picked)} themeVariant={mode === "dark" ? "dark" : "light"} />
          <Button
            label={t("common.done")}
            onPress={() => {
              onChange(toIsoDate(draft));
              setOpen(false);
            }}
            testID={`${testID}-done`}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  value: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  valueText: { fontSize: 15 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
