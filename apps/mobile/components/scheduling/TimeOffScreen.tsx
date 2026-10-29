import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { DateStepper, ErrorText, FieldLabel, TextField } from "@/components/scheduling/formParts";
import { ChipRow, Fact, FailureNotice, StatePill, TimeStepper } from "@/components/scheduling/requestParts";
import { RequestSheet } from "@/components/scheduling/RequestSheet";
import { ScheduleBanner } from "@/components/scheduling/ScheduleStates";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { Button } from "@/components/ui/Button";
import { createTimeOff, newRequestKey, REASON_CATEGORIES, type ReasonCategory, type RequestItem, type TimeOffRequest } from "@/lib/api/schedulingRequests";
import { useRequestAction } from "@/lib/scheduling/requestHooks";
import { clockLabel, dateRangeLabel, daysBetween, emptyLeaveDraft, leaveError, reasonText, shiftDate, statusText, withPartial, withStartDate, type LeaveDraft } from "@/lib/scheduling/requestsModel";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Request time off ──────────────────────────────────────────────────────
   Employee-facing form. The request is saved as PENDING: it changes no shift and it is not approved until the supervisor
   decides. The reason is a coarse category, so nobody has to describe a health matter. The date and time pickers step
   (no typing). A retry of an unconfirmed send reuses its key, so it can never create a second request. */

function itemOf(request: TimeOffRequest): RequestItem {
  return {
    type: "time_off", id: request.id, status: request.status, statusGroup: "pending", user: request.user, counterpart: null, dateFrom: request.startDate,
    dateTo: request.endDate, submittedAt: request.createdAt, version: request.version, needsAction: false, needsMyResponse: false,
    leave: { partial: request.partial, startTime: request.startTime, endTime: request.endTime, reason: request.reason }, swap: null, shiftCount: null,
  };
}

