import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
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
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { BottomSheet, MAX_FONT_SCALE } from "./roomDetail/BottomSheet";
import { Chip, FieldError, FieldLabel, StatusText, TextArea } from "./roomDetail/FormBits";
import { PhotoAttachment } from "./roomDetail/PhotoAttachment";

interface ReportIssueModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

/**
 * Report maintenance / damage. Creates a normal work order (offline it goes to the
 * existing work-order queue and is labelled "saved", not "submitted"). A photo
 * needs a connection; if the work order is created but the photo fails, the sheet
 * stays on that work order and retries only the photo — never a second work order.
 */
export default function ReportIssueModal({ visible, roomId, roomNumber, onClose }: ReportIssueModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isOnline = useAppStore((state) => state.isOnline);
  const userId = useAppStore((state) => state.user?.id);

  const [draft, setDraft] = useState<MaintenanceDraft>(EMPTY_MAINTENANCE_DRAFT);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
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

  const dirty = isMaintenanceDirty(draft, photoUri);
  const offlineWithPhoto = !isOnline && Boolean(photoUri);

  function reset() {
    setDraft(EMPTY_MAINTENANCE_DRAFT);
    setPhotoUri(null);
    setErrors({});
    setFailure(null);
    setCreatedId(null);
    setPhotoFailed(false);
    mayHaveBeenSent.current = false;
    requestId.current = newSessionId();
  }

  const requestClose = useDiscardGuard({ dirty, busy: submitting, onClose, onDiscard: reset });

  function update(patch: Partial<MaintenanceDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
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

  const locked = submitting || createdId !== null;
  const errorText = (field: keyof MaintenanceErrors) => (errors[field] ? t(`reportIssue.errors.${field}.${errors[field]}`) : null);
  const photoRetryOnly = createdId !== null;

  return (
    <BottomSheet
      visible={visible}
      title={t("reportIssue.sheetTitle")}
      onClose={requestClose}
      testID="issue-sheet"
      footer={
        <>
          {offlineWithPhoto && !photoRetryOnly ? <StatusText tone="warn" message={t("reportIssue.photoNeedsConnection")} testID="issue-offline-photo" /> : null}
          {!isOnline && !photoUri ? <StatusText message={t("reportIssue.offlineQueued")} testID="issue-offline" /> : null}
          <Button
            label={photoRetryOnly ? t("reportIssue.retryPhoto") : t(isOnline ? "reportIssue.submit" : "reportIssue.saveOffline")}
            onPress={() => void submit()}
            loading={submitting}
            disabled={submitting || (offlineWithPhoto && !photoRetryOnly) || (photoRetryOnly && !isOnline)}
            size="lg"
            testID="issue-submit"
          />
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
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textSecondary }]}>
        {t("reportIssue.roomLabel", { room: roomNumber })}
      </Text>

      {photoRetryOnly ? (
        <StatusText tone="warn" message={t(photoFailed ? "reportIssue.photoFailed" : "reportIssue.createdWithoutPhoto")} testID="issue-photo-failed" />
      ) : null}

      <FieldLabel required>{t("reportIssue.issueTitle")}</FieldLabel>
      <TextInput
        testID="title-input"
        value={draft.title}
        onChangeText={(title) => update({ title })}
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
      <FieldError message={errorText("title")} testID="issue-error-title" />

      <FieldLabel required>{t("reportIssue.category")}</FieldLabel>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {MAINTENANCE_CATEGORIES.map((value) => (
          <Chip
            key={value}
            label={t(`reportIssue.categories.${value}`)}
            selected={draft.category === value}
            onPress={() => update({ category: value })}
            disabled={locked}
            testID={`category-option-${value}`}
          />
        ))}
      </View>
      <FieldError message={errorText("category")} testID="issue-error-category" />

      <FieldLabel>{t("reportIssue.priority")}</FieldLabel>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {MAINTENANCE_PRIORITIES.map((value) => (
          <Chip
            key={value}
            label={t(`reportIssue.priorities.${value}`)}
            selected={draft.priority === value}
            onPress={() => update({ priority: value })}
            disabled={locked}
            tone={value === "urgent" ? { bg: theme.status.dirty, fg: theme.onDestructive } : undefined}
            testID={`priority-${value}`}
          />
        ))}
      </View>

      <FieldLabel>{t("reportIssue.details")}</FieldLabel>
      <TextArea
        label={t("reportIssue.details")}
        value={draft.details}
        onChangeText={(details) => update({ details })}
        max={MAINTENANCE_DETAILS_MAX}
        placeholder={t("reportIssue.detailsPlaceholder")}
        editable={!locked}
        invalid={Boolean(errors.details)}
        testID="issue-details"
      />

      <FieldLabel>{t("reportIssue.photo")}</FieldLabel>
      {photoRetryOnly && photoUri ? (
        <PhotoAttachment uri={photoUri} onChange={setPhotoUri} disabled testIDPrefix="issue-photo" />
      ) : (
        <PhotoAttachment uri={photoUri} onChange={setPhotoUri} disabled={locked || !isOnline} testIDPrefix="issue-photo" />
      )}

      {failure ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.failure, { color: theme.status.dirty }]} testID="issue-failure">
          {failure}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  room: { fontSize: 14, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  failure: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
});
