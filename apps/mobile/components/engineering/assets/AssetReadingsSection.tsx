import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { listMeterReadings } from "@/lib/api/assets";
import { formatDayTime } from "@/lib/engineering/assetFormat";
import {
  formatReadingValue,
  hasEnoughForTrend,
  sortReadings,
  trendPoints,
  type AssetMeter,
  type MeterReading,
} from "@/lib/engineering/assetReadings";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { Fact, Panel, PanelTitle } from "./assetUi";
import { ReadingTrend } from "./ReadingTrend";

interface Props {
  scope: string | null;
  meters: readonly AssetMeter[] | null;
  metersFailed: boolean;
  onRetryMeters: () => void;
  canRecord: boolean;
  /** Bumped by the screen after a confirmed reading so every list re-reads from the server. */
  refreshToken: number;
  onRecord: (meterId: string) => void;
  language: string;
  timezone: string | null | undefined;
}

function statusLabelKey(status: string | null | undefined): string | null {
  return status === "normal" || status === "warning" || status === "critical" ? status : null;
}

function MeterCard({ meter, scope, canRecord, refreshToken, onRecord, language, timezone }: { meter: AssetMeter } & Omit<Props, "meters" | "metersFailed" | "onRetryMeters">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const res = useAsyncResource((signal) => listMeterReadings(meter.id, 12, signal), { scope, key: `meter-readings:${meter.id}`, enabled: open });
  useEffect(() => {
    if (open && refreshToken > 0) void res.reload();
  }, [refreshToken]);

  const latest = meter.latest_reading ?? null;
  const readings: MeterReading[] = res.data ? sortReadings(res.data) : latest ? [latest] : [];
  const points = trendPoints(readings);
  const recordedStatus = statusLabelKey(latest?.status_at_recording ?? meter.current_status);
  const stale = meter.current_status === "stale";

  return (
    <View style={[styles.meter, { borderTopColor: theme.borderSubtle }]} testID={`asset-meter-${meter.id}`}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${meter.name}, ${latest ? `${formatReadingValue(latest.value, language)} ${meter.unit}` : t("assets.readings.none")}`}
        style={styles.meterHead}
      >
        <View style={styles.meterText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meterName, { color: theme.textPrimary }]}>
            {meter.name}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meterValue, { color: theme.textPrimary }]}>
            {latest ? `${formatReadingValue(latest.value, language)} ${meter.unit}` : t("assets.readings.none")}
          </Text>
          <View style={styles.facts}>
            {latest ? <Fact icon="time-outline" text={formatDayTime(latest.recorded_at, timezone, language) ?? ""} /> : null}
            {recordedStatus ? (
              <Fact
                icon={recordedStatus === "normal" ? "checkmark-circle-outline" : "alert-circle-outline"}
                text={t(`assets.readings.recorded.${recordedStatus}`)}
                tone={recordedStatus === "critical" ? "alert" : recordedStatus === "warning" ? "warn" : undefined}
              />
            ) : null}
            {stale ? <Fact icon="hourglass-outline" text={t("assets.readings.stale")} tone="warn" /> : null}
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13 }}>
          {open ? t("assets.readings.hide") : t("assets.readings.show")}
        </Text>
      </Pressable>

      {open ? (
        <View style={styles.detail}>
          {res.loading ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t("common.loading")}</Text> : null}
          {res.failure && !res.data ? (
            <Button label={t("common.retry")} variant="secondary" size="sm" onPress={() => void res.reload()} />
          ) : null}
          {hasEnoughForTrend(points) ? (
            <ReadingTrend name={meter.name} unit={meter.unit} points={points} language={language} timezone={timezone} />
          ) : res.data ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("assets.readings.notEnoughForTrend")}
            </Text>
          ) : null}
          {readings.slice(0, 6).map((reading) => (
            <View key={reading.id} style={styles.readingRow}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.readingValue, { color: theme.textPrimary }]}>
                {formatReadingValue(reading.value, language)} {meter.unit}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.readingDate, { color: theme.textMuted }]}>
                {formatDayTime(reading.recorded_at, timezone, language)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {canRecord ? (
        <Button label={t("assets.readings.record")} variant="secondary" size="sm" onPress={() => onRecord(meter.id)} testID={`asset-record-${meter.id}`} />
      ) : null}
    </View>
  );
}

/** Configured meters for this asset with their recent real readings. Thresholds and status come from the server only. */
export function AssetReadingsSection({ meters, metersFailed, onRetryMeters, ...rest }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Panel testID="asset-readings">
      <PanelTitle>{t("assets.readings.title")}</PanelTitle>
      {meters == null ? (
        metersFailed ? (
          <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onRetryMeters} />
        ) : (
          <Text style={{ color: theme.textMuted, fontSize: 13.5 }}>{t("common.loading")}</Text>
        )
      ) : meters.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="asset-no-meters">
          {t("assets.readings.noMeters")}
        </Text>
      ) : (
        meters.map((meter) => <MeterCard key={meter.id} meter={meter} {...rest} />)
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  meter: { gap: 10, paddingTop: 12, borderTopWidth: 1 },
  meterHead: { flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 44 },
  meterText: { flex: 1, gap: 4 },
  meterName: { fontSize: 13.5 },
  meterValue: { fontSize: 20, fontWeight: "700" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  detail: { gap: 10 },
  hint: { fontSize: 13.5, lineHeight: 19 },
  readingRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  readingValue: { fontSize: 14, fontWeight: "600" },
  readingDate: { fontSize: 12.5 },
});
