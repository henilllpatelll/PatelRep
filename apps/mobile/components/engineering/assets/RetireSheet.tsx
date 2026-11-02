import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, Note, TextArea } from "@/components/engineering/workorder/sheetKit";
import { retireAsset, type AssetDetail } from "@/lib/api/assets";
import { classifySaveFailure, type SaveFailure } from "@/lib/engineering/assetForm";
import { useTheme } from "@/lib/theme/useTheme";

const REASON_MIN = 3;
const REASON_MAX = 255;

interface Props {
  visible: boolean;
  asset: Pick<AssetDetail, "id" | "name" | "row_version">;
  isOnline: boolean;
  onClose: () => void;
  /** Called once the server has confirmed the retirement. */
  onRetired: () => void;
}

/**
 * Retire equipment: a reason, then an explicit confirmation. Nothing is deleted - the record, its inspections, repairs and
 * downtime stay readable - and the server refuses while repairs or downtime are open, which this reports plainly.
 */
export function RetireSheet({ visible, asset, isOnline, onClose, onRetired }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (visible) {
      setReason("");
      setConfirming(false);
      setFailure(null);
    }
  }, [visible]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN;

  const retire = async () => {
    if (working.current || !valid) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await retireAsset(asset.id, trimmed, asset.row_version);
      onRetired();
    } catch (err) {
      setFailure(classifySaveFailure(err));
      setConfirming(false);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const failureText =
    failure == null
      ? null
      : failure.kind === "has_open_work"
        ? t(`assets.retire.failure.${failure.code}`)
        : failure.kind === "conflict"
          ? t("assets.retire.failure.conflict")
          : failure.kind === "unconfirmed"
            ? t("assets.retire.failure.unconfirmed")
            : failure.kind === "forbidden"
              ? t("assets.retire.failure.forbidden")
              : t("assets.retire.failure.failed");

  return (
    <BottomSheet visible={visible} title={t("assets.retire.title")} onClose={busy ? () => undefined : onClose} testID="asset-retire-sheet">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("assets.retire.body", { name: asset.name })}
      </Text>
      {confirming ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.confirm, { color: theme.textPrimary }]} testID="asset-retire-confirm-text">
            {t("assets.retire.confirm", { name: asset.name })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            “{trimmed}”
          </Text>
          <Button label={t("assets.retire.confirmButton")} variant="destructive" onPress={() => void retire()} loading={busy} disabled={busy || !isOnline} size="lg" testID="asset-retire-confirm" />
          <Button label={t("common.cancel")} variant="ghost" onPress={() => setConfirming(false)} disabled={busy} testID="asset-retire-back" />
        </>
      ) : (
        <>
          <FieldLabel required>{t("assets.retire.reason")}</FieldLabel>
          <TextArea value={reason} onChangeText={setReason} maxLength={REASON_MAX} placeholder={t("assets.retire.reasonPlaceholder")} accessibilityLabel={t("assets.retire.reason")} testID="asset-retire-reason" />
          {!isOnline ? <Note tone="warn">{t("assets.retire.offline")}</Note> : null}
          <Button label={t("assets.retire.continue")} variant="destructive" onPress={() => setConfirming(true)} disabled={!valid || !isOnline} size="lg" testID="asset-retire-continue" />
          <Button label={t("common.cancel")} variant="ghost" onPress={onClose} testID="asset-retire-cancel" />
        </>
      )}
      {failureText ? <InlineError testID="asset-retire-error">{failureText}</InlineError> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  confirm: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
});
