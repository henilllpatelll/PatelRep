import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { formatDuration, type WorkOrder } from "@/lib/engineering/workOrders";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import {
  completionBlockers,
  offlineCompletionBlock,
  validateCompletion,
  type CompletionDraft,
  type CompletionErrors,
  type CompletionOutcome,
  type LaborSummary,
  type VerificationResult,
} from "@/lib/engineering/repairWorkspace";
import { checklistGate, type ChecklistLoad } from "@/lib/engineering/workOrderChecklist";
import { CodePicker, useRepairCodes } from "./CodePicker";
import { CompletionReadiness } from "./CompletionReadiness";
import { ChoiceChips, FieldLabel, InlineError, Note, TextArea, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  wo: WorkOrder;
  technicianName: string | null;
  labor: LaborSummary;
  laborFailed: boolean;
  photoCount: number;
  /** The last confirmed read of the order's checklist; its server summary decides what is still required. */
  checklist: ChecklistLoad;
  /** Closes this sheet and opens the Checklist tab. */
  onViewChecklist: () => void;
  draft: CompletionDraft;
  onDraft: (next: CompletionDraft) => void;
  onEditParts: () => void;
  /** Sends (or, offline, queues) the completion and says what happened. */
  onSubmit: () => Promise<CompletionOutcome>;
}

const VERIFICATION: readonly VerificationResult[] = ["passed", "failed", "follow_up_required"];

