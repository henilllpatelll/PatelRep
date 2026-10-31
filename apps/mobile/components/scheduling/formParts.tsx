import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

/* Small building blocks shared by the shift form, the template form and the detail sheet. */

export function FieldLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textMuted }]}>
      {children.toUpperCase()}
    </Text>
  );
}

export function ErrorText({ text, testID }: { text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID={testID}>
      {text}
    </Text>
  );
}

/** A tappable row that shows a current value and opens a picker. */
export function ValueRow({ label, value, placeholder, onPress, disabled, testID }: { label: string; value: string | null; placeholder: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value ?? placeholder}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }, disabled && { opacity: 0.55 }, pressed && { opacity: 0.8 }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.rowValue, { color: value ? theme.textPrimary : theme.textMuted }]}>
        {value ?? placeholder}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

interface StepperProps {
  label: string;
  value: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  testID: string;
  prevLabel: string;
  nextLabel: string;
}

function StepButton({ icon, onPress, name, disabled, testID }: { icon: "chevron-back" | "chevron-forward"; onPress: () => void; name: string; disabled: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.step, { borderColor: theme.border, backgroundColor: theme.surface }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={theme.textPrimary} />
    </Pressable>
  );
}

/** A previous / next day stepper: moves one hotel-local day at a time. */
export function DateStepper({ label, value, onPrev, onNext, prevDisabled, testID, prevLabel, nextLabel }: StepperProps) {
  const theme = useTheme();
  return (
    <View style={styles.stepper} testID={testID}>
      <StepButton icon="chevron-back" onPress={onPrev} name={prevLabel} disabled={Boolean(prevDisabled)} testID={`${testID}-prev`} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`${label}. ${value}`} style={[styles.stepperValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
      <StepButton icon="chevron-forward" onPress={onNext} name={nextLabel} disabled={false} testID={`${testID}-next`} />
    </View>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  testID: string;
  multiline?: boolean;
  maxLength?: number;
  error?: string | null;
}

export function TextField({ label, value, onChangeText, placeholder, testID, multiline, maxLength, error }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        multiline={multiline}
        maxLength={maxLength}
        autoCorrect={false}
        testID={testID}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.input, multiline && { minHeight: 84, textAlignVertical: "top" }, { backgroundColor: theme.surfaceSubtle, borderColor: error ? theme.status.dirty : theme.border, color: theme.textPrimary }]}
      />
      {error ? <ErrorText text={error} testID={`${testID}-error`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  error: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  row: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  rowValue: { flex: 1, fontSize: 16, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: { width: MIN_TARGET, height: MIN_TARGET, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700" },
  field: { gap: 6 },
  input: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
});
