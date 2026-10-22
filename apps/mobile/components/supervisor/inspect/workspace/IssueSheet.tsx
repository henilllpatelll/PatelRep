import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import { openCameraSettings, type CaptureFailure, type CaptureResult, type CaptureSource } from "@/lib/inspections/evidence";
import { hasIssueErrors, isIssueFormDirty, issueFormOf, photoStatus, validateIssue, type IssueErrors, type IssueForm } from "@/lib/inspections/issue";
import type { ChecklistItem, ItemAnswer, Severity } from "@/lib/inspections/types";
import type { Translate } from "@/lib/inspections/viewText";
import { NOTE_MAX_LENGTH } from "@/lib/inspections/workspace";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Report or edit one issue — a bottom drawer ────────────────────────────
   Opens when an item is marked Issue (or from "Edit issue"). It edits a COPY of the issue: nothing reaches the draft
   until "Save issue", and closing with unsaved changes asks first. A photo taken here is a file on the phone from the
   moment it is taken, so it is deleted again if the changes are discarded. One photo per issue: that is all the server
   can keep for a result. */

export interface IssueSheetProps {
  item: ChecklistItem | null;
  room: string;
  answer: ItemAnswer | undefined;
  /** The photo the draft holds for this item, if any. */
  photoUri: string | null;
  /** …but its file is no longer on the phone. */
  photoLost: boolean;
  /** The full-size viewer is open on top; the drawer steps aside (its state is kept). */
  hidden: boolean;
  t: Translate;
  onSave: (itemId: string, form: IssueForm) => { ok: true } | { ok: false; reason: string; errors: IssueErrors };
  onCapture: (source: CaptureSource, itemId: string) => Promise<CaptureResult>;
  onDiscardCapture: (uri: string) => Promise<void>;
  onUnreadable: (itemId: string) => void;
  onView: (uri: string) => void;
  onClose: () => void;
}

export function IssueSheet(props: IssueSheetProps) {
  return props.item ? <IssueDrawer key={props.item.id} {...props} item={props.item} /> : null;
}

