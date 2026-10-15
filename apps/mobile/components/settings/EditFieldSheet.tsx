import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

interface EditFieldSheetProps {
  visible: boolean;
  title: string;
  label: string;
  /** The stored value; the input starts here every time the sheet opens. */
  value: string;
  maxLength: number;
  helper?: string;
  /** Returns an error message for a draft, or null when it can be saved. */
  validate: (draft: string) => string | null;
  /** Normalises a draft (trim etc.) before comparing and saving. */
  normalize: (draft: string) => string;
  /** Resolves on server confirmation; rejects with a staff-safe message string-able Error otherwise. */
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
  testID?: string;
}

/** Reusable one-field edit sheet. Keeps the draft on failure, blocks double submits, skips no-op saves. */
export function EditFieldSheet({
  visible,
  title,
  label,
  value,
  maxLength,
  helper,
  validate,
  normalize,
  onSave,
  onClose,
  testID = "edit-field",
}: EditFieldSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (visible) {
      setDraft(value);
      setError(null);
      setSaving(false);
      inFlight.current = false;
    }
    // Re-seed only when the sheet opens, never while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const clean = normalize(draft);
  const validationError = validate(draft);
  const unchanged = clean === normalize(value);
  const shownError = error ?? (draft !== value ? validationError : null);

  async function save() {
    if (inFlight.current) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    if (unchanged) {
      onClose();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(clean);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.personal.saveFailed"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={saving ? () => undefined : onClose}
      testID={testID}
      scrollKey={shownError}
      footer={
        <View style={styles.actions}>
          <Button
            label={t("settings.personal.saveChanges")}
            onPress={() => void save()}
            loading={saving}
            disabled={!!validationError || unchanged}
            testID={`${testID}-save`}
          />
          <Button
            label={t("common.cancel")}
            variant="secondary"
            onPress={onClose}
            disabled={saving}
            testID={`${testID}-cancel`}
          />
        </View>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
        {label}
      </Text>
      <TextInput
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        editable={!saving}
        maxLength={maxLength + 20}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        accessibilityLabel={label}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        placeholderTextColor={theme.textDisabled}
        style={[
          styles.input,
          { color: theme.textPrimary, backgroundColor: theme.surfaceMuted, borderColor: shownError ? theme.status.dirty : theme.border },
        ]}
        testID={`${testID}-input`}
      />
      <View style={styles.meta}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.helper, { color: theme.textMuted }]}>
          {helper ?? ""}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]}>
          {clean.length}/{maxLength}
        </Text>
      </View>
      {shownError ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="alert"
          style={[styles.error, { color: theme.status.dirty }]}
          testID={`${testID}-error`}
        >
          {shownError}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  meta: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  helper: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  count: { fontSize: 12.5 },
  error: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  actions: { gap: 8 },
});
