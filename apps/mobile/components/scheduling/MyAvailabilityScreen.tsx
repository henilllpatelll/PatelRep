import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { DateStepper, ErrorText, FieldLabel, TextField } from "@/components/scheduling/formParts";
import { ChipRow, SectionTitle, TimeStepper, FailureNotice } from "@/components/scheduling/requestParts";
import { ScheduleBanner, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { Button } from "@/components/ui/Button";
import {
  addAvailabilityException, fetchMyAvailability, retireAvailability, saveMyAvailability,
  type MyAvailability, type ShiftClash, type Window,
} from "@/lib/api/schedulingRequests";
import { useRemote, useRequestAction } from "@/lib/scheduling/requestHooks";
import {
  addWindow, ALL_DAY, dayError, dayName, DEFAULT_WINDOW, draftFromWeek, firstDayError, removeWindow, sameDrafts, shiftDate, weekPayload,
  windowsLabel, withState, withWindow, type DayDraft,
} from "@/lib/scheduling/requestsModel";
import { clockLabel } from "@/lib/scheduling/requestsModel";
import { formatLongDate, formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import type { DayState } from "@/lib/api/schedulingRequests";

/* ─── My availability ───────────────────────────────────────────────────────
   The signed-in employee tells their supervisor which days and hours they can usually work. This is what they SAY: it is not
   attendance, it is not time off, and saving it never changes a shift they already hold. A day left "Not submitted" is
   unknown to the supervisor, not free. Writes need a connection; the screen reads fine without one. */

const DAY_STATES: readonly DayState[] = ["available", "unavailable", "unset"];

function ClashList({ clashes, language, t }: { clashes: ShiftClash[]; language?: string; t: (key: string, options?: Record<string, unknown>) => string }) {
  const theme = useTheme();
  if (clashes.length === 0) return null;
  return (
    <View style={styles.stack} testID="availability-clashes">
      <SheetNotice tone="warn" text={`${t("scheduling.availabilityScreen.clashTitle")}. ${t("scheduling.availabilityScreen.clashBody")}`} testID="availability-clash-notice" />
      {clashes.map((clash) => (
        <View key={clash.id} style={[styles.clash, { backgroundColor: theme.surfaceSubtle, borderColor: theme.status.pickup }]} testID={`availability-clash-${clash.id}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.strong, { color: theme.textPrimary }]}>
            {`${formatShortDate(clash.workDate, language)} · ${clash.shiftName ?? ""} · ${clockLabel(clash.startTime, language)} – ${clockLabel(clash.endTime, language)}`}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
            {t(clash.availability === "unavailable" ? "scheduling.availabilityScreen.clashUnavailable" : "scheduling.availabilityScreen.clashOutside")}
          </Text>
        </View>
      ))}
    </View>
  );
}

function WindowEditor({ window: w, index, onChange, onRemove, language, t, dayKey, disabled }: {
  window: Window;
  index: number;
  onChange: (patch: Partial<Window>) => void;
  onRemove: () => void;
  language?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  dayKey: string;
  disabled: boolean;
}) {
  const theme = useTheme();
  const allDay = w.start === w.end;
  return (
    <View style={[styles.window, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]} testID={`${dayKey}-window-${index}`}>
      {allDay ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.strong, { color: theme.textPrimary }]}>
          {t("scheduling.availabilityScreen.allDay")}
        </Text>
      ) : (
        <View style={styles.timeRow}>
          <TimeStepper label={t("scheduling.availabilityScreen.startsAt")} value={w.start} onChange={(start) => onChange({ start })} language={language} t={t} disabled={disabled} testID={`${dayKey}-start-${index}`} />
          <TimeStepper label={t("scheduling.availabilityScreen.endsAt")} value={w.end} onChange={(end) => onChange({ end })} language={language} t={t} disabled={disabled} testID={`${dayKey}-end-${index}`} />
        </View>
      )}
      <View style={styles.windowActions}>
        <Button label={t(allDay ? "scheduling.availabilityScreen.setHours" : "scheduling.availabilityScreen.allDay")} size="sm" variant="ghost" disabled={disabled} onPress={() => onChange(allDay ? { ...DEFAULT_WINDOW } : { ...ALL_DAY })} testID={`${dayKey}-allday-${index}`} />
        <Button label={t("scheduling.availabilityScreen.removeWindow")} size="sm" variant="ghost" disabled={disabled} onPress={onRemove} testID={`${dayKey}-remove-${index}`} />
      </View>
    </View>
  );
}

function DayEditor({ day, onChange, language, t, disabled }: { day: DayDraft; onChange: (next: DayDraft) => void; language?: string; t: (key: string, options?: Record<string, unknown>) => string; disabled: boolean }) {
  const theme = useTheme();
  const error = dayError(day);
  const key = `availability-day-${day.weekday}`;
  const name = dayName(day.weekday, t);
  return (
    <View style={[styles.day, { backgroundColor: theme.surfaceSubtle, borderColor: error ? theme.status.dirty : theme.borderSubtle }]} testID={key}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.dayName, { color: theme.textPrimary }]}>
        {name}
      </Text>
      <ChipRow
        options={DAY_STATES}
        value={day.state}
        onChange={(state) => !disabled && onChange(withState(day, state))}
        labelFor={(state) => t(state === "available" ? "scheduling.availabilityScreen.setAvailable" : state === "unavailable" ? "scheduling.availabilityScreen.setUnavailable" : "scheduling.availabilityScreen.clearDay")}
        testID={`${key}-state`}
        wrap
      />
      {day.state === "unset" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
          {t("scheduling.availabilityScreen.unsetHint")}
        </Text>
      ) : null}
      {day.state === "available" ? (
        <View style={styles.stack}>
          {day.windows.map((w, index) => (
            <WindowEditor key={index} window={w} index={index} dayKey={key} language={language} t={t} disabled={disabled} onChange={(patch) => onChange(withWindow(day, index, patch))} onRemove={() => onChange(removeWindow(day, index))} />
          ))}
          {day.windows.length < 4 ? <Button label={t("scheduling.availabilityScreen.addWindow")} size="sm" variant="secondary" disabled={disabled} onPress={() => onChange(addWindow(day))} testID={`${key}-add`} /> : null}
        </View>
      ) : null}
      {error ? <ErrorText text={t(`scheduling.availabilityScreen.error.${error}`, { day: name })} testID={`${key}-error`} /> : null}
    </View>
  );
}

export function MyAvailabilityScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const { today } = useHotelToday();
  const language = i18n.language;
  const remote = useRemote(fetchMyAvailability, []);
  const action = useRequestAction();
  const [saved, setSaved] = useState<MyAvailability | null>(null);
  const [draft, setDraft] = useState<DayDraft[]>(() => draftFromWeek([]));
  const [effective, setEffective] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ShiftClash[]>([]);
  const [resetOnLoad, setResetOnLoad] = useState(false);
  const [exDate, setExDate] = useState<string | null>(null);
  const [exMode, setExMode] = useState<"unavailable" | "available">("unavailable");
  const [exWindow, setExWindow] = useState<Window>({ ...DEFAULT_WINDOW });
  const [exNote, setExNote] = useState("");

  const availability = saved ?? remote.data;
  const baseline = useMemo(() => draftFromWeek(availability?.weekly ?? []), [availability]);
  const dirty = !sameDrafts(draft, baseline) || (effective !== null && effective > today);
  useEffect(() => setSaved(null), [remote.data]);
  // When the server's week changes, the draft follows it unless the person has edited since the last sync (or the server just
  // told us another device saved first, in which case their stale edits are dropped on purpose).
  const syncedWith = useRef<DayDraft[]>(draft);
  useEffect(() => {
    if (!availability) return;
    const edited = !sameDrafts(draft, syncedWith.current);
    if (!edited || resetOnLoad) {
      setDraft(baseline);
      setResetOnLoad(false);
    }
    syncedWith.current = baseline;
  }, [baseline]);

  const offline = !isOnline;
  const problem = firstDayError(draft);
  const startDay = effective ?? today;
  const reload = () => {
    setResetOnLoad(true);
    setNotice(null);
    void remote.refresh();
  };

  const save = async () => {
    if (!availability || problem) return;
    const result = await action.run(() => saveMyAvailability({ expectedRevision: availability.revision, effectiveFrom: effective && effective > today ? effective : null, days: weekPayload(draft) }), reload);
    if (!result) return;
    setSaved(result.availability);
    setDraft(draftFromWeek(result.availability.weekly));
    setEffective(null);
    setClashes(result.clashes);
    setNotice(t(result.replayed ? "scheduling.availabilityScreen.savedReplay" : "scheduling.availabilityScreen.saved"));
  };

  const addException = async () => {
    const date = exDate ?? shiftDate(today, 1);
    const windows = exMode === "available" ? [exWindow] : [];
    if (exMode === "available" && exWindow.start === exWindow.end && exWindow.start !== "00:00") return;
    const result = await action.run(() => addAvailabilityException({ date, mode: exMode, windows, note: exNote }), () => void remote.refresh());
    if (!result) return;
    setClashes(result.clashes);
    setNotice(t("scheduling.availabilityScreen.exceptionAdded"));
    setExNote("");
    void remote.refresh();
  };
  const removeException = async (id: string, version: number) => {
    const done = await action.run(async () => { await retireAvailability(id, version); return true; }, () => void remote.refresh());
    if (!done) return;
    setNotice(t("scheduling.availabilityScreen.exceptionRemoved"));
    void remote.refresh();
  };

  return (
    <ScreenFrame title={t("scheduling.availabilityScreen.title")} kicker={t("scheduling.myRequests.kicker")} fallback="/(app)/scheduling" testID="my-availability">
      {remote.status === "loading" && !availability ? (
        <ScheduleSkeleton rows={4} />
      ) : !availability ? (
        <View style={styles.center} testID="my-availability-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
            {t("scheduling.availabilityScreen.loadFailed")}
          </Text>
          <Button label={t("common.retry")} onPress={() => void remote.refresh()} testID="my-availability-retry" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={remote.refreshing && remote.status === "ready"} onRefresh={() => void remote.refresh()} tintColor={theme.primaryAction} />}
        >
          {offline ? <ScheduleBanner icon="cloud-offline-outline" text={t("scheduling.availabilityScreen.offline")} testID="my-availability-offline" /> : null}
          {remote.failure ? <FailureNotice failure={remote.failure} t={t} testID="my-availability-refresh-failed" /> : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]}>
            {t("scheduling.availabilityScreen.intro")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="my-availability-fresh">
            {availability.lastUpdatedAt ? t("scheduling.availabilityScreen.lastUpdated", { date: formatLongDate(availability.lastUpdatedAt.slice(0, 10), language) }) : t("scheduling.availabilityScreen.neverUpdated")}
          </Text>
          {notice ? <SheetNotice text={notice} testID="my-availability-notice" /> : null}
          {action.failure ? <FailureNotice failure={action.failure} t={t} testID="my-availability-action-failed" /> : null}
          <ClashList clashes={clashes} language={language} t={t} />

          <SectionTitle>{t("scheduling.availabilityScreen.weekTitle")}</SectionTitle>
          {availability.upcomingChange ? (
            <SheetNotice text={`${t("scheduling.availabilityScreen.upcoming", { date: formatLongDate(availability.upcomingChange.effectiveFrom, language) })}: ${availability.upcomingChange.weekly.filter((d) => d.state !== "unset").map((d) => `${dayName(d.weekday, t, "short")} ${d.state === "available" ? windowsLabel(d.windows, language, t) : t("teamSchedule.availability.state.unavailable")}`).join(" · ")}`} testID="my-availability-upcoming" />
          ) : null}
          {draft.map((day) => (
            <DayEditor key={day.weekday} day={day} language={language} t={t} disabled={offline || action.busy} onChange={(next) => setDraft((current) => current.map((d) => (d.weekday === next.weekday ? next : d)))} />
          ))}

          <View style={styles.stack}>
            <FieldLabel>{t("scheduling.availabilityScreen.effective")}</FieldLabel>
            <DateStepper
              label={t("scheduling.availabilityScreen.effective")}
              value={startDay <= today ? t("scheduling.availabilityScreen.effectiveToday") : formatLongDate(startDay, language)}
              onPrev={() => setEffective(startDay <= shiftDate(today, 1) ? null : shiftDate(startDay, -1))}
              onNext={() => setEffective(shiftDate(startDay, 1))}
              prevDisabled={startDay <= today}
              prevLabel={t("scheduling.availabilityScreen.effectiveEarlier")}
              nextLabel={t("scheduling.availabilityScreen.effectiveLater")}
              testID="my-availability-effective"
            />
            {startDay > today ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                {t("scheduling.availabilityScreen.effectiveNote")}
              </Text>
            ) : null}
          </View>

          {dirty ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="my-availability-unsaved">
              {t("scheduling.availabilityScreen.unsaved")}
            </Text>
          ) : null}
          <Button label={t(action.busy ? "scheduling.availabilityScreen.saving" : "scheduling.availabilityScreen.save")} loading={action.busy} disabled={!dirty || Boolean(problem) || offline} onPress={() => void save()} testID="my-availability-save" />
          {dirty ? <Button label={t("scheduling.availabilityScreen.discard")} variant="ghost" disabled={action.busy} onPress={() => { setDraft(baseline); setEffective(null); }} testID="my-availability-discard" /> : null}

          <SectionTitle>{t("scheduling.availabilityScreen.exceptions")}</SectionTitle>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
            {t("scheduling.availabilityScreen.exceptionsHint")}
          </Text>
          {availability.exceptions.length === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]} testID="my-availability-no-exceptions">
              {t("scheduling.availabilityScreen.noExceptions")}
            </Text>
          ) : (
            availability.exceptions.map((ex) => (
              <View key={ex.id} style={[styles.window, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]} testID={`my-availability-exception-${ex.id}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.strong, { color: theme.textPrimary }]}>
                  {ex.mode === "unavailable" ? t("teamSchedule.availability.unavailableOn", { date: formatLongDate(ex.date, language) }) : t("teamSchedule.availability.availableOn", { date: formatLongDate(ex.date, language), windows: windowsLabel(ex.windows, language, t) })}
                </Text>
                {ex.note ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>{ex.note}</Text> : null}
                <Button label={t("scheduling.availabilityScreen.exceptionRemove")} size="sm" variant="ghost" disabled={offline || action.busy} onPress={() => void removeException(ex.id, ex.version)} testID={`my-availability-exception-remove-${ex.id}`} />
              </View>
            ))
          )}
          <View style={[styles.day, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="my-availability-exception-form">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.dayName, { color: theme.textPrimary }]}>
              {t("scheduling.availabilityScreen.addException")}
            </Text>
            <DateStepper
              label={t("scheduling.availabilityScreen.exceptionDate")}
              value={formatLongDate(exDate ?? shiftDate(today, 1), language)}
              onPrev={() => setExDate(shiftDate(exDate ?? shiftDate(today, 1), -1))}
              onNext={() => setExDate(shiftDate(exDate ?? shiftDate(today, 1), 1))}
              prevDisabled={(exDate ?? shiftDate(today, 1)) <= today}
              prevLabel={t("scheduling.timeOffForm.previousDay")}
              nextLabel={t("scheduling.timeOffForm.nextDay")}
              testID="my-availability-exception-date"
            />
            <ChipRow options={["unavailable", "available"] as const} value={exMode} onChange={setExMode} labelFor={(m) => t(m === "available" ? "scheduling.availabilityScreen.setAvailable" : "scheduling.availabilityScreen.setUnavailable")} testID="my-availability-exception-mode" />
            {exMode === "available" ? (
              <View style={styles.timeRow}>
                <TimeStepper label={t("scheduling.availabilityScreen.startsAt")} value={exWindow.start} onChange={(start) => setExWindow({ ...exWindow, start })} language={language} t={t} disabled={offline} testID="my-availability-exception-start" />
                <TimeStepper label={t("scheduling.availabilityScreen.endsAt")} value={exWindow.end} onChange={(end) => setExWindow({ ...exWindow, end })} language={language} t={t} disabled={offline} testID="my-availability-exception-end" />
              </View>
            ) : null}
            <TextField label={t("scheduling.availabilityScreen.exceptionNote")} value={exNote} onChangeText={setExNote} placeholder="" testID="my-availability-exception-note" maxLength={120} />
            <Button label={t("scheduling.availabilityScreen.exceptionSave")} variant="secondary" loading={action.busy} disabled={offline} onPress={() => void addException()} testID="my-availability-exception-save" />
          </View>
        </ScrollView>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  stack: { gap: 10 },
  value: { fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: "700" },
  muted: { fontSize: 13, lineHeight: 18 },
  day: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  dayName: { fontSize: 17, fontWeight: "800" },
  window: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  windowActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  timeRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  clash: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
});