function IssueDrawer({ item, room, answer, photoUri, photoLost, hidden, t, onSave, onCapture, onDiscardCapture, onUnreadable, onView, onClose }: IssueSheetProps & { item: ChecklistItem }) {
  const theme = useTheme();
  const initial = useRef(issueFormOf(answer, photoUri, photoLost));
  const [note, setNote] = useState(initial.current.note);
  const [severity, setSeverity] = useState<Severity | null>(initial.current.severity);
  const [photo, setPhoto] = useState<string | null>(initial.current.photoUri);
  const [errors, setErrors] = useState<IssueErrors>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [working, setWorking] = useState(false);
  const [captureError, setCaptureError] = useState<CaptureFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(true);
  const picking = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const form: IssueForm = { note, severity, photoUri: photo };
  const dirty = isIssueFormDirty(initial.current, form);
  /** A photo taken in this drawer that the draft has not adopted. */
  const staged = photo !== null && photo !== initial.current.photoUri ? photo : null;
  const status = photoStatus(item, photo !== null);

  const cancel = () => {
    if (staged) void onDiscardCapture(staged);
    onClose();
  };
  const requestClose = () => {
    if (dirty) setConfirming(true);
    else cancel();
  };

  const save = () => {
    const found = validateIssue(form);
    setErrors(found);
    setSaveFailed(false);
    if (hasIssueErrors(found)) return;
    const result = onSave(item.id, form);
    if (result.ok) onClose();
    else {
      setErrors(result.errors);
      setSaveFailed(!hasIssueErrors(result.errors));
    }
  };

  const pick = async (source: CaptureSource) => {
    if (picking.current) return;
    picking.current = true;
    setMenu(false);
    setCaptureError(null);
    setWorking(true);
    try {
      const result = await onCapture(source, item.id);
      if (!mounted.current) {
        // The drawer went away while the camera was open: nothing will adopt this file.
        if (result.ok) void onDiscardCapture(result.photo.uri);
        return;
      }
      if (result.ok) {
        // Replacing a photo taken here: the earlier one is not wanted any more.
        if (staged) void onDiscardCapture(staged);
        setPhoto(result.photo.uri);
      } else if (result.reason !== "cancelled") {
        setCaptureError(result.reason);
      }
    } finally {
      picking.current = false;
      if (mounted.current) setWorking(false);
    }
  };

  const removePhoto = () => {
    if (staged) void onDiscardCapture(staged);
    setPhoto(null);
    setMenu(false);
    setCaptureError(null);
  };

  const showLost = photoLost && photo === null;
  const label = item.description;

  return (
    <WorkspaceSheet
      visible={!hidden}
      title={t(answer?.severity ? "inspect.workspace.issue.titleEdit" : "inspect.workspace.issue.title")}
      onClose={requestClose}
      testID="workspace-issue-sheet"
      t={t}
      footer={
        confirming ? (
          <View style={styles.confirm} testID="workspace-issue-unsaved">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.confirmTitle, { color: theme.textPrimary }]}>
              {t("inspect.workspace.issue.unsavedTitle")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
              {t("inspect.workspace.issue.unsavedBody")}
            </Text>
            <Button label={t("inspect.workspace.issue.keepEditing")} size="lg" onPress={() => setConfirming(false)} testID="workspace-issue-keep-editing" />
            <Button label={t("inspect.workspace.issue.discardChanges")} variant="destructive" size="lg" onPress={cancel} testID="workspace-issue-discard-changes" />
          </View>
        ) : (
          <Button label={t("inspect.workspace.issue.save")} size="lg" icon="checkmark" onPress={save} testID="workspace-issue-save" />
        )
      }
    >
      <View style={styles.block}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]} testID="workspace-issue-context">
          {t("inspect.workspace.issue.context", { room, section: item.section })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemTitle, { color: theme.textPrimary }]} testID="workspace-issue-item">
          {label}
        </Text>
      </View>

      <View style={styles.block}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textSecondary }]}>
          {t("inspect.workspace.issue.noteLabel")}
        </Text>
        <TextInput
          value={note}
          onChangeText={(next) => {
            setNote(next.slice(0, NOTE_MAX_LENGTH));
            if (errors.note) setErrors({ ...errors, note: undefined });
          }}
          placeholder={t("inspect.workspace.issue.notePlaceholder")}
          placeholderTextColor={theme.textMuted}
          maxLength={NOTE_MAX_LENGTH}
          multiline
          accessibilityLabel={t("inspect.workspace.issue.noteA11y", { item: label })}
          style={[styles.input, { color: theme.textPrimary, borderColor: errors.note ? theme.status.dirty : theme.border, backgroundColor: theme.surface }]}
          testID="workspace-issue-note"
        />
        {note.length >= NOTE_MAX_LENGTH - 100 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="workspace-issue-note-count">
            {t("inspect.workspace.issue.noteCount", { count: note.length, max: NOTE_MAX_LENGTH })}
          </Text>
        ) : null}
        {errors.note ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.error, { color: theme.status.dirty }]}>
            {t("inspect.workspace.issue.noteTooLong", { max: NOTE_MAX_LENGTH })}
          </Text>
        ) : null}
      </View>

      <View style={styles.block}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textSecondary }]}>
          {t("inspect.workspace.issue.severityLabel")}
        </Text>
        <View style={styles.severities} accessibilityRole="radiogroup" accessibilityLabel={t("inspect.workspace.issue.severityLabel")}>
          {(["minor", "major"] as const).map((value) => {
            const selected = severity === value;
            const name = t(`inspect.workspace.issue.severity.${value}`);
            const hint = t(`inspect.workspace.issue.severity.${value}Hint`);
            return (
              <Pressable
                key={value}
                onPress={() => {
                  setSeverity(value);
                  if (errors.severity) setErrors({ ...errors, severity: undefined });
                }}
                accessibilityRole="radio"
                accessibilityLabel={t("inspect.workspace.issue.severity.a11y", { severity: name, hint })}
                accessibilityState={{ checked: selected, selected }}
                style={({ pressed }) => [
                  styles.severity,
                  {
                    backgroundColor: selected ? (value === "major" ? theme.status.dirtySoft : theme.status.pickupSoft) : theme.surface,
                    borderColor: selected ? (value === "major" ? theme.status.dirtyLine : theme.status.pickupLine) : errors.severity ? theme.status.dirty : theme.border,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                testID={`workspace-issue-severity-${value}`}
              >
                <View style={styles.severityTop}>
                  <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={18} color={selected ? theme.textPrimary : theme.textMuted} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.severityName, { color: theme.textPrimary }]}>
                    {name}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.severityHint, { color: theme.textSecondary }]}>
                  {hint}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.severity ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.error, { color: theme.status.dirty }]} testID="workspace-issue-severity-error">
            {t("inspect.workspace.issue.severityRequired")}
          </Text>
        ) : null}
      </View>

      <View style={styles.block}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textSecondary }]}>
          {t("inspect.workspace.issue.photoLabel")}
        </Text>

        {photo ? (
          <View style={styles.photoRow}>
            <Pressable
              onPress={() => onView(photo)}
              accessibilityRole="imagebutton"
              accessibilityLabel={t("inspect.workspace.photo.thumbA11y", { item: label })}
              style={[styles.thumbWrap, { borderColor: theme.border }]}
              testID="workspace-issue-photo"
            >
              <Image
                source={{ uri: photo }}
                style={styles.thumb}
                resizeMode="cover"
                onError={() => {
                  if (photo === initial.current.photoUri) {
                    // The draft's own photo cannot be opened: it is gone. It no longer counts as evidence.
                    initial.current = { ...initial.current, photoUri: null };
                    onUnreadable(item.id);
                  } else {
                    void onDiscardCapture(photo);
                    setCaptureError("save_failed");
                  }
                  setPhoto(null);
                }}
              />
            </Pressable>
            <View style={styles.photoActions}>
              <Button label={t("inspect.workspace.photo.replace")} variant="secondary" size="md" icon="camera-outline" onPress={() => setMenu(true)} accessibilityLabel={t("inspect.workspace.photo.replaceA11y", { item: label })} testID="workspace-issue-photo-replace" />
              <Button label={t("inspect.workspace.photo.remove")} variant="ghost" size="md" icon="trash-outline" onPress={removePhoto} accessibilityLabel={t("inspect.workspace.photo.removeA11y", { item: label })} testID="workspace-issue-photo-remove" />
            </View>
          </View>
        ) : (
          <Button label={t("inspect.workspace.photo.add")} variant="secondary" size="md" icon="camera-outline" onPress={() => setMenu(true)} accessibilityLabel={t("inspect.workspace.photo.addA11y", { item: label })} testID="workspace-issue-photo-add" />
        )}

        {showLost ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="workspace-issue-photo-lost">
            {t("inspect.workspace.photo.lost")}
          </Text>
        ) : null}

        {working ? (
          <View style={styles.working} accessibilityLiveRegion="polite" testID="workspace-issue-photo-working">
            <ActivityIndicator color={theme.primaryAction} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
              {t("inspect.workspace.photo.working")}
            </Text>
          </View>
        ) : null}

        {menu && !working ? (
          <View style={[styles.menu, { borderColor: theme.border, backgroundColor: theme.surface }]} testID="workspace-issue-photo-menu">
            <Button label={t("inspect.workspace.photo.take")} size="md" icon="camera" onPress={() => void pick("camera")} testID="workspace-issue-photo-camera" />
            <Button label={t("inspect.workspace.photo.library")} variant="secondary" size="md" icon="images-outline" onPress={() => void pick("library")} testID="workspace-issue-photo-library" />
            <Button label={t("inspect.workspace.photo.cancel")} variant="ghost" size="md" onPress={() => setMenu(false)} testID="workspace-issue-photo-menu-cancel" />
          </View>
        ) : null}

        {captureError ? (
          <View style={styles.captureError} testID="workspace-issue-photo-error">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]}>
              {t(`inspect.workspace.photo.error.${captureError}`)}
            </Text>
            <View style={styles.errorActions}>
              {captureError === "permission_blocked" ? (
                <Button label={t("inspect.workspace.photo.openSettings")} variant="secondary" size="md" onPress={() => void openCameraSettings()} testID="workspace-issue-photo-settings" />
              ) : null}
              {captureError !== "unsupported" && captureError !== "too_large" ? (
                <Button
                  label={t("inspect.workspace.photo.retry")}
                  variant="secondary"
                  size="md"
                  onPress={() => {
                    setCaptureError(null);
                    setMenu(true);
                  }}
                  testID="workspace-issue-photo-retry"
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.hint, { color: status === "required_missing" ? theme.status.pickup : theme.textSecondary, fontWeight: status === "required_missing" ? "800" : "600" }]}
          testID="workspace-issue-photo-status"
        >
          {item.requiresPhotoOnFail ? t("inspect.workspace.issue.photoRequired") : t("inspect.workspace.issue.photoOptional")}
        </Text>
        {status === "required_missing" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
            {t("inspect.workspace.issue.photoRequiredLater")}
          </Text>
        ) : null}
      </View>

      <View style={[styles.correction, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]} testID="workspace-issue-correction">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textSecondary }]}>
          {t("inspect.workspace.issue.correctionLabel")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.correctionValue, { color: theme.textPrimary }]}>
          {t("inspect.workspace.issue.correctionValue")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("inspect.workspace.issue.correctionHint")}
        </Text>
      </View>

      {saveFailed ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="workspace-issue-save-failed">
          {t("inspect.workspace.issue.saveFailed")}
        </Text>
      ) : null}
    </WorkspaceSheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  itemTitle: { fontSize: 18, lineHeight: 25, fontWeight: "800" },
  label: { fontSize: 13, fontWeight: "800" },
  input: { minHeight: 92, maxHeight: 160, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: "top" },
  hint: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  error: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  severities: { flexDirection: "row", gap: 8 },
  severity: { flex: 1, minWidth: 0, minHeight: 72, borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 10, paddingVertical: 10, gap: 4 },
  severityTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  severityName: { fontSize: 16, fontWeight: "800" },
  severityHint: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumbWrap: { width: 96, height: 96, borderRadius: R.md, borderWidth: 1, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  photoActions: { flex: 1, minWidth: 0, gap: 4, alignItems: "flex-start" },
  menu: { borderWidth: 1, borderRadius: R.md, padding: 10, gap: 8 },
  working: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TARGET },
  captureError: { gap: 6 },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  correction: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 4 },
  correctionValue: { fontSize: 15, fontWeight: "800" },
  confirm: { gap: 8 },
  confirmTitle: { fontSize: 17, lineHeight: 23, fontWeight: "800" },
});
