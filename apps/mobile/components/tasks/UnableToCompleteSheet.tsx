import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { RadioOption } from "@/components/housekeeping/roomDetail/FormBits";
import { useTheme } from "@/lib/theme/useTheme";
import { BLOCKER_REASONS, type BlockerReason, type Task } from "@/lib/api/tasks";
import { BLOCKER_DETAILS_MAX, validateBlockerDraft } from "@/lib/tasks/blockers";
import { shortPlace } from "@/lib/tasks/taskDisplay";

interface Props {
  visible: boolean;
  task: Task | null;
  reason: BlockerReason | null;
  details: string;
  onReasonChange: (reason: BlockerReason) => void;
  onDetailsChange: (value: string) => void;
  /** The request is in flight; the sheet can not be dismissed meanwhile. */
  busy: boolean;
  offline: boolean;
  /** Plain-language reason the last attempt failed; the form is kept so it can be retried. */
  error: string | null;
  onSubmit: () => void;
  /** Close and keep what was typed (X, backdrop, back). */
  onClose: () => void;
  /** Discard the draft and go back. */
  onCancel: () => void;
}

/**
 * "Unable to complete?" — pick one reason, optionally explain, send. Nothing here changes the task:
 * only "Send update" makes a request, and "saved" is shown only after the server confirms it.
 * "Other" must be explained; the common reasons never force typing.
 */
export function UnableToCompleteSheet({
  visible,
  task,
  reason,
  details,
  onReasonChange,
  onDetailsChange,
  busy,
  offline,
  error,
  onSubmit,
  onClose,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!task) return null;

  const place = shortPlace(task, t);
  const identity = place ? `${place} — ${task.title}` : task.title;
  const problem = validateBlockerDraft(reason, details);
  const isOther = reason === "other";
  const tooLong = problem === "detailsTooLong";
  const needsDetails = problem === "detailsRequired";
  const blocked = busy || offline || problem !== null;

  return (
    <BottomSheet
      visible={visible}
      title={t("tasks.hk.blocker.title")}
      onClose={busy ? () => undefined : onClose}
      grabber
      scrollKey={error ? `error:${error}` : isOther ? "other" : null}
      testID="blocker-sheet"
      footer={
        <>
          <Button
            label={t("tasks.hk.blocker.send")}
            onPress={onSubmit}
            loading={busy}
            disabled={blocked}
            size="lg"
            icon="send"
            testID="blocker-send"
          />
          <Button label={t("tasks.hk.blocker.cancel")} onPress={onCancel} variant="secondary" disabled={busy} testID="blocker-cancel" />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.identity, { color: theme.textPrimary }]} testID="blocker-identity">
        {identity}
      </Text>

      <View style={styles.group}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.prompt, { color: theme.textSecondary }]}>
          {t("tasks.hk.blocker.prompt")}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("tasks.hk.blocker.reasonsA11y")} style={styles.options}>
          {BLOCKER_REASONS.map((value) => (
            <RadioOption
              key={value}
              label={t(`tasks.hk.blocker.reason.${value}`)}
              selected={reason === value}
              onPress={() => onReasonChange(value)}
              disabled={busy}
              testID={`blocker-reason-${value}`}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
          {t(isOther ? "tasks.hk.blocker.detailsLabelOther" : "tasks.hk.blocker.detailsLabel")}
        </Text>
        <TextInput
          value={details}
          onChangeText={onDetailsChange}
          editable={!busy}
          multiline
          placeholder={t("tasks.hk.blocker.placeholder")}
          placeholderTextColor={theme.textDisabled}
          accessibilityLabel={t("tasks.hk.blocker.detailsA11y")}
          style={[
            styles.input,
            {
              color: theme.textPrimary,
              backgroundColor: theme.surfaceSubtle,
              borderColor: tooLong ? theme.status.dirty : needsDetails ? theme.status.pickupLine : theme.borderSubtle,
            },
          ]}
          testID="blocker-details"
        />
        {tooLong ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert">
            {t("tasks.hk.blocker.validation.detailsTooLong", { max: BLOCKER_DETAILS_MAX })}
          </Text>
        ) : needsDetails ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.pickup }]} testID="blocker-details-required">
            {t("tasks.hk.blocker.validation.detailsRequired")}
          </Text>
        ) : details.length > BLOCKER_DETAILS_MAX * 0.8 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("tasks.hk.blocker.count", { count: details.length, max: BLOCKER_DETAILS_MAX })}
          </Text>
        ) : null}
      </View>

      {offline ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityRole="alert" testID="blocker-offline">
          {t("tasks.hk.blocker.offline")}
        </Text>
      ) : null}
      {busy ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.textMuted }]}>
          {t("tasks.hk.blocker.sending")}
        </Text>
      ) : null}
      {error ? (
        <View style={[styles.error, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert" testID="blocker-error">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.errorText, { color: theme.status.dirty }]}>
            {error}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  identity: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  group: { gap: 8 },
  prompt: { fontSize: 14.5, fontWeight: "700" },
  options: { gap: 8 },
  label: { fontSize: 12.5, fontWeight: "700" },
  input: { minHeight: 96, maxHeight: 180, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlignVertical: "top" },
  hint: { fontSize: 12.5, fontWeight: "600" },
  error: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  errorText: { fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
});
