import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { acknowledgePrediction, createWorkOrderFromPrediction, type FailurePrediction } from "@/lib/api/assets";
import { daysSince, formatDayYear } from "@/lib/engineering/assetFormat";
import { riskBand } from "@/lib/engineering/assetModel";
import { useToast } from "@/lib/theme/useToast";
import { Fact, Panel, PanelTitle } from "./assetUi";

/** A signal older than this is shown with its age; it is still the latest the model produced, not fresh information. */
export const STALE_SIGNAL_DAYS = 14;

/** Predictions turned into a work order in this session. The API does not link them or mark them, so this is what stops a second tap. */
const converted = new Set<string>();

interface Props {
  predictions: readonly FailurePrediction[];
  /** Engineer / GM only: the create-work-order and acknowledge endpoints. */
  canAct: boolean;
  language: string;
  timezone: string | null | undefined;
  /** After a confirmed action: refresh the asset's own lists. */
  onChanged: () => void;
}

/**
 * The model's open failure signal for this asset: what it observed and recommended, when, and two explicit actions.
 * It is a prediction, never a confirmed failure and never a safety certificate, and it has no effect on service status.
 */
export function AssetReliabilityPanel({ predictions, canAct, language, timezone, onChanged }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState<"create" | "ack" | null>(null);
  const [, bump] = useState(0);
  const lock = useRef(false);
  const prediction = predictions[0];
  if (!prediction) return null;

  const band = riskBand(prediction.risk_score);
  const age = daysSince(prediction.generated_at);
  const stale = age != null && age >= STALE_SIGNAL_DAYS;
  const alreadyCreated = converted.has(prediction.id);
  const indicators = (prediction.failure_indicators ?? []).filter(Boolean).slice(0, 5);

  const run = async (kind: "create" | "ack") => {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    try {
      if (kind === "create") {
        await createWorkOrderFromPrediction(prediction.id);
        converted.add(prediction.id);
        bump((n) => n + 1);
        toast.success(t("assets.signals.created"));
        // The API does not mark the prediction when it opens the order; acknowledging it keeps it from being turned into a second one.
        try {
          await acknowledgePrediction(prediction.id);
        } catch {
          /* the work order exists; the signal simply stays listed until it is acknowledged */
        }
      } else {
        await acknowledgePrediction(prediction.id);
        toast.success(t("assets.signals.acknowledged"));
      }
      onChanged();
    } catch {
      toast.error(kind === "create" ? t("assets.signals.createFailed") : t("assets.signals.ackFailed"));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  return (
    <Panel testID="asset-reliability-panel">
      <PanelTitle>{t("assets.signals.title")}</PanelTitle>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headline, { color: theme.textPrimary }]}>
        {band ? t(`assets.signals.band.${band}`) : t("assets.signals.band.unknown")}
      </Text>
      {prediction.recommendation?.trim() ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {prediction.recommendation.trim()}
        </Text>
      ) : null}
      {indicators.length > 0 ? (
        <View style={styles.indicators}>
          {indicators.map((indicator) => (
            <Fact key={indicator} icon="ellipse-outline" text={indicator} />
          ))}
        </View>
      ) : null}
      <View style={styles.facts}>
        <Fact icon="time-outline" text={t("assets.signals.generated", { date: formatDayYear(prediction.generated_at, timezone, language) ?? "" })} />
        {stale ? <Fact icon="hourglass-outline" text={t("assets.signals.stale", { count: age ?? 0 })} tone="warn" /> : null}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.disclaimer, { color: theme.textMuted }]}>
        {t("assets.signals.disclaimer")}
      </Text>
      {predictions.length > 1 ? <Text style={[styles.disclaimer, { color: theme.textMuted }]}>{t("assets.signals.more", { count: predictions.length - 1 })}</Text> : null}
      {canAct ? (
        <View style={styles.actions}>
          <Button
            label={alreadyCreated ? t("assets.signals.alreadyCreated") : t("assets.signals.createWo")}
            icon="construct-outline"
            onPress={() => void run("create")}
            loading={busy === "create"}
            disabled={busy != null || alreadyCreated}
            style={styles.action}
            testID="asset-signal-create"
          />
          <Button
            label={t("assets.signals.acknowledge")}
            variant="secondary"
            onPress={() => void run("ack")}
            loading={busy === "ack"}
            disabled={busy != null}
            style={styles.action}
            testID="asset-signal-ack"
          />
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  headline: { fontSize: 17, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 20 },
  indicators: { gap: 4 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  disclaimer: { fontSize: 12.5, lineHeight: 17 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flexGrow: 1, flexBasis: "45%" },
});
