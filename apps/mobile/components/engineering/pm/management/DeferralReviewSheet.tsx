import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import { decidePmDeferral, type PmDeferralRequest } from "@/lib/api/pmManagement";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import { classifyManagementFailure, type ManagementFailure } from "@/lib/engineering/pmManagement";
import { canReviewPmDeferral } from "@/lib/engineering/roles";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  request: PmDeferralRequest | null;
  role: string | null | undefined;
  userId: string | null | undefined;
  timezone: string | null | undefined;
  language: string;
  isOnline: boolean;
  onClose: () => void;
  /** The server recorded the decision (and, for an approval, moved the due date). */
  onDecided: (decision: "approved" | "rejected") => void;
  /** The request is no longer decidable as shown (decided elsewhere, stale, schedule gone): re-read the list. */
  onNeedsRefresh?: () => void;
}

/**
 * Review PM Deferral. The reviewer is whoever is signed in - never a name typed here - and the server refuses the
 * requester, a second decision and a stale request. A decision is shown only after the API accepts it.
 */
export function DeferralReviewSheet({ visible, request, role, userId, timezone, language, isOnline, onClose, onDecided, onNeedsRefresh }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setPending(null);
    setNote("");
    setFailure(null);
  }, [visible, request?.id]);

  const mayReview = canReviewPmDeferral(role, request?.requested_by, userId);
  const isOwnRequest = !!request && !!userId && request.requested_by === userId;
  const canApprove = mayReview && !!request && !request.stale && request.schedule_active !== false;

  const decide = async (decision: "approved" | "rejected") => {
    if (!request || working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await decidePmDeferral(request.id, decision, note);
      onDecided(decision);
      onClose();
    } catch (err) {
      const classified = classifyManagementFailure(err);
      setFailure(classified);
      setPending(null);
      if (["already_decided", "stale", "expired", "schedule_inactive", "not_found"].includes(classified.kind)) onNeedsRefresh?.();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const day = (value: string | null | undefined) => (value ? formatDayYear(value, timezone, language) : null);
  const rows: Array<[string, string | null]> = request
    ? [
        [t("pmMgmt.review.equipment"), [request.asset_name, request.location_text].filter(Boolean).join(" · ") || null],
        [t("pmMgmt.review.requestedBy"), request.requested_by_name || t("pmMgmt.assign.unknownPerson")],
        [t("pmMgmt.review.requestedOn"), day(request.requested_at)],
        [t("pmMgmt.review.currentDue"), day(request.current_due_at)],
        [t("pmMgmt.review.newDue"), day(request.requested_due_at)],
      ]
    : [];

  return (
    <BottomSheet visible={visible} title={t("pmMgmt.review.title")} onClose={busy ? () => undefined : onClose} tall testID="pm-review-sheet">
      {request ? (
        <View style={sheetStyles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3}>
            {request.schedule_name}
          </Text>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row} accessible accessibilityLabel={`${label}: ${value ?? "-"}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
                {label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                {value ?? "-"}
              </Text>
            </View>
          ))}
          <FieldLabel>{t("pmMgmt.review.reason")}</FieldLabel>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reason, { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle }]} testID="pm-review-reason">
            {request.reason}
          </Text>

          {isOwnRequest ? <Note tone="warn" testID="pm-review-self">{t("pmMgmt.review.ownRequest")}</Note> : null}
          {request.stale ? <Note tone="warn" testID="pm-review-stale">{t("pmMgmt.review.stale")}</Note> : null}
          {request.schedule_active === false ? <Note tone="warn">{t("pmMgmt.review.inactive")}</Note> : null}
          {!isOnline ? <Note tone="warn">{t("pmMgmt.needsConnection")}</Note> : null}

          {pending ? (
            <>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.confirm, { color: theme.textPrimary }]} testID="pm-review-confirm-text">
                {pending === "approved" ? t("pmMgmt.review.confirmApprove", { date: day(request.requested_due_at) ?? "" }) : t("pmMgmt.review.confirmReject")}
              </Text>
              <Button
                label={pending === "approved" ? t("pmMgmt.review.approve") : t("pmMgmt.review.reject")}
                variant={pending === "approved" ? "primary" : "destructive"}
                onPress={() => void decide(pending)}
                loading={busy}
                disabled={busy || !isOnline}
                size="lg"
                testID="pm-review-confirm"
              />
              <Button label={t("common.cancel")} variant="ghost" onPress={() => setPending(null)} disabled={busy} testID="pm-review-back" />
            </>
          ) : (
            <>
              <FieldLabel>{t("pmMgmt.review.note")}</FieldLabel>
              <TextArea value={note} onChangeText={setNote} maxLength={500} placeholder={t("pmMgmt.review.notePlaceholder")} accessibilityLabel={t("pmMgmt.review.note")} testID="pm-review-note" />
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button label={t("pmMgmt.review.reject")} variant="secondary" onPress={() => setPending("rejected")} disabled={!mayReview || !isOnline} size="lg" testID="pm-review-reject" />
                </View>
                <View style={styles.action}>
                  <Button label={t("pmMgmt.review.approve")} onPress={() => setPending("approved")} disabled={!canApprove || !isOnline} size="lg" testID="pm-review-approve" />
                </View>
              </View>
            </>
          )}
          {failure ? <InlineError testID="pm-review-error">{t(`pmMgmt.failure.${failure.kind}`)}</InlineError> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", lineHeight: 23 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 13, fontWeight: "600" },
  value: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  reason: { fontSize: 14, lineHeight: 20, borderRadius: 10, padding: 12 },
  confirm: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1 },
});
