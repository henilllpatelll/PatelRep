import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import { useSheetSubmit } from "@/components/engineering/workorder/useSheetSubmit";
import { createRoomUnavailability, getActiveRoomPeriod, listAvailabilityReasons, updateExpectedReturn } from "@/lib/api/engineeringRooms";
import {
  EMPTY_AVAILABILITY_DRAFT,
  NOTE_MAX,
  buildCreateBody,
  etaNeedsNote,
  interpretCreate,
  validateAvailability,
  validateEtaChange,
  type AvailabilityDraft,
  type AvailabilityReason,
  type CreateOutcome,
} from "@/lib/engineering/roomAvailability";
import type { RoomUnavailability } from "@/lib/engineering/roomModel";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { RoomDownFields, ReturnTimePicker } from "./RoomDownFields";
import { formatWhen } from "./roomUi";

type Mode = "create" | "eta";
type Step = "form" | "review" | "done";

interface Props {
  visible: boolean;
  mode: Mode;
  roomId: string;
  roomNumber: string;
  isOnline: boolean;
  locale: string;
  /** The active period (required for `eta`). */
  period: RoomUnavailability | null;
  /** Repairs the viewer can see in this room, offered as the repair this unavailability is for. */
  repairs: readonly WorkOrder[];
  onClose: () => void;
  /** The server confirmed a change; the screen re-reads the room. */
  onChanged: () => void;
}

/**
 * Manage Room Availability. Goes through the dedicated /room-unavailability API only, never a room-status PATCH.
 * The server is the authority: a result is shown as done only from its own answer, and an answer that is not the
 * one asked for (the room was already down) is reported as such rather than as a success.
 */
