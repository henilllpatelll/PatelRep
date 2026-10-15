import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/Button";
import { ConfirmRows } from "@/components/ai/ConfirmRows";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { CopilotFailure, type CopilotFailureKind } from "@/lib/ai/contract";
import { isAbort } from "@/lib/ai/copilotChat";
import { analyzeIssuePhoto } from "@/lib/ai/photoAnalysis";
import {
  EMPTY_MAINTENANCE_DRAFT,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_DETAILS_MAX,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_TITLE_MAX,
  attachMaintenancePhoto,
  buildMaintenancePayload,
  createMaintenanceWorkOrder,
  isMaintenanceDirty,
  validateMaintenance,
  type MaintenanceDraft,
  type MaintenanceErrors,
} from "@/lib/housekeeping/maintenanceReport";
import { newSessionId } from "@/lib/housekeeping/cleanSession";
import { discardLocalPhoto } from "@/lib/housekeeping/photoAsset";
import {
  EMPTY_PROVENANCE,
  applyDescriptionField,
  applyDescriptionSuggestion,
  applyPhotoSuggestion,
  descriptionSuggestionIsCurrent,
  hasSuggestedFields,
  photoSuggestionIsCurrent,
  reportSummaryRows,
  touchField,
  type DescriptionSuggestion,
  type PhotoSuggestion,
  type ReportField,
  type ReportProvenance,
  type YesNo,
} from "@/lib/housekeeping/reportDraft";
import { suggestReportFromDescription } from "@/lib/housekeeping/suggestReport";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { useVoiceInput, type VoiceState } from "@/lib/tasks/addTask/useVoiceInput";
import { BottomSheet, MAX_FONT_SCALE } from "./roomDetail/BottomSheet";
import { Chip, FieldError, FieldLabel, StatusText, TextArea } from "./roomDetail/FormBits";
import { PhotoAttachment } from "./roomDetail/PhotoAttachment";
import { DescriptionAssist, PhotoAssist } from "./roomDetail/ReportAssist";

interface ReportIssueModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

/** Fewest characters worth sending to the AI. */
const MIN_AI_CHARS = 8;

type Step = "form" | "review";
type AssistStatus = "idle" | "loading" | "none" | "failed";

const VOICE_STATUS: Partial<Record<VoiceState, string>> = {
  requesting: "reportIssue.voice.requesting",
  listening: "reportIssue.voice.listening",
  processing: "reportIssue.voice.processing",
  denied: "reportIssue.voice.denied",
  nospeech: "reportIssue.voice.nospeech",
  error: "reportIssue.voice.error",
};

/**
 * Report maintenance / damage. Creates a normal work order (offline it goes to the
 * existing work-order queue and is labelled "saved", not "submitted"). A photo
 * needs a connection; if the work order is created but the photo fails, the sheet
 * stays on that work order and retries only the photo — never a second work order.
 *
 * The form can be filled in by hand, by dictation, or with optional AI help (a description read, a photo
 * looked at). The help only proposes: each suggestion is applied by an explicit press, shown as a suggestion,
 * and can be edited; when any was used the report is reviewed in the same confirmation summary the assistant
 * uses before anything is created. Everything works with the AI switched off or out of credit.
 */
