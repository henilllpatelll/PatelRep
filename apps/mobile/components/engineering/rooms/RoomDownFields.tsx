import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { ChoiceChips, FieldLabel, InlineError, Note, TextArea } from "@/components/engineering/workorder/sheetKit";
import {
  AVAILABILITY_TYPES,
  DETAILS_MAX,
  MAX_RETURN_DAYS,
  RETURN_HOURS,
  composeReturn,
  returnPresets,
  type AvailabilityDraft,
  type AvailabilityError,
  type AvailabilityReason,
} from "@/lib/engineering/roomAvailability";
import { formatWhen } from "./roomUi";

interface Props {
  draft: AvailabilityDraft;
  onChange: (patch: Partial<AvailabilityDraft>) => void;
  reasons: readonly AvailabilityReason[];
  reasonsFailed: boolean;
  errors: readonly AvailabilityError[];
  /** Show validation messages (after the first attempt to continue). */
  showErrors: boolean;
  locale: string;
  disabled?: boolean;
  testIDPrefix?: string;
}

/**
 * The fields a room-down request needs: out of order vs out of service, the reason (from the hotel's own list), a
 * promised return and optional details. The return is a planning estimate and the form says so.
 */
export function RoomDownFields({ draft, onChange, reasons, reasonsFailed, errors, showErrors, locale, disabled, testIDPrefix = "down" }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const has = (error: AvailabilityError) => showErrors && errors.includes(error);

  return (
    <View style={styles.stack}>
      <FieldLabel required>{t("engRooms.down.type")}</FieldLabel>
      <ChoiceChips
        options={AVAILABILITY_TYPES.map((value) => ({ value, label: t(`engRooms.down.types.${value}`), hint: t(`engRooms.down.typeHints.${value}`) }))}
        value={draft.type}
        onChange={(type) => onChange({ type })}
        testIDPrefix={`${testIDPrefix}-type`}
        disabled={disabled}
      />
      {has("type_required") ? <InlineError>{t("engRooms.down.errors.type_required")}</InlineError> : null}

      <FieldLabel required>{t("engRooms.down.reason")}</FieldLabel>
      {reasons.length > 0 ? (
        <View style={styles.wrap}>
          {reasons.map((reason) => {
            const selected = draft.reasonCode === reason.code;
            return (
              <Pressable
                key={reason.id}
                onPress={() => onChange({ reasonCode: reason.code })}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !!disabled }}
                testID={`${testIDPrefix}-reason-${reason.code}`}
                style={[styles.pill, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle, opacity: disabled ? 0.5 : 1 }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                  {reason.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Note tone="warn">{reasonsFailed ? t("engRooms.down.reasonsFailed") : t("engRooms.down.reasonsLoading")}</Note>
      )}
      {has("reason_required") ? <InlineError>{t("engRooms.down.errors.reason_required")}</InlineError> : null}

      <FieldLabel required>{t("engRooms.down.returnTitle")}</FieldLabel>
      <ReturnTimePicker value={draft.returnAt} onChange={(returnAt) => onChange({ returnAt })} locale={locale} disabled={disabled} testIDPrefix={testIDPrefix} />
      {has("return_required") ? <InlineError>{t("engRooms.down.errors.return_required")}</InlineError> : null}
      {has("return_past") ? <InlineError>{t("engRooms.down.errors.return_past")}</InlineError> : null}
      {has("return_too_far") ? <InlineError>{t("engRooms.down.errors.return_too_far", { days: MAX_RETURN_DAYS })}</InlineError> : null}

      <FieldLabel>{t("engRooms.down.details")}</FieldLabel>
      <TextArea
        value={draft.details}
        onChangeText={(details) => onChange({ details })}
        editable={!disabled}
        maxLength={DETAILS_MAX}
        placeholder={t("engRooms.down.detailsPlaceholder")}
        accessibilityLabel={t("engRooms.down.details")}
        invalid={has("details_too_long")}
        testID={`${testIDPrefix}-details`}
      />
    </View>
  );
}

interface PickerProps {
  value: Date | null;
  onChange: (next: Date | null) => void;
  locale: string;
  disabled?: boolean;
  testIDPrefix: string;
}

/** Quick promises plus a custom day + hour. No native date module: this runs on every installed build. */
export function ReturnTimePicker({ value, onChange, locale, disabled, testIDPrefix }: PickerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [customOpen, setCustomOpen] = useState(false);
  const [days, setDays] = useState(1);
  const [hour, setHour] = useState(9);
  const presets = returnPresets();

  const applyCustom = (nextDays: number, nextHour: number) => {
    setDays(nextDays);
    setHour(nextHour);
    onChange(composeReturn(new Date(), nextDays, nextHour));
  };

  return (
    <View style={styles.stack}>
      <View style={styles.wrap}>
        {presets.map((preset) => {
          const selected = !customOpen && value != null && Math.abs(value.getTime() - preset.at.getTime()) < 60_000 * 2;
          return (
            <Pressable
              key={preset.key}
              onPress={() => {
                setCustomOpen(false);
                onChange(preset.at);
              }}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: !!disabled }}
              testID={`${testIDPrefix}-return-${preset.key}`}
              style={[styles.pill, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle, opacity: disabled ? 0.5 : 1 }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                {t(`engRooms.down.presets.${preset.key}`)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            setCustomOpen(true);
            applyCustom(days, hour);
          }}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ selected: customOpen, disabled: !!disabled }}
          testID={`${testIDPrefix}-return-custom`}
          style={[styles.pill, { borderColor: customOpen ? theme.primaryLine : theme.border, backgroundColor: customOpen ? theme.primarySoft : theme.surfaceSubtle, opacity: disabled ? 0.5 : 1 }]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: customOpen ? theme.primaryAction : theme.textPrimary }]}>
            {t("engRooms.down.presets.custom")}
          </Text>
        </Pressable>
      </View>

      {customOpen ? (
        <View style={[styles.custom, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => applyCustom(Math.max(0, days - 1), hour)}
              accessibilityRole="button"
              accessibilityLabel={t("engRooms.down.earlierDay")}
              style={[styles.stepButton, { borderColor: theme.border }]}
              testID={`${testIDPrefix}-days-minus`}
            >
              <Ionicons name="remove" size={20} color={theme.textPrimary} />
            </Pressable>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stepValue, { color: theme.textPrimary }]} accessibilityLiveRegion="polite">
              {days === 0 ? t("engRooms.down.today") : t("engRooms.down.inDays", { count: days })}
            </Text>
            <Pressable
              onPress={() => applyCustom(Math.min(MAX_RETURN_DAYS, days + 1), hour)}
              accessibilityRole="button"
              accessibilityLabel={t("engRooms.down.laterDay")}
              style={[styles.stepButton, { borderColor: theme.border }]}
              testID={`${testIDPrefix}-days-plus`}
            >
              <Ionicons name="add" size={20} color={theme.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.wrap}>
            {RETURN_HOURS.map((h) => {
              const selected = hour === h;
              const label = new Date(2000, 0, 1, h).toLocaleTimeString(locale, { hour: "numeric" });
              return (
                <Pressable
                  key={h}
                  onPress={() => applyCustom(days, h)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`${testIDPrefix}-hour-${h}`}
                  style={[styles.pill, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surface }]}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chosen, { color: value ? theme.textPrimary : theme.textMuted }]} accessibilityLiveRegion="polite" testID={`${testIDPrefix}-return-chosen`}>
        {value ? t("engRooms.down.expectedBack", { time: formatWhen(value, locale) }) : t("engRooms.down.noReturnYet")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
        {t("engRooms.down.estimateNote")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 14, fontWeight: "600" },
  custom: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 12 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  stepButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepValue: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700" },
  chosen: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12.5 },
});
