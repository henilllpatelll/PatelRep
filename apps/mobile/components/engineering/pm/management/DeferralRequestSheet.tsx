import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/engineering/assets/form/DateField";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import { requestPmDeferral } from "@/lib/api/pmManagement";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import {
  classifyManagementFailure,
  DEFERRAL_REASON_MAX,
  deferralInstant,
  earliestDeferralDate,
  validateDeferral,
  type ManagementFailure,
} from "@/lib/engineering/pmManagement";
import { useTheme } from "@/lib/theme/useTheme";

export interface DeferralTarget {
  scheduleId: string;
  name: string;
  assetName: string | null;
  dueAt: string | null;
}

interface Props {
  visible: boolean;
  target: DeferralTarget | null;
  timezone: string | null | undefined;
  language: string;
  isOnline: boolean;
  onClose: () => void;
  /** The server recorded the REQUEST. The due date has not moved; a different person must approve it. */
  onRequested: () => void;
}

/** Request PM Deferral. Submits a request only - never an approval - and says plainly that it is awaiting review. */
export function DeferralRequestSheet({ visible, target, timezone, language, isOnline, onClose, onRequested }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setReason("");
    setDate("");
    setTouched(false);
    setFailure(null);
  }, [visible, target?.scheduleId]);

  const problems = validateDeferral({ reason, requestedDate: date }, target?.dueAt ?? null, timezone);
  const earliest = earliestDeferralDate(target?.dueAt ?? null, timezone);

  const submit = async () => {
    if (!target || working.current) return;
    setTouched(true);
    const instant = deferralInstant(date, timezone);
    if (problems.length > 0 || !instant) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await requestPmDeferral(target.scheduleId, { reason: reason.trim(), deferredUntil: instant });
      onRequested();
      onClose();
    } catch (err) {
      setFailure(classifyManagementFailure(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const due = target?.dueAt ? formatDayYear(target.dueAt, timezone, language) : null;
  const dateError = touched ? problems.find((p) => p.startsWith("date_")) : undefined;
  const reasonError = touched ? problems.find((p) => p.startsWith("reason_")) : undefined;

  return (
    <BottomSheet
      visible={visible}
      title={t("pmMgmt.deferral.title")}
      onClose={busy ? () => undefined : onClose}
      tall
      testID="pm-deferral-sheet"
      footer={<Button label={t("pmMgmt.deferral.submit")} onPress={() => void submit()} loading={busy} disabled={!isOnline || busy} size="lg" testID="pm-deferral-submit" />}
    >
      {target ? (
        <View style={sheetStyles.stack}>
          <View accessible accessibilityLabel={`${target.name}. ${target.assetName ?? ""}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3}>
              {target.name}
            </Text>
            {target.assetName ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                {target.assetName}
              </Text>
            ) : null}
            {due ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="pm-deferral-current-due">
                {t("pmMgmt.deferral.currentDue", { date: due })}
              </Text>
            ) : null}
          </View>

          <Note>{t("pmMgmt.deferral.requestNote")}</Note>
          {!isOnline ? <Note tone="warn">{t("pmMgmt.needsConnection")}</Note> : null}

          <DateField label={t("pmMgmt.deferral.newDate")} value={date} onChange={setDate} error={dateError ? t(`pmMgmt.deferral.problem.${dateError}`, { date: earliest ?? "" }) : null} testID="pm-deferral-date" />

          <FieldLabel required>{t("pmMgmt.deferral.reason")}</FieldLabel>
          <TextArea value={reason} onChangeText={setReason} maxLength={DEFERRAL_REASON_MAX} placeholder={t("pmMgmt.deferral.reasonPlaceholder")} accessibilityLabel={t("pmMgmt.deferral.reason")} invalid={!!reasonError} testID="pm-deferral-reason" />
          {reasonError ? <InlineError testID="pm-deferral-reason-error">{t(`pmMgmt.deferral.problem.${reasonError}`)}</InlineError> : null}

          {failure ? <InlineError testID="pm-deferral-error">{t(`pmMgmt.failure.${failure.kind}`)}</InlineError> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", lineHeight: 23 },
  meta: { fontSize: 13, lineHeight: 18, marginTop: 2 },
});