export default function ReportIssueModal({ visible, roomId, roomNumber, onClose }: ReportIssueModalProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isOnline = useAppStore((state) => state.isOnline);
  const userId = useAppStore((state) => state.user?.id);
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? "en";

  const [draft, setDraft] = useState<MaintenanceDraft>(EMPTY_MAINTENANCE_DRAFT);
  const [provenance, setProvenance] = useState<ReportProvenance>(EMPTY_PROVENANCE);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  /** Changes whenever the photo does, so an analysis can tell which photo it was about. */
  const [photoVersion, setPhotoVersion] = useState(0);
  const [step, setStep] = useState<Step>("form");
  const [errors, setErrors] = useState<MaintenanceErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The work order exists on the server but its photo has not uploaded. */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const mayHaveBeenSent = useRef(false);
  /** Stable for this report until it is submitted or discarded. */
  const requestId = useRef(newSessionId());
  const busyRef = useRef(false);

  // AI help from the description.
  const [descStatus, setDescStatus] = useState<AssistStatus>("idle");
  const [descFailure, setDescFailure] = useState<CopilotFailureKind | null>(null);
  const [descSuggestion, setDescSuggestion] = useState<DescriptionSuggestion | null>(null);
  const [descKept, setDescKept] = useState<ReportField[]>([]);
  const descTicket = useRef(0);
  const descAbort = useRef<AbortController | null>(null);

  // AI help from the photo.
  const [photoConsent, setPhotoConsent] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [photoFailure, setPhotoFailure] = useState<CopilotFailureKind | null>(null);
  const [photoSuggestion, setPhotoSuggestion] = useState<PhotoSuggestion | null>(null);
  const [photoNotice, setPhotoNotice] = useState<{ kept: ReportField[]; noteTooLong: boolean } | null>(null);
  const photoTicket = useRef(0);
  const photoAbort = useRef<AbortController | null>(null);

  const voice = useVoiceInput({
    language,
    onTranscript: (text) => {
      setDraft((current) => ({ ...current, details: `${current.details.trim() ? `${current.details.trim()} ` : ""}${text}`.slice(0, MAINTENANCE_DETAILS_MAX) }));
      setProvenance((current) => touchField(current, "details"));
      setErrors({});
      setFailure(null);
    },
  });

  // Leaving the screen cancels anything still waiting on the AI.
  useEffect(
    () => () => {
      descAbort.current?.abort();
      photoAbort.current?.abort();
    },
    [],
  );

  const dirty = isMaintenanceDirty(draft, photoUri);
  const offlineWithPhoto = !isOnline && Boolean(photoUri);
  const aiAssisted = hasSuggestedFields(provenance);

  const currentDescSuggestion = descriptionSuggestionIsCurrent(descSuggestion, draft.details) ? descSuggestion : null;
  const descStale = descSuggestion !== null && currentDescSuggestion === null;
  const currentPhotoSuggestion = photoSuggestionIsCurrent(photoSuggestion, photoVersion, Boolean(photoUri)) ? photoSuggestion : null;

  function cancelAi() {
    descAbort.current?.abort();
    photoAbort.current?.abort();
    descTicket.current += 1;
    photoTicket.current += 1;
  }

  function reset() {
    cancelAi();
    discardLocalPhoto(photoUri);
    setDraft(EMPTY_MAINTENANCE_DRAFT);
    setProvenance(EMPTY_PROVENANCE);
    setPhotoUri(null);
    setPhotoVersion((value) => value + 1);
    setStep("form");
    setErrors({});
    setFailure(null);
    setCreatedId(null);
    setPhotoFailed(false);
    setDescStatus("idle");
    setDescFailure(null);
    setDescSuggestion(null);
    setDescKept([]);
    setPhotoConsent(false);
    setPhotoStatus("idle");
    setPhotoFailure(null);
    setPhotoSuggestion(null);
    setPhotoNotice(null);
    mayHaveBeenSent.current = false;
    requestId.current = newSessionId();
  }

  const requestClose = useDiscardGuard({ dirty, busy: submitting, onClose, onDiscard: reset });

  /** A change the person made themselves: that field is theirs from now on. */
  function edit(patch: Partial<MaintenanceDraft>, field: ReportField) {
    setDraft((current) => ({ ...current, ...patch }));
    setProvenance((current) => touchField(current, field));
    setErrors({});
    setFailure(null);
  }

  function changePhoto(uri: string | null) {
    // Anything about the previous photo, finished or still running, no longer applies.
    photoAbort.current?.abort();
    photoTicket.current += 1;
    setPhotoUri(uri);
    setPhotoVersion((value) => value + 1);
    setPhotoSuggestion(null);
    setPhotoConsent(false);
    setPhotoStatus("idle");
    setPhotoFailure(null);
    setPhotoNotice(null);
    setFailure(null);
  }

  function finish(message: string, tone: "success" | "info") {
    reset();
    toast[tone](message);
    onClose();
  }

  async function uploadPhotoTo(workOrderId: string) {
    if (!photoUri) return finish(t("reportIssue.submittedOnline"), "success");
    const result = await attachMaintenancePhoto(workOrderId, photoUri);
    if (result.ok) return finish(t("reportIssue.submittedOnline"), "success");
    setCreatedId(workOrderId);
    setPhotoFailed(true);
  }

  async function submit() {
    if (busyRef.current) return;
    // The work order already exists: the only thing left is the photo.
    if (createdId) {
      busyRef.current = true;
      setSubmitting(true);
      try {
        await uploadPhotoTo(createdId);
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
      return;
    }
    const found = validateMaintenance(draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setStep("form");
      return;
    }
    if (offlineWithPhoto) return;
    busyRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const outcome = await createMaintenanceWorkOrder(buildMaintenancePayload(roomId, draft, requestId.current), {
        isOnline,
        userId,
        mayHaveBeenSent: mayHaveBeenSent.current,
      });
      if (outcome.kind === "queued") return finish(t("reportIssue.savedOffline"), "info");
      if (outcome.kind === "failed") {
        mayHaveBeenSent.current = outcome.ambiguous;
        setFailure(t(outcome.ambiguous ? "reportIssue.failedUnsure" : "reportIssue.failed"));
        return;
      }
      mayHaveBeenSent.current = false;
      if (outcome.workOrderId) return await uploadPhotoTo(outcome.workOrderId);
      // Created, but the server gave no id to attach a photo to: say so rather than imply it was sent.
      finish(t(photoUri ? "reportIssue.submittedNoPhoto" : "reportIssue.submittedOnline"), photoUri ? "info" : "success");
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  /** The main button: straight to submit for an ordinary report, via the review when AI suggestions are in it. */
  function onPrimary() {
    if (createdId || step === "review") return void submit();
    if (aiAssisted) {
      const found = validateMaintenance(draft);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        return;
      }
      setStep("review");
      return;
    }
    void submit();
  }

  /* ── AI: from the description ───────────────────────────────────────── */

  async function suggestFromDescription() {
    const text = draft.details.trim();
    if (descStatus === "loading" || text.length < MIN_AI_CHARS || !isOnline) return;
    descAbort.current?.abort();
    const controller = new AbortController();
    descAbort.current = controller;
    const ticket = ++descTicket.current;
    setDescStatus("loading");
    setDescFailure(null);
    setDescKept([]);
    try {
      const result = await suggestReportFromDescription(text, roomId, controller.signal);
      if (ticket !== descTicket.current) return; // replaced or cancelled meanwhile
      setDescSuggestion(result);
      setDescStatus(result ? "idle" : "none");
    } catch (error) {
      if (ticket !== descTicket.current || isAbort(error)) return;
      setDescFailure(error instanceof CopilotFailure ? error.kind : "unknown");
      setDescStatus("failed");
    }
  }

  function useAllDescription() {
    if (!currentDescSuggestion) return;
    const result = applyDescriptionSuggestion(draft, provenance, currentDescSuggestion);
    setDraft(result.draft);
    setProvenance(result.provenance);
    setDescKept(result.kept);
    setErrors({});
  }

  function useDescriptionField(field: ReportField) {
    if (!currentDescSuggestion) return;
    const result = applyDescriptionField(draft, provenance, currentDescSuggestion, field);
    setDraft(result.draft);
    setProvenance(result.provenance);
    setDescKept((kept) => kept.filter((item) => item !== field));
    setErrors({});
  }

  /* ── AI: from the photo ─────────────────────────────────────────────── */

  async function analyzePhoto() {
    if (!photoUri || photoStatus === "loading" || !isOnline) return;
    photoAbort.current?.abort();
    const controller = new AbortController();
    photoAbort.current = controller;
    const ticket = ++photoTicket.current;
    const version = photoVersion;
    setPhotoConsent(false);
    setPhotoStatus("loading");
    setPhotoFailure(null);
    setPhotoNotice(null);
    try {
      const analysis = await analyzeIssuePhoto({ uri: photoUri, description: draft.details, roomId, signal: controller.signal });
      if (ticket !== photoTicket.current) return; // the photo changed or the form closed while it was away
      setPhotoSuggestion({ version, analysis, answer: null });
      setPhotoStatus("idle");
    } catch (error) {
      if (ticket !== photoTicket.current || isAbort(error)) return;
      setPhotoFailure(error instanceof CopilotFailure ? error.kind : "unknown");
      setPhotoStatus("failed");
    }
  }

  function answerPhotoQuestion(answer: YesNo) {
    setPhotoSuggestion((current) => (current ? { ...current, answer: current.answer === answer ? null : answer } : current));
  }

  function usePhotoDetails() {
    if (!currentPhotoSuggestion) return;
    const { analysis, answer } = currentPhotoSuggestion;
    const result = applyPhotoSuggestion(draft, provenance, currentPhotoSuggestion, {
      observation: t("reportIssue.photoAi.noteLine", { text: analysis.observation ?? "" }),
      answer: answer && analysis.question ? t("reportIssue.photoAi.answerLine", { question: analysis.question, answer: t(`reportIssue.photoAi.answer.${answer}`) }) : null,
    });
    setDraft(result.draft);
    setProvenance(result.provenance);
    setPhotoNotice({ kept: result.kept, noteTooLong: result.noteTooLong });
    setErrors({});
  }

  function discardPhotoSuggestion() {
    photoAbort.current?.abort();
    photoTicket.current += 1;
    setPhotoSuggestion(null);
    setPhotoConsent(false);
    setPhotoStatus("idle");
    setPhotoFailure(null);
    setPhotoNotice(null);
  }

  const locked = submitting || createdId !== null;
  const errorText = (field: keyof MaintenanceErrors) => (errors[field] ? t(`reportIssue.errors.${field}.${errors[field]}`) : null);
  const photoRetryOnly = createdId !== null;
  const reviewing = step === "review" && !photoRetryOnly;
  const voiceListening = voice.state === "listening";
  const voiceBusy = voice.state === "requesting" || voice.state === "processing";
  const voiceStatusKey = VOICE_STATUS[voice.state];
  const suggestedTag = (field: ReportField) =>
    provenance.suggested[field] ? (
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tag, { color: theme.textMuted }]} testID={`issue-suggested-${field}`}>
        {t(field === "details" ? "reportIssue.ai.photoNoteFieldTag" : "reportIssue.ai.suggestedFieldTag")}
      </Text>
    ) : null;

  const primaryLabel = photoRetryOnly
    ? t("reportIssue.retryPhoto")
    : reviewing
      ? t(isOnline ? "reportIssue.review.confirm" : "reportIssue.saveOffline")
      : aiAssisted
        ? t("reportIssue.review.reviewButton")
        : t(isOnline ? "reportIssue.submit" : "reportIssue.saveOffline");

  return (
    <BottomSheet
      visible={visible}
      title={reviewing ? t("reportIssue.review.title") : t("reportIssue.sheetTitle")}
      onClose={requestClose}
      testID="issue-sheet"
      footer={
        <>
          {offlineWithPhoto && !photoRetryOnly ? <StatusText tone="warn" message={t("reportIssue.photoNeedsConnection")} testID="issue-offline-photo" /> : null}
          {!isOnline && !photoUri ? <StatusText message={t("reportIssue.offlineQueued")} testID="issue-offline" /> : null}
          <Button
            label={primaryLabel}
            onPress={onPrimary}
            loading={submitting}
            disabled={submitting || (offlineWithPhoto && !photoRetryOnly) || (photoRetryOnly && !isOnline)}
            size="lg"
            testID="issue-submit"
          />
          {reviewing ? <Button label={t("reportIssue.review.edit")} onPress={() => setStep("form")} variant="secondary" disabled={submitting} testID="issue-edit" /> : null}
          {photoRetryOnly ? (
            <Button
              label={t("reportIssue.finishWithoutPhoto")}
              onPress={() => finish(t("reportIssue.submittedNoPhoto"), "info")}
              variant="secondary"
              disabled={submitting}
              testID="issue-skip-photo"
            />
          ) : null}
        </>
      }
    >
      <View style={styles.roomRow}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textSecondary }]}>
          {t("reportIssue.roomLabel", { room: roomNumber })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tag, { color: theme.status.ready }]} testID="issue-room-verified">
          {t("reportIssue.roomVerifiedTag")}
        </Text>
      </View>

      {photoRetryOnly ? (
        <StatusText tone="warn" message={t(photoFailed ? "reportIssue.photoFailed" : "reportIssue.createdWithoutPhoto")} testID="issue-photo-failed" />
      ) : null}

      {reviewing ? (
        <>
          <ConfirmRows
            palette={theme}
            prepared={aiAssisted ? t("reportIssue.review.prepared") : null}
            rows={reportSummaryRows({ roomNumber, draft, provenance, photo: photoUri ? "pending" : "none" }, t)}
          />
          {!isOnline ? <StatusText message={t("reportIssue.review.offlineNote")} testID="issue-review-offline" /> : null}
          {failure ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.failure, { color: theme.status.dirty }]} testID="issue-failure">
              {failure}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <FieldLabel>{t("reportIssue.whatHappened")}</FieldLabel>
          <TextArea
            label={t("reportIssue.whatHappened")}
            value={draft.details}
            onChangeText={(details) => edit({ details }, "details")}
            max={MAINTENANCE_DETAILS_MAX}
            placeholder={t("reportIssue.detailsPlaceholder")}
            editable={!locked}
            invalid={Boolean(errors.details)}
            testID="issue-details"
          />
          {suggestedTag("details")}
          <FieldError message={errorText("details")} testID="issue-error-details" />

          {voice.supported && !photoRetryOnly ? (
            <View style={styles.voiceBlock}>
              <Pressable
                onPress={voice.toggle}
                disabled={locked || voiceBusy}
                accessibilityRole="button"
                accessibilityLabel={t(voiceListening ? "reportIssue.voice.stop" : "reportIssue.voice.start")}
                accessibilityState={{ busy: voiceBusy, selected: voiceListening, disabled: locked || voiceBusy }}
                style={[
                  styles.voiceButton,
                  { backgroundColor: voiceListening ? theme.status.dirty : theme.surfaceSubtle, borderColor: voiceListening ? theme.status.dirty : theme.border },
                ]}
                testID="issue-voice"
              >
                <Ionicons name={voiceListening ? "stop" : "mic-outline"} size={20} color={voiceListening ? theme.onPrimary : theme.textPrimary} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.voiceText, { color: voiceListening ? theme.onPrimary : theme.textPrimary }]}>
                  {t(voiceListening ? "reportIssue.voice.stop" : "reportIssue.voice.start")}
                </Text>
              </Pressable>
              {voiceStatusKey ? (
                voice.state === "denied" || voice.state === "nospeech" || voice.state === "error" ? (
                  <FieldError message={t(voiceStatusKey)} testID="issue-voice-status" />
                ) : (
                  <StatusText message={voice.interim ? `${t(voiceStatusKey)} ${voice.interim}` : t(voiceStatusKey)} testID="issue-voice-status" />
                )
              ) : null}
              {voiceListening ? <StatusText message={t("reportIssue.voice.privacy")} /> : null}
            </View>
          ) : null}

          <FieldLabel>{t("reportIssue.photo")}</FieldLabel>
          {photoRetryOnly && photoUri ? (
            <PhotoAttachment uri={photoUri} onChange={changePhoto} disabled status={photoFailed ? "failed" : "pending"} testIDPrefix="issue-photo" />
          ) : (
            <PhotoAttachment uri={photoUri} onChange={changePhoto} disabled={locked || !isOnline} status="pending" testIDPrefix="issue-photo" />
          )}

          {!photoRetryOnly ? (
            <DescriptionAssist
              online={isOnline}
              locked={locked}
              canAsk={draft.details.trim().length >= MIN_AI_CHARS}
              status={descStatus}
              failure={descFailure}
              suggestion={currentDescSuggestion}
              stale={descStale}
              draft={draft}
              kept={descKept}
              onSuggest={() => void suggestFromDescription()}
              onUseAll={useAllDescription}
              onUseField={useDescriptionField}
              onDismiss={() => {
                setDescSuggestion(null);
                setDescKept([]);
                setDescStatus("idle");
              }}
            />
          ) : null}

          {!photoRetryOnly && photoUri ? (
            <PhotoAssist
              online={isOnline}
              locked={locked}
              consenting={photoConsent}
              status={photoStatus}
              failure={photoFailure}
              suggestion={currentPhotoSuggestion}
              draft={draft}
              notice={photoNotice}
              onAsk={() => setPhotoConsent(true)}
              onCancel={discardPhotoSuggestion}
              onSend={() => void analyzePhoto()}
              onAnswer={answerPhotoQuestion}
              onUse={usePhotoDetails}
              onDiscard={discardPhotoSuggestion}
            />
          ) : null}

          <FieldLabel required>{t("reportIssue.issueTitle")}</FieldLabel>
          <TextInput
            testID="title-input"
            value={draft.title}
            onChangeText={(title) => edit({ title }, "title")}
            placeholder={t("reportIssue.titlePlaceholder")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("reportIssue.issueTitle")}
            maxLength={MAINTENANCE_TITLE_MAX}
            editable={!locked}
            returnKeyType="next"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[
              styles.input,
              { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: errors.title ? theme.status.dirty : theme.border },
            ]}
          />
          {suggestedTag("title")}
          <FieldError message={errorText("title")} testID="issue-error-title" />

          <FieldLabel required>{t("reportIssue.category")}</FieldLabel>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {MAINTENANCE_CATEGORIES.map((value) => (
              <Chip
                key={value}
                label={t(`reportIssue.categories.${value}`)}
                selected={draft.category === value}
                onPress={() => edit({ category: value }, "category")}
                disabled={locked}
                testID={`category-option-${value}`}
              />
            ))}
          </View>
          {suggestedTag("category")}
          <FieldError message={errorText("category")} testID="issue-error-category" />

          <FieldLabel>{t("reportIssue.priority")}</FieldLabel>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {MAINTENANCE_PRIORITIES.map((value) => (
              <Chip
                key={value}
                label={t(`reportIssue.priorities.${value}`)}
                selected={draft.priority === value}
                onPress={() => edit({ priority: value }, "priority")}
                disabled={locked}
                tone={value === "urgent" ? { bg: theme.status.dirty, fg: theme.onDestructive } : undefined}
                testID={`priority-${value}`}
              />
            ))}
          </View>
          {suggestedTag("priority")}

          {failure ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.failure, { color: theme.status.dirty }]} testID="issue-failure">
              {failure}
            </Text>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  roomRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  room: { fontSize: 14, fontWeight: "700" },
  tag: { fontSize: 12, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  failure: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  voiceBlock: { gap: 6 },
  voiceButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  voiceText: { fontSize: 14.5, fontWeight: "700" },
});