/** Review Completion: the repair story, the verification, then an explicit final review before anything is sent. */
export function CompletionSheet({ visible, onClose, online, wo, technicianName, labor, laborFailed, photoCount, checklist, onViewChecklist, draft, onDraft, onEditParts, onSubmit }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const state = useRepairCodes(wo.category ?? undefined, visible);
  const [stage, setStage] = useState<"form" | "review">("form");
  const [clientErrors, setClientErrors] = useState<CompletionErrors>({});
  const [outcome, setOutcome] = useState<CompletionOutcome | null>(null);
  const { busy, run } = useSheetSubmit();

  const set = (patch: Partial<CompletionDraft>) => onDraft({ ...draft, ...patch });
  const byId = (id: string | null) => state.codes.find((c) => c.id === id);
  const gate = checklistGate(checklist);
  const blockers = completionBlockers(draft, gate, online);
  const offlineBlock = online ? null : offlineCompletionBlock(draft, gate);
  const errors: CompletionErrors = { ...clientErrors, ...(outcome?.kind === "rejected" ? outcome.errors : {}) };
  const hasAsset = Boolean(wo.asset_id || wo.assets?.id);
  const label = workOrderLabel(wo);

  function review() {
    const found = validateCompletion(draft, { problem: byId(draft.problemCodeId) ?? undefined, cause: byId(draft.causeCodeId) ?? undefined, resolution: byId(draft.resolutionCodeId) ?? undefined });
    const checklistBlocker = blockers.find((b) => b.id === "checklist");
    if (checklistBlocker) found.checklist = "required";
    setClientErrors(found);
    setOutcome(null);
    if (Object.keys(found).length === 0) setStage("review");
  }

  async function confirm() {
    await run(async () => {
      const result = await onSubmit();
      setOutcome(result);
      if (result.kind === "completed" || result.kind === "queued") {
        setStage("form");
        onClose();
      } else if (result.kind === "verification_failed") {
        setStage("form");
      } else {
        setStage("form");
      }
    });
  }

  const close = () => {
    setStage("form");
    onClose();
  };

  const footer =
    stage === "form" ? (
      <Button label={t("workOrders.repair.complete.review")} onPress={review} size="lg" icon="clipboard-outline" testID="wo-complete-review" />
    ) : (
      <View style={sheetStyles.stack}>
        <Button
          label={t(online ? "workOrders.repair.complete.confirm" : "workOrders.repair.complete.confirmQueue")}
          onPress={confirm}
          loading={busy}
          disabled={busy || offlineBlock != null}
          size="lg"
          icon="checkmark"
          testID="wo-complete-confirm"
        />
        <Button label={t("workOrders.repair.complete.back")} variant="ghost" onPress={() => setStage("form")} disabled={busy} testID="wo-complete-back" />
      </View>
    );

  return (
    <BottomSheet visible={visible} title={t("workOrders.repair.complete.title")} onClose={close} tall footer={footer} testID="wo-complete-sheet">
      <View style={sheetStyles.stack}>
        {/* Repair summary */}
        <View style={{ gap: 2 }} testID="wo-complete-summary">
          <Text style={{ color: theme.textMuted, fontSize: 12.5, fontWeight: "700" }}>{label ?? ""}</Text>
          <Text style={{ color: theme.textPrimary, fontSize: 16, fontWeight: "700" }}>{wo.title}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13.5 }}>
            {[wo.rooms?.room_number ? t("workOrders.repair.complete.room", { room: wo.rooms.room_number }) : wo.location_text, technicianName, t(`workOrders.status.${wo.status}`)].filter(Boolean).join("  ·  ")}
          </Text>
        </View>

        <CompletionReadiness blockers={blockers} checklist={checklist} online={online} onViewChecklist={() => (setStage("form"), onViewChecklist())} />
        {errors.checklist && gate.kind !== "ready" ? (
          <InlineError testID="wo-err-checklist">
            {t("workOrders.repair.complete.errors.checklist")}
          </InlineError>
        ) : null}

        {stage === "form" ? (
          <>
            {/* Problem, cause and resolution */}
            <CodePicker type="problem" label={t("workOrders.repair.complete.problem")} state={state} selectedId={draft.problemCodeId} otherText={draft.problemOtherText} onSelect={(id) => set({ problemCodeId: id })} onOtherText={(text) => set({ problemOtherText: text })} otherInvalid={!!errors.problemOther} testID="wo-cx-problem" />
            <CodePicker type="cause" label={t("workOrders.repair.complete.cause")} state={state} selectedId={draft.causeCodeId} otherText={draft.causeOtherText} onSelect={(id) => set({ causeCodeId: id })} onOtherText={(text) => set({ causeOtherText: text })} otherInvalid={!!errors.causeOther} testID="wo-cx-cause" />
            <CodePicker type="resolution" label={t("workOrders.repair.complete.resolution")} required state={state} selectedId={draft.resolutionCodeId} otherText={draft.resolutionOtherText} onSelect={(id) => set({ resolutionCodeId: id })} onOtherText={(text) => set({ resolutionOtherText: text })} invalid={!!errors.resolution} otherInvalid={!!errors.resolutionOther} testID="wo-cx-resolution" />
            {errors.resolution ? <InlineError testID="wo-err-resolution">{t("workOrders.repair.complete.errors.resolution")}</InlineError> : null}
            <FieldLabel>{t("workOrders.notesLabel")}</FieldLabel>
            <TextArea value={draft.notes} onChangeText={(notes) => set({ notes })} placeholder={t("workOrders.completionPlaceholder")} testID="completion-notes" accessibilityLabel={t("workOrders.notesLabel")} />

            {/* Labor, parts and evidence: read from the server, edited in their own sheets */}
            <FieldLabel>{t("workOrders.repair.complete.labor")}</FieldLabel>
            <Text style={{ color: theme.textPrimary, fontSize: 14.5 }} testID="wo-complete-labor">
              {laborFailed ? t("workOrders.repair.complete.laborUnknown") : labor.totalMinutes > 0 ? formatDuration(Math.round(labor.totalMinutes)) : t("workOrders.repair.complete.laborNone")}
            </Text>
            {labor.active ? <Note tone="warn">{t("workOrders.repair.complete.laborRunning")}</Note> : null}

            <FieldLabel>{t("workOrders.repair.complete.parts")}</FieldLabel>
            {draft.parts.length === 0 && !draft.freeTextParts.trim() ? (
              <Text style={{ color: theme.textDisabled, fontSize: 13.5 }}>{t("workOrders.repair.parts.none")}</Text>
            ) : (
              <>
                {draft.parts.map((p) => (
                  <Text key={`${p.partId}-${p.locationId}`} style={{ color: theme.textPrimary, fontSize: 14 }}>{p.name} × {p.quantity}</Text>
                ))}
                {draft.freeTextParts.trim() ? <Text style={{ color: theme.textSecondary, fontSize: 13.5 }}>{draft.freeTextParts.trim()}</Text> : null}
              </>
            )}
            {errors.parts ? <InlineError testID="wo-err-parts">{t(errors.parts === "stock" ? "workOrders.repair.complete.errors.stock" : "workOrders.repair.complete.errors.parts")}</InlineError> : null}
            <Button label={t("workOrders.repair.complete.editParts")} variant="secondary" size="sm" icon="construct-outline" onPress={onEditParts} testID="wo-complete-edit-parts" />

            <FieldLabel>{t("workOrders.repair.complete.evidence")}</FieldLabel>
            <Text style={{ color: theme.textPrimary, fontSize: 14.5 }}>{t("workOrders.repair.complete.photos", { count: photoCount })}</Text>

            {/* Verification */}
            <FieldLabel required>{t("workOrders.repair.complete.verification")}</FieldLabel>
            <ChoiceChips
              options={VERIFICATION.map((value) => ({ value, label: t(`workOrders.repair.complete.verify.${value}`), hint: t(`workOrders.repair.complete.verifyHint.${value}`) }))}
              value={draft.verification}
              onChange={(verification) => set({ verification })}
              testIDPrefix="wo-verify"
            />
            {errors.verification ? <InlineError testID="wo-err-verification">{t("workOrders.repair.complete.errors.verification")}</InlineError> : null}
            {draft.verification && draft.verification !== "passed" ? (
              <>
                <FieldLabel required>{t("workOrders.repair.complete.verificationNotes")}</FieldLabel>
                <TextArea value={draft.verificationNotes} onChangeText={(verificationNotes) => set({ verificationNotes })} invalid={!!errors.verificationNotes} testID="wo-verification-notes" accessibilityLabel={t("workOrders.repair.complete.verificationNotes")} />
                {errors.verificationNotes ? <InlineError testID="wo-err-verification-notes">{t("workOrders.repair.complete.errors.verificationNotes")}</InlineError> : null}
              </>
            ) : null}

            {/* Asset restoration */}
            {hasAsset ? (
              <>
                <FieldLabel>{t("workOrders.repair.complete.assetRestoration")}</FieldLabel>
                <ChoiceChips
                  options={(["restore", "keep_unavailable"] as const).map((value) => ({ value, label: t(`workOrders.repair.complete.asset.${value}`) }))}
                  value={draft.assetRestoration}
                  onChange={(assetRestoration) => set({ assetRestoration })}
                  testIDPrefix="wo-asset"
                />
              </>
            ) : null}

            {/* Room impact */}
            {wo.room_id || wo.rooms?.room_number ? <Note>{t("workOrders.repair.complete.roomNote")}</Note> : null}
          </>
        ) : (
          /* Final review */
          <View style={sheetStyles.stack} testID="wo-complete-review-panel">
            <ReviewRow k={t("workOrders.repair.complete.resolution")} v={byId(draft.resolutionCodeId)?.label ?? draft.resolutionOtherText} />
            {draft.problemCodeId || draft.problemOtherText ? <ReviewRow k={t("workOrders.repair.complete.problem")} v={byId(draft.problemCodeId)?.label ?? draft.problemOtherText} /> : null}
            {draft.causeCodeId || draft.causeOtherText ? <ReviewRow k={t("workOrders.repair.complete.cause")} v={byId(draft.causeCodeId)?.label ?? draft.causeOtherText} /> : null}
            <ReviewRow k={t("workOrders.repair.complete.verification")} v={draft.verification ? t(`workOrders.repair.complete.verify.${draft.verification}`) : ""} />
            <ReviewRow k={t("workOrders.repair.complete.labor")} v={labor.totalMinutes > 0 ? formatDuration(Math.round(labor.totalMinutes)) : t("workOrders.repair.complete.laborNone")} />
            <ReviewRow k={t("workOrders.repair.complete.parts")} v={draft.parts.length > 0 ? draft.parts.map((p) => `${p.name} × ${p.quantity}`).join(", ") : draft.freeTextParts.trim() || t("workOrders.repair.parts.none")} />
            <ReviewRow k={t("workOrders.repair.complete.evidence")} v={t("workOrders.repair.complete.photos", { count: photoCount })} />
            {checklist.phase === "ready" && checklist.snapshot.items.length > 0 ? (
              <ReviewRow k={t("workOrders.repair.checklist.title")} v={t("workOrders.repair.checklist.progress", { done: checklist.snapshot.summary.completed, total: checklist.snapshot.summary.total })} />
            ) : null}
            {draft.notes.trim() ? <ReviewRow k={t("workOrders.notesLabel")} v={draft.notes.trim()} /> : null}
            {draft.verification === "failed" ? <Note tone="warn">{t("workOrders.repair.complete.failedNote")}</Note> : null}
            {draft.verification === "follow_up_required" ? <Note tone="warn">{t("workOrders.repair.complete.followUpNote")}</Note> : null}
            {draft.parts.length > 0 ? <Note tone="warn">{t("workOrders.repair.parts.deductNote")}</Note> : null}
          </View>
        )}

        {offlineBlock ? <InlineError testID="wo-offline-block">{t(`workOrders.repair.complete.offlineBlock.${offlineBlock}`)}</InlineError> : null}
        {!online && !offlineBlock ? <Note testID="wo-offline-queue">{t("workOrders.repair.complete.offlineQueue")}</Note> : null}
        <Outcome outcome={outcome} />
      </View>
    </BottomSheet>
  );
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }}>{k}</Text>
      <Text style={{ color: theme.textPrimary, fontSize: 14.5 }}>{v}</Text>
    </View>
  );
}

function Outcome({ outcome }: { outcome: CompletionOutcome | null }) {
  const { t } = useTranslation();
  if (!outcome) return null;
  switch (outcome.kind) {
    case "verification_failed":
      return <Note tone="warn" testID="wo-outcome-failed">{t("workOrders.repair.complete.outcome.verificationFailed")}</Note>;
    case "conflict":
      return <InlineError testID="wo-outcome-conflict">{t("workOrders.repair.complete.outcome.conflict", { message: outcome.message })}</InlineError>;
    case "rejected":
      // A checklist refusal has its own line (with the count and a way to the checklist) above the form.
      if (outcome.errors.checklist) return null;
      return <InlineError testID="wo-outcome-error">{outcome.message || t("workOrders.alerts.completeFailed")}</InlineError>;
    case "failed":
      return <InlineError testID="wo-outcome-error">{outcome.message || t("workOrders.alerts.completeFailed")}</InlineError>;
    default:
      return null;
  }
}
