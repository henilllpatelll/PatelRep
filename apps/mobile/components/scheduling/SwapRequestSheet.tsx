import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { CoverageSheet } from "@/components/scheduling/CoverageSheet";
import { TextField } from "@/components/scheduling/formParts";
import { Fact, FailureNotice, SectionTitle } from "@/components/scheduling/requestParts";
import { ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { Button } from "@/components/ui/Button";
import { fetchSwapOptions, newRequestKey, proposeSwap, type Person, type ShiftBrief } from "@/lib/api/schedulingRequests";
import { useRemote, useRequestAction } from "@/lib/scheduling/requestHooks";
import { clockLabel, findingText } from "@/lib/scheduling/requestsModel";
import { formatLongDate, formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import { roleLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Request a shift swap (employee) ───────────────────────────────────────
   Starts from one of the employee's OWN shifts. The server lists the coworker shifts that could be exchanged for it (same
   department, nothing overlapping, nobody on approved leave); the employee picks one and sends it. Sending changes nothing on
   the schedule: the coworker must accept, then a supervisor approves, and only then do the two shifts trade people. */

export interface SwapSource {
  id: string;
  workDate: string;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
}

interface Props {
  source: SwapSource | null;
  isOnline: boolean;
  language?: string;
  onClose: () => void;
  onSent: () => void;
  t: Translate;
}

function line(shift: Pick<ShiftBrief, "workDate" | "shiftName" | "startTime" | "endTime">, language: string | undefined, t: Translate): string {
  return t("teamSchedule.requests.swap.shiftLine", {
    date: formatShortDate(shift.workDate, language), shift: shift.shiftName ?? t("teamSchedule.coverage.shiftFallback"),
    window: `${clockLabel(shift.startTime, language)} – ${clockLabel(shift.endTime, language)}`,
  });
}

export function SwapRequestSheet({ source, isOnline, language, onClose, onSent, t }: Props) {
  const theme = useTheme();
  const action = useRequestAction();
  const options = useRemote(() => fetchSwapOptions(source?.id ?? ""), [source?.id], Boolean(source));
  const [picked, setPicked] = useState<{ person: Person; shift: ShiftBrief & { warnings: string[] } } | null>(null);
  const [note, setNote] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  // One key per (my shift, their shift, note): resending the same unconfirmed request cannot create two.
  const key = useMemo(() => newRequestKey("swap"), [source?.id, picked?.shift.id, note]);
  if (!source) return null;

  const close = () => {
    setPicked(null);
    setNote("");
    setSentTo(null);
    action.clear();
    onClose();
  };
  const send = async () => {
    if (!picked) return;
    const result = await action.run(() => proposeSwap({ myAssignmentId: source.id, theirAssignmentId: picked.shift.id, note, idempotencyKey: key }));
    if (!result) return;
    setSentTo(picked.person.name ?? "—");
    onSent();
  };
  const data = options.data;
  const offline = !isOnline;

  return (
    <CoverageSheet visible title={t("scheduling.swapSheet.title")} subtitle={line(source, language, t)} closeLabel={t("teamSchedule.requests.detail.close")} onClose={close} testID="swap-sheet">
      {offline ? <SheetNotice tone="warn" text={t("scheduling.swapSheet.offline")} testID="swap-sheet-offline" /> : null}
      {sentTo ? (
        <>
          <View style={[styles.done, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="swap-sent">
            <Ionicons name="paper-plane-outline" size={26} color={theme.primaryAction} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              {t("scheduling.swapSheet.sent")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]}>
              {t("scheduling.swapSheet.sentBody", { name: sentTo })}
            </Text>
          </View>
          <Button label={t("scheduling.timeOffForm.done")} onPress={close} testID="swap-sent-done" />
        </>
      ) : picked ? (
        <>
          <SectionTitle>{t("scheduling.swapSheet.reviewTitle")}</SectionTitle>
          <Fact label={t("scheduling.swapSheet.youGive")}>{line(source, language, t)}</Fact>
          <Fact label={t("scheduling.swapSheet.youTake")}>{`${line(picked.shift, language, t)} · ${picked.person.name ?? ""}${picked.person.role ? ` (${roleLabel(picked.person.role, t)})` : ""}`}</Fact>
          {picked.shift.warnings.length > 0 ? (
            <>
              <SectionTitle>{t("scheduling.swapSheet.warnings")}</SectionTitle>
              {picked.shift.warnings.map((code) => <SheetNotice key={code} tone="warn" text={findingText(code, t)} testID={`swap-sheet-warning-${code}`} />)}
            </>
          ) : null}
          <SheetNotice text={t("teamSchedule.requests.swap.acceptNote")} testID="swap-sheet-explain" />
          <TextField label={t("scheduling.swapSheet.note", { name: picked.person.name ?? "—" })} value={note} onChangeText={setNote} placeholder="" testID="swap-sheet-note" maxLength={120} />
          {action.failure ? <FailureNotice failure={action.failure} t={t} testID="swap-sheet-failed" /> : null}
          <Button label={t(action.busy ? "scheduling.swapSheet.sending" : "scheduling.swapSheet.send")} loading={action.busy} disabled={offline} onPress={() => void send()} testID="swap-sheet-send" />
          <Button label={t("scheduling.swapSheet.back")} variant="ghost" disabled={action.busy} onPress={() => { setPicked(null); action.clear(); }} testID="swap-sheet-back" />
        </>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textSecondary }]}>
            {t("scheduling.swapSheet.intro")}
          </Text>
          {!data ? (
            options.failure ? (
              <>
                <FailureNotice failure={options.failure} t={t} testID="swap-sheet-load-failed" />
                <Button label={t("scheduling.swapSheet.retry")} variant="secondary" onPress={() => void options.refresh()} testID="swap-sheet-retry" />
              </>
            ) : <ScheduleSkeleton rows={3} />
          ) : data.options.length === 0 ? (
            <SheetNotice text={t(data.reason === "shift_unavailable_for_swap" ? "scheduling.swapSheet.unavailable" : "scheduling.swapSheet.none")} testID="swap-sheet-none" />
          ) : (
            <>
              <SectionTitle>{t("scheduling.swapSheet.choose")}</SectionTitle>
              {data.options.map((option) => (
                <View key={option.person.id} style={styles.group} testID={`swap-option-${option.person.id}`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.strong, { color: theme.textPrimary }]}>
                    {`${option.person.name ?? t("teamSchedule.unnamed")}${option.person.role ? ` · ${roleLabel(option.person.role, t)}` : ""}`}
                  </Text>
                  {option.shifts.map((shift) => (
                    <Pressable
                      key={shift.id}
                      onPress={() => setPicked({ person: option.person, shift })}
                      accessibilityRole="button"
                      accessibilityLabel={t("scheduling.swapSheet.pick", { name: option.person.name ?? "—", date: formatLongDate(shift.workDate, language), shift: shift.shiftName ?? "" })}
                      testID={`swap-option-shift-${shift.id}`}
                      style={({ pressed }) => [styles.shift, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }, pressed && { opacity: 0.8 }]}
                    >
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, styles.flex, { color: theme.textPrimary }]}>
                        {line(shift, language, t)}
                      </Text>
                      {shift.warnings.length > 0 ? <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} /> : null}
                      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                    </Pressable>
                  ))}
                </View>
              ))}
            </>
          )}
        </>
      )}
    </CoverageSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  shift: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  flex: { flex: 1 },
  value: { fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: "700" },
  title: { fontSize: 20, fontWeight: "800" },
  done: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
});
