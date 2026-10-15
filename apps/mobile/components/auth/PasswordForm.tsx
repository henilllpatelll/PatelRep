import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { Button } from "@/components/ui/Button";
import { MIN_PASSWORD_LENGTH, type AuthFailure } from "@/lib/auth/authErrors";
import { useTheme } from "@/lib/theme/useTheme";

type LocalError = "currentRequired" | "tooShort" | "mismatch" | "same";

interface PasswordFormProps {
  /** Ask for the current password first (change from Settings). Recovery sessions skip it. */
  requireCurrent: boolean;
  submitLabel: string;
  /** Resolves null on provider-confirmed success, or the failure category. Never rejects. */
  onSubmit: (values: { current: string; next: string }) => Promise<AuthFailure | null>;
  testID?: string;
}

/**
 * New-password form shared by Settings and the recovery flow. Pasting and password managers are
 * allowed (autoComplete/textContentType), there are no composition rules or maximum length, and the
 * values never leave component state or reach a log.
 */
export function PasswordForm({ requireCurrent, submitLabel, onSubmit, testID = "password-form" }: PasswordFormProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<LocalError | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    setFailure(null);
    if (requireCurrent && !current) return setLocalError("currentRequired");
    if (next.length < MIN_PASSWORD_LENGTH) return setLocalError("tooShort");
    if (next !== confirm) return setLocalError("mismatch");
    if (requireCurrent && next === current) return setLocalError("same");
    setLocalError(null);

    inFlight.current = true;
    setSaving(true);
    try {
      const result = await onSubmit({ current, next });
      if (result) setFailure(result);
      else {
        setCurrent("");
        setNext("");
        setConfirm("");
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const message = localError ? t(`auth.passwordForm.errors.${localError}`, { min: MIN_PASSWORD_LENGTH }) : failure ? t(`auth.passwordForm.errors.${failure}`) : null;

  return (
    <View style={styles.form} testID={testID}>
      {requireCurrent ? (
        <AuthTextField
          icon="lock-closed-outline"
          placeholder={t("auth.passwordForm.current")}
          value={current}
          onChangeText={(v) => {
            setCurrent(v);
            setLocalError(null);
          }}
          revealable
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          editable={!saving}
          invalid={localError === "currentRequired" || failure === "invalidCredentials"}
          testID="current-password-input"
        />
      ) : null}
      <AuthTextField
        icon="key-outline"
        placeholder={t("auth.passwordForm.new")}
        value={next}
        onChangeText={(v) => {
          setNext(v);
          setLocalError(null);
        }}
        revealable
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        passwordRules="minlength: 8;"
        editable={!saving}
        invalid={localError === "tooShort" || localError === "same"}
        testID="new-password-input"
      />
      <AuthTextField
        icon="checkmark-circle-outline"
        placeholder={t("auth.passwordForm.confirm")}
        value={confirm}
        onChangeText={(v) => {
          setConfirm(v);
          setLocalError(null);
        }}
        revealable
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        editable={!saving}
        invalid={localError === "mismatch"}
        testID="confirm-password-input"
      />
      <Text style={[styles.hint, { color: theme.textMuted }]} testID="password-requirements">
        {t("auth.passwordForm.requirements", { min: MIN_PASSWORD_LENGTH })}
      </Text>
      {message ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="password-error">
          {message}
        </Text>
      ) : null}
      <Button label={submitLabel} onPress={() => void submit()} loading={saving} testID="password-submit" />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  hint: { fontSize: 12.5, lineHeight: 18 },
  error: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
