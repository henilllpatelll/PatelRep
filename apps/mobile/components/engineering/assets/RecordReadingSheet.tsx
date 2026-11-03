import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, Note } from "@/components/engineering/workorder/sheetKit";
import { recordMeterReading, listMeterReadings, type RecordedReading } from "@/lib/api/assets";
import { classifyLoadFailure } from "@/lib/engineering/loadState";
import {
  READING_NOTES_MAX,
  checkReadingInput,
  configuredRange,
  limitState,
  readingNumber,
  type AssetMeter,
} from "@/lib/engineering/assetReadings";

interface Props {
  visible: boolean;
  meters: readonly AssetMeter[];
  /** Meter to start on (the one whose row opened the sheet), else the first. */
  initialMeterId?: string | null;
  isOnline: boolean;
  onClose: () => void;
  /** Called only after the server confirmed the reading. */
  onRecorded: (reading: RecordedReading, meter: AssetMeter) => void;
}

/**
 * Records one reading against a configured meter. Rules come from the API contract: a plain decimal, the meter's own
 * unit, optional notes. The client never invents a safe range: it only compares the value with the limits the meter
 * is configured with, and the server decides the recorded status. It needs a connection (the API has no idempotency
 * key, so a queued retry could record twice), and an unconfirmed attempt is re-read before it can be sent again.
 */
export function RecordReadingSheet({ visible, meters, initialMeterId, isOnline, onClose, onRecorded }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [meterId, setMeterId] = useState<string | null>(initialMeterId ?? meters[0]?.id ?? null);
  const [valueText, setValueText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when an attempt may have landed (no answer): the next press re-reads the meter before sending again.
  const unconfirmed = useRef<{ meterId: string; value: number; since: number } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (visible) {
      setMeterId(initialMeterId ?? meters[0]?.id ?? null);
      setValueText("");
      setNotes("");
      setError(null);
      unconfirmed.current = null;
    }
  }, [visible, initialMeterId, meters]);

  const meter = meters.find((m) => m.id === meterId) ?? null;
  const check = checkReadingInput(valueText, notes);
  const showError = valueText.length > 0 && check.error != null;
  const limit = meter && check.value != null ? limitState(meter, check.value) : null;
  const range = meter ? configuredRange(meter) : null;
  const last = meter?.latest_reading ? readingNumber(meter.latest_reading) : null;

  const submit = async () => {
    if (!meter || check.value == null || inFlight.current || !isOnline) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const pending = unconfirmed.current;
      if (pending && pending.meterId === meter.id && pending.value === check.value) {
        const recent = await listMeterReadings(meter.id, 5);
        const landed = recent.find((r) => readingNumber(r) === pending.value && Date.parse(r.recorded_at) >= pending.since - 5000);
        if (landed) {
          unconfirmed.current = null;
          onRecorded(landed, meter);
          onClose();
          return;
        }
      }
      const attempt = { meterId: meter.id, value: check.value, since: Date.now() };
      try {
        const saved = await recordMeterReading(meter.id, { value: check.value, notes });
        unconfirmed.current = null;
        onRecorded(saved, meter);
        onClose();
      } catch (err) {
        const status = (err as { status?: unknown } | null)?.status;
        if (typeof status !== "number") unconfirmed.current = attempt; // no answer: it may have landed
        throw err;
      }
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      const failure = classifyLoadFailure(err);
      setError(
        failure === "forbidden"
          ? t("assets.readings.errors.forbidden")
          : status === 422
            ? t("assets.readings.errors.rejected")
            : typeof status !== "number"
              ? t("assets.readings.errors.unconfirmed")
              : t("assets.readings.errors.failed"),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      title={t("assets.readings.record")}
      onClose={onClose}
      testID="record-reading-sheet"
      scrollKey={error}
      footer={
        <View style={styles.footer}>
          <Button label={t("common.cancel")} variant="ghost" onPress={onClose} style={styles.cancel} />
          <Button
            label={t("assets.readings.save")}
            onPress={() => void submit()}
            loading={busy}
            disabled={!meter || check.value == null || !isOnline}
            style={styles.save}
            testID="reading-save"
          />
        </View>
      }
    >
      {meters.length > 1 ? (
        <View style={styles.chips}>
          {meters.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => setMeterId(m.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: m.id === meterId }}
              style={[styles.chip, { borderColor: m.id === meterId ? theme.primaryAction : theme.border, backgroundColor: m.id === meterId ? theme.primarySoft : theme.surface }]}
              testID={`reading-meter-${m.id}`}
            >
              <Text style={[styles.chipText, { color: m.id === meterId ? theme.primary : theme.textSecondary }]} maxFontSizeMultiplier={1.4}>
                {m.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <FieldLabel required>{meter ? `${meter.name} (${meter.unit})` : t("assets.readings.value")}</FieldLabel>
      {meter ? <Note testID="reading-unit">{t("assets.readings.unitFixed", { unit: meter.unit })}</Note> : null}
      {range ? <Note testID="reading-range">{t("assets.readings.reference", { low: range.low ?? "–", high: range.high ?? "–", unit: meter?.unit })}</Note> : null}
      {last != null && meter ? <Note testID="reading-last">{t("assets.readings.last", { value: last, unit: meter.unit })}</Note> : null}
      <TextInput
        value={valueText}
        onChangeText={(text) => {
          setValueText(text);
          setError(null);
        }}
        keyboardType="numbers-and-punctuation"
        placeholder={meter ? t("assets.readings.valuePlaceholder", { unit: meter.unit }) : ""}
        placeholderTextColor={theme.textDisabled}
        style={[styles.input, { borderColor: showError ? theme.status.dirty : theme.border, color: theme.textPrimary }]}
        accessibilityLabel={meter ? `${meter.name}, ${meter.unit}` : t("assets.readings.value")}
        testID="reading-value"
      />
      {showError ? <InlineError testID="reading-value-error">{t(`assets.readings.errors.${check.error}`)}</InlineError> : null}
      {limit === "outside_critical" ? <Note tone="warn" testID="reading-limit">{t("assets.readings.limit.critical")}</Note> : null}
      {limit === "outside_warning" ? <Note tone="warn" testID="reading-limit">{t("assets.readings.limit.warning")}</Note> : null}
      {limit === "no_limits" ? <Note testID="reading-limit">{t("assets.readings.limit.none")}</Note> : null}

      <FieldLabel>{t("assets.readings.notes")}</FieldLabel>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={READING_NOTES_MAX}
        placeholder={t("assets.readings.notesPlaceholder")}
        placeholderTextColor={theme.textDisabled}
        style={[styles.input, styles.multiline, { borderColor: theme.border, color: theme.textPrimary }]}
        accessibilityLabel={t("assets.readings.notes")}
        testID="reading-notes"
      />

      {!isOnline ? <InlineError testID="reading-offline">{t("assets.readings.errors.offline")}</InlineError> : null}
      {error ? <InlineError testID="reading-error">{error}</InlineError> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: "top", paddingTop: 10 },
  footer: { flexDirection: "row", gap: 10 },
  cancel: { flex: 1 },
  save: { flex: 2 },
});