export function RoomAvailabilitySheet({ visible, mode, roomId, roomNumber, isOnline, locale, period, repairs, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useState<AvailabilityDraft>(EMPTY_AVAILABILITY_DRAFT);
  const [note, setNote] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [showErrors, setShowErrors] = useState(false);
  const [reasons, setReasons] = useState<readonly AvailabilityReason[]>([]);
  const [reasonsFailed, setReasonsFailed] = useState(false);
  const [result, setResult] = useState<CreateOutcome | { kind: "eta" } | { kind: "reconciled"; matches: boolean } | null>(null);
  const { busy, error, setError, run } = useSheetSubmit();
  const wasVisible = useRef(false);

  // Each opening starts clean: a closed, dismissed or completed request is not carried into the next one.
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setDraft(mode === "eta" ? { ...EMPTY_AVAILABILITY_DRAFT, returnAt: null } : EMPTY_AVAILABILITY_DRAFT);
      setNote("");
      setStep("form");
      setShowErrors(false);
      setResult(null);
      setError(null);
    }
    wasVisible.current = visible;
  }, [visible, mode, setError]);

  useEffect(() => {
    if (!visible || mode !== "create" || reasons.length > 0 || !isOnline) return;
    const abort = new AbortController();
    listAvailabilityReasons(abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) {
          setReasons(list);
          setReasonsFailed(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setReasonsFailed(true);
      });
    return () => abort.abort();
  }, [visible, mode, reasons.length, isOnline]);

  const errors = validateAvailability(draft);
  const currentEta = period?.expected_return_at ? new Date(period.expected_return_at) : null;
  const etaErrors = validateEtaChange(currentEta, draft.returnAt, note);
  const reason = reasons.find((r) => r.code === draft.reasonCode);
  const linked = repairs.find((wo) => wo.id === draft.workOrderId) ?? null;

  function goReview() {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep("review");
  }

  async function submitCreate() {
    const body = buildCreateBody(roomId, draft, reasons);
    if (!body) return;
    await run(async () => {
      try {
        const answer = await createRoomUnavailability(body);
        const outcome = interpretCreate(body, answer);
        if (!outcome) throw new Error(t("engRooms.down.noAnswer"));
        setResult(outcome);
        setStep("done");
        onChanged();
      } catch (err) {
        const status = (err as { status?: unknown } | null)?.status;
        if (typeof status === "number" && status < 500) throw err; // the server said no; nothing was recorded
        // No answer: ask the room what is true before telling the person anything.
        let active: Awaited<ReturnType<typeof getActiveRoomPeriod>> = null;
        try {
          active = await getActiveRoomPeriod(roomId);
        } catch {
          throw new Error(t("engRooms.down.unconfirmed"));
        }
        if (!active) throw new Error(t("engRooms.down.notRecorded"));
        const outcome = interpretCreate(body, { period: active });
        setResult(outcome ?? { kind: "reconciled", matches: false });
        setStep("done");
        onChanged();
      }
    });
  }

  async function submitEta() {
    if (!period?.id || !draft.returnAt) return;
    if (etaErrors.length > 0) {
      setShowErrors(true);
      return;
    }
    const next = draft.returnAt;
    const ok = await run(async () => {
      await updateExpectedReturn(period.id, next, note);
    });
    if (ok) {
      setResult({ kind: "eta" });
      setStep("done");
      onChanged();
    }
  }

  const title = mode === "eta" ? t("engRooms.eta.title") : t("engRooms.manage.title");
  const offlineBlock = !isOnline;

  const footer =
    step === "done" ? (
      <Button label={t("common.done")} onPress={onClose} size="lg" testID="availability-done" />
    ) : mode === "eta" ? (
      <Button label={t("engRooms.eta.confirm")} onPress={submitEta} loading={busy} disabled={busy || offlineBlock} size="lg" testID="availability-eta-confirm" />
    ) : step === "form" ? (
      <Button label={t("engRooms.manage.review")} onPress={goReview} disabled={busy || offlineBlock} size="lg" testID="availability-review" />
    ) : (
      <View style={sheetStyles.stack}>
        <Button label={t("engRooms.manage.confirm")} onPress={submitCreate} loading={busy} disabled={busy || offlineBlock} size="lg" testID="availability-confirm" />
        <Button label={t("engRooms.manage.back")} variant="ghost" onPress={() => setStep("form")} disabled={busy} testID="availability-back" />
      </View>
    );

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose} tall footer={footer} scrollKey={`${step}:${error ?? ""}`} testID="availability-sheet">
      <View style={sheetStyles.stack}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5 }}>
          {t("engRooms.manage.subtitle", { room: roomNumber })}
        </Text>
        {offlineBlock ? <Note tone="warn" testID="availability-offline">{t("engRooms.manage.offline")}</Note> : null}

        {step === "done" ? (
          <DoneBlock result={result} roomNumber={roomNumber} locale={locale} />
        ) : mode === "eta" ? (
          <View style={sheetStyles.stack}>
            {currentEta ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 13.5 }}>
                {t("engRooms.eta.current", { time: formatWhen(currentEta, locale) })}
              </Text>
            ) : null}
            <FieldLabel required>{t("engRooms.down.returnTitle")}</FieldLabel>
            <ReturnTimePicker value={draft.returnAt} onChange={(returnAt) => setDraft((d) => ({ ...d, returnAt }))} locale={locale} disabled={busy} testIDPrefix="eta" />
            {showErrors && etaErrors.includes("return_required") ? <InlineError>{t("engRooms.down.errors.return_required")}</InlineError> : null}
            {showErrors && etaErrors.includes("return_past") ? <InlineError>{t("engRooms.down.errors.return_past")}</InlineError> : null}
            {showErrors && etaErrors.includes("unchanged") ? <InlineError>{t("engRooms.eta.unchanged")}</InlineError> : null}
            <FieldLabel required={etaNeedsNote(currentEta, draft.returnAt)}>{t("engRooms.eta.note")}</FieldLabel>
            <TextArea value={note} onChangeText={setNote} maxLength={NOTE_MAX} editable={!busy} placeholder={t("engRooms.eta.notePlaceholder")} accessibilityLabel={t("engRooms.eta.note")} invalid={showErrors && etaErrors.includes("note_required")} testID="eta-note" />
            {etaNeedsNote(currentEta, draft.returnAt) ? <Note tone="warn">{t("engRooms.eta.laterNeedsNote")}</Note> : null}
            {showErrors && etaErrors.includes("note_required") ? <InlineError>{t("engRooms.eta.noteRequired")}</InlineError> : null}
          </View>
        ) : step === "form" ? (
          <View style={sheetStyles.stack}>
            <RoomDownFields
              draft={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              reasons={reasons}
              reasonsFailed={reasonsFailed}
              errors={errors}
              showErrors={showErrors}
              locale={locale}
              disabled={busy}
              testIDPrefix="availability"
            />
            <FieldLabel>{t("engRooms.manage.linkedRepair")}</FieldLabel>
            {repairs.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13 }}>
                {t("engRooms.manage.noRepairs")}
              </Text>
            ) : (
              <View style={sheetStyles.stack}>
                {repairs.map((wo) => {
                  const selected = draft.workOrderId === wo.id;
                  return (
                    <Pressable
                      key={wo.id}
                      onPress={() => setDraft((d) => ({ ...d, workOrderId: selected ? null : wo.id }))}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`availability-repair-${wo.id}`}
                      style={[styles.repair, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle }]}
                    >
                      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={18} color={selected ? theme.primaryAction : theme.textMuted} />
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.repairText, { color: theme.textPrimary }]} numberOfLines={2}>
                        {[workOrderLabel(wo), wo.title].filter(Boolean).join(" · ")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : (
          <View style={sheetStyles.stack}>
            <ReviewRow label={t("engRooms.manage.review_room")} value={roomNumber} />
            <ReviewRow label={t("engRooms.down.type")} value={draft.type ? t(`engRooms.down.types.${draft.type}`) : ""} />
            <ReviewRow label={t("engRooms.down.reason")} value={reason?.label ?? ""} />
            <ReviewRow label={t("engRooms.manage.review_start")} value={t("engRooms.manage.review_startNow")} />
            <ReviewRow label={t("engRooms.down.returnTitle")} value={draft.returnAt ? formatWhen(draft.returnAt, locale) : ""} />
            <ReviewRow label={t("engRooms.manage.linkedRepair")} value={linked ? [workOrderLabel(linked), linked.title].filter(Boolean).join(" · ") : t("engRooms.manage.none")} />
            {draft.details.trim() ? <ReviewRow label={t("engRooms.down.details")} value={draft.details.trim()} /> : null}
            <View style={[styles.impact, { backgroundColor: theme.status.pickupSoft }]}>
              <Ionicons name="information-circle-outline" size={16} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.impactText, { color: theme.textPrimary }]}>
                {t(draft.type === "OUT_OF_SERVICE" ? "engRooms.manage.impactOos" : "engRooms.manage.impactOoo")}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
              {t("engRooms.pmsNote")}
            </Text>
          </View>
        )}

        {error ? <InlineError testID="availability-error">{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.reviewRow}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reviewLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reviewValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function DoneBlock({ result, roomNumber, locale }: { result: unknown; roomNumber: string; locale: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const r = result as { kind: string; period?: { type?: string; expected_return_at?: string | null }; roomStatus?: string | null; matches?: boolean } | null;
  const already = r?.kind === "already_active" || (r?.kind === "reconciled" && !r.matches);
  const eta = r?.kind === "eta";
  const periodType = r?.period?.type === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "OUT_OF_ORDER";
  return (
    <View style={sheetStyles.stack} accessibilityLiveRegion="polite" testID="availability-result">
      <View style={styles.doneHead}>
        <Ionicons name={already ? "alert-circle-outline" : "checkmark-circle"} size={22} color={already ? theme.status.pickup : theme.status.ready} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.doneTitle, { color: theme.textPrimary }]}>
          {eta ? t("engRooms.eta.done") : already ? t("engRooms.manage.alreadyTitle") : t("engRooms.manage.doneTitle")}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20 }}>
        {eta
          ? t("engRooms.eta.doneBody")
          : already
            ? t("engRooms.manage.alreadyBody", { room: roomNumber, type: t(`engRooms.down.types.${periodType}`), time: formatWhen(r?.period?.expected_return_at ?? null, locale) })
            : t("engRooms.manage.doneBody", { room: roomNumber, type: t(`engRooms.down.types.${periodType}`) })}
      </Text>
      {!eta && r?.roomStatus ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13 }}>
          {t("engRooms.manage.serverState", { status: t(`roomStatus.statusLabels.${r.roomStatus}`, { defaultValue: r.roomStatus }) })}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
        {t("engRooms.pmsNote")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  repair: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  repairText: { flex: 1, fontSize: 14 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  reviewLabel: { fontSize: 13, flexShrink: 0, maxWidth: "40%" },
  reviewValue: { fontSize: 14, fontWeight: "600", flex: 1, textAlign: "right" },
  impact: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, alignItems: "flex-start" },
  impactText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  doneHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  doneTitle: { fontSize: 17, fontWeight: "700", flex: 1 },
});
