import { StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { evaluateReading, hasReferenceLimits, parseReading, referenceRange, type PmMeter } from "@/lib/engineering/pmReadings";

interface Props {
  meter: PmMeter;
  value: string;
  onChange: (value: string) => void;
  /** Show the "not a number" error (set once review has been attempted, or after the person typed). */
  showError: boolean;
}

/**
 * One configured meter. The reading is typed as a number in the meter's own unit and compared with the meter's own
 * limits - nothing here supplies a "safe" range, and entering a reading never marks any checklist step as passed. The
 * status is spelled out in words with an icon, never colour alone.
 */
export function PmReadingInput({ meter, value, onChange, showError }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const parsed = parseReading(value);
  const range = referenceRange(meter);
  const status = parsed.kind === "ok" && hasReferenceLimits(meter) ? evaluateReading(meter, parsed.value) : null;
  const statusColor = status === "critical" ? theme.status.dirty : status === "warning" ? theme.status.pickup : theme.status.ready;

  return (
    <View style={styles.wrap} testID={`pm-reading-${meter.id}`}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {meter.name}
          </Text>
          {range ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("pm.reading.reference", { low: range.low ?? "–", high: range.high ?? "–", unit: meter.unit })}
            </Text>
          ) : null}
          {meter.last ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("pm.reading.last", { value: meter.last.value, unit: meter.unit })}
            </Text>
          ) : null}
        </View>
        <View style={[styles.inputWrap, { borderColor: parsed.kind === "invalid" && showError ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <TextInput
            value={value}
            onChangeText={onChange}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder="0"
            placeholderTextColor={theme.textDisabled}
            style={[styles.input, { color: theme.textPrimary }]}
            accessibilityLabel={`${meter.name} (${meter.unit})`}
            testID={`pm-reading-${meter.id}-input`}
          />
          <Text maxFontSizeMultiplier={1.3} style={[styles.unit, { color: theme.textMuted }]}>
            {meter.unit}
          </Text>
        </View>
      </View>
      {parsed.kind === "invalid" && showError ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
          {t("pm.errors.readingInvalid")}
        </Text>
      ) : null}
      {status ? (
        <View style={styles.status} accessibilityLiveRegion="polite" testID={`pm-reading-${meter.id}-status`}>
          <Ionicons name={status === "normal" ? "checkmark-circle-outline" : "warning-outline"} size={15} color={statusColor} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusText, { color: statusColor }]}>
            {t(`pm.reading.status.${status}`)}
            {status === "critical" && meter.opensWorkOrderWhenCritical ? ` · ${t("pm.reading.opensWorkOrder")}` : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, minHeight: 48, paddingHorizontal: 10, width: 130, gap: 6 },
  input: { flex: 1, fontSize: 17, fontWeight: "600", minHeight: 44, padding: 0 },
  unit: { fontSize: 13 },
  error: { fontSize: 13 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
});
