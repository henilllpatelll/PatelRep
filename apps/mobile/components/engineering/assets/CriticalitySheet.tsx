import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ChoiceChips, FieldLabel, InlineError, Note, TextArea } from "@/components/engineering/workorder/sheetKit";
import { setAssetCriticality, type Criticality } from "@/lib/api/pmManagement";
import { CRITICALITY_REASON_MAX, classifyManagementFailure, type ManagementFailure } from "@/lib/engineering/pmManagement";
import { useTheme } from "@/lib/theme/useTheme";

const LEVELS: readonly Criticality[] = ["low", "medium", "high", "life_safety"];

interface Props {
  visible: boolean;
  asset: { id: string; name: string; criticality: Criticality | null | undefined; row_version?: number | null };
  isOnline: boolean;
  onClose: () => void;
  /** The server confirmed the new level. */
  onChanged: (criticality: Criticality) => void;
  /** Someone else edited the record first: re-read it before trying again. */
  onNeedsRefresh?: () => void;
}

/**
 * Equipment criticality: the property's own assessment of how much operations depend on this equipment. It is a
 * judgement entered by a manager - never derived from the category, a prediction or a meter.
 */
export function CriticalitySheet({ visible, asset, isOnline, onClose, onChanged, onNeedsRefresh }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const current: Criticality = LEVELS.includes(asset.criticality as Criticality) ? (asset.criticality as Criticality) : "medium";
  const [level, setLevel] = useState<Criticality>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setLevel(current);
    setReason("");
    setFailure(null);
  }, [visible, current, asset.id]);

  const save = async () => {
    if (working.current || level === current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await setAssetCriticality(asset.id, { criticality: level, reason, expectedRowVersion: asset.row_version });
      onChanged(level);
      onClose();
    } catch (err) {
      const classified = classifyManagementFailure(err);
      setFailure(classified);
      if (classified.kind === "version_conflict") onNeedsRefresh?.();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      title={t("assets.criticality.title")}
      onClose={busy ? () => undefined : onClose}
      testID="asset-criticality-sheet"
      footer={<Button label={t("assets.criticality.save")} onPress={() => void save()} loading={busy} disabled={busy || !isOnline || level === current} size="lg" testID="asset-criticality-save" />}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("assets.criticality.body", { name: asset.name })}
      </Text>
      <ChoiceChips<Criticality>
        value={level}
        onChange={setLevel}
        testIDPrefix="asset-criticality"
        options={LEVELS.map((key) => ({ value: key, label: t(`assets.criticality.${key}`) }))}
      />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]} testID="asset-criticality-help">
        {t(`assets.criticality.help.${level}`)}
      </Text>
      <FieldLabel>{t("assets.criticality.reason")}</FieldLabel>
      <TextArea value={reason} onChangeText={setReason} maxLength={CRITICALITY_REASON_MAX} placeholder={t("assets.criticality.reasonPlaceholder")} accessibilityLabel={t("assets.criticality.reason")} testID="asset-criticality-reason" />
      {!isOnline ? <Note tone="warn">{t("pmMgmt.needsConnection")}</Note> : null}
      {failure ? <InlineError testID="asset-criticality-error">{t(`pmMgmt.failure.${failure.kind}`)}</InlineError> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
});