export function TimeOffScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const { today } = useHotelToday();
  const language = i18n.language;
  const action = useRequestAction();
  const [draft, setDraft] = useState<LeaveDraft>(() => emptyLeaveDraft(today));
  const [sent, setSent] = useState<TimeOffRequest | null>(null);
  const [viewing, setViewing] = useState(false);
  const [touched, setTouched] = useState(false);
  const signature = JSON.stringify(draft);
  // One key per distinct request body: a retry of the SAME unconfirmed send is recognised, an edited form is a new request.
  const key = useMemo(() => newRequestKey("leave"), [signature]);

  const problem = leaveError(draft, today);
  const offline = !isOnline;
  const set = (patch: Partial<LeaveDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const send = async () => {
    setTouched(true);
    if (problem || !draft.reason) return;
    const result = await action.run(() => createTimeOff({
      startDate: draft.startDate, endDate: draft.endDate, partial: draft.partial, startTime: draft.startTime, endTime: draft.endTime,
      reason: draft.reason as ReasonCategory, note: draft.note, idempotencyKey: key,
    }));
    if (result) setSent(result);
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/scheduling" as never));

  const dayCount = daysBetween(draft.startDate, draft.endDate);

  return (
    <ScreenFrame title={t("scheduling.timeOffForm.title")} kicker={t("scheduling.myRequests.kicker")} fallback="/(app)/scheduling" testID="time-off">
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {offline ? <ScheduleBanner icon="cloud-offline-outline" text={t("scheduling.timeOffForm.offline")} testID="time-off-offline" /> : null}
        {sent ? (
          <View style={styles.stack} testID="time-off-sent">
            <View style={[styles.sent, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
              <Ionicons name="paper-plane-outline" size={28} color={theme.primaryAction} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
                {t("scheduling.timeOffForm.sent")}
              </Text>
              <StatePill text={statusText(sent.status, t)} tone="warn" testID="time-off-sent-status" />
              <Fact label={t("teamSchedule.requests.detail.dates")}>
                {sent.partial ? `${formatLongDate(sent.startDate, language)} · ${clockLabel(sent.startTime, language)} – ${clockLabel(sent.endTime, language)}` : dateRangeLabel(sent.startDate, sent.endDate, language)}
              </Fact>
              <Fact label={t("teamSchedule.requests.detail.reason")}>{reasonText(sent.reason, t)}</Fact>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]}>
                {t("scheduling.timeOffForm.sentBody")}
              </Text>
            </View>
            <Button label={t("scheduling.timeOffForm.viewRequest")} variant="secondary" onPress={() => setViewing(true)} testID="time-off-view" />
            <Button label={t("scheduling.timeOffForm.another")} variant="ghost" onPress={() => { setSent(null); setDraft(emptyLeaveDraft(today)); setTouched(false); }} testID="time-off-another" />
            <Button label={t("scheduling.timeOffForm.done")} onPress={back} testID="time-off-done" />
          </View>
        ) : (
          <>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]}>
              {t("scheduling.timeOffForm.intro")}
            </Text>

            <View style={styles.stack}>
              <FieldLabel>{t("scheduling.timeOffForm.start")}</FieldLabel>
              <DateStepper label={t("scheduling.timeOffForm.start")} value={formatLongDate(draft.startDate, language)} onPrev={() => setDraft(withStartDate(draft, shiftDate(draft.startDate, -1)))} onNext={() => setDraft(withStartDate(draft, shiftDate(draft.startDate, 1)))} prevDisabled={draft.startDate <= today} prevLabel={t("scheduling.timeOffForm.previousDay")} nextLabel={t("scheduling.timeOffForm.nextDay")} testID="time-off-start" />
            </View>

            <Pressable onPress={() => setDraft(withPartial(draft, !draft.partial))} accessibilityRole="checkbox" accessibilityState={{ checked: draft.partial }} accessibilityLabel={t("scheduling.timeOffForm.partial")} testID="time-off-partial" style={[styles.toggle, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]}>
              <Ionicons name={draft.partial ? "checkbox" : "square-outline"} size={22} color={draft.partial ? theme.primaryAction : theme.textMuted} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.flex, { color: theme.textPrimary }]}>
                {t("scheduling.timeOffForm.partial")}
              </Text>
            </Pressable>

            {draft.partial ? (
              <View style={styles.stack}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                  {t("scheduling.timeOffForm.partialHint")}
                </Text>
                <View style={styles.timeRow}>
                  <TimeStepper label={t("scheduling.timeOffForm.from")} value={draft.startTime} onChange={(startTime) => set({ startTime })} language={language} t={t} testID="time-off-from" />
                  <TimeStepper label={t("scheduling.timeOffForm.to")} value={draft.endTime} onChange={(endTime) => set({ endTime })} language={language} t={t} testID="time-off-to" />
                </View>
              </View>
            ) : (
              <View style={styles.stack}>
                <FieldLabel>{t("scheduling.timeOffForm.end")}</FieldLabel>
                <DateStepper label={t("scheduling.timeOffForm.end")} value={formatLongDate(draft.endDate, language)} onPrev={() => set({ endDate: shiftDate(draft.endDate, -1) })} onNext={() => set({ endDate: shiftDate(draft.endDate, 1) })} prevDisabled={draft.endDate <= draft.startDate} prevLabel={t("scheduling.timeOffForm.previousDay")} nextLabel={t("scheduling.timeOffForm.nextDay")} testID="time-off-end" />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="time-off-days">
                  {dayCount === 1 ? t("scheduling.timeOffForm.oneDay") : t("scheduling.timeOffForm.days", { count: dayCount })}
                </Text>
              </View>
            )}

            <View style={styles.stack}>
              <FieldLabel>{t("scheduling.timeOffForm.reason")}</FieldLabel>
              <ChipRow options={REASON_CATEGORIES} value={(draft.reason ?? "") as ReasonCategory} onChange={(reason) => set({ reason })} labelFor={(reason) => reasonText(reason, t)} testID="time-off-reason" wrap />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                {t("scheduling.timeOffForm.reasonHint")}
              </Text>
            </View>

            <TextField label={t("scheduling.timeOffForm.note")} value={draft.note} onChangeText={(note) => set({ note })} placeholder={t("scheduling.timeOffForm.notePlaceholder")} multiline maxLength={500} testID="time-off-note" />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("scheduling.timeOffForm.overlapHint")}
            </Text>

            {touched && problem ? <ErrorText text={problem === "reason_required" ? t("scheduling.timeOffForm.errors.reason_required") : t(`teamSchedule.requests.failure.${problem}`)} testID="time-off-problem" /> : null}
            {action.failure ? <FailureNotice failure={action.failure} t={t} testID="time-off-failed" /> : null}
            {action.failure?.kind === "unconfirmed" ? <SheetNotice text={t("teamSchedule.requests.failure.unconfirmed")} testID="time-off-unconfirmed" /> : null}
            <Button label={t(action.busy ? "scheduling.timeOffForm.sending" : "scheduling.timeOffForm.send")} loading={action.busy} disabled={offline || (touched && Boolean(problem))} onPress={() => void send()} testID="time-off-send" />
          </>
        )}
      </ScrollView>
      {viewing && sent ? <RequestSheet item={itemOf(sent)} isOnline={isOnline} language={language} onClose={() => setViewing(false)} onChanged={() => undefined} t={t} /> : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  stack: { gap: 10 },
  flex: { flex: 1 },
  value: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 13, lineHeight: 18 },
  title: { fontSize: 20, fontWeight: "800" },
  timeRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12 },
  sent: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
});
