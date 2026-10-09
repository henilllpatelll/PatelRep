import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "./BottomSheet";

/** Small building blocks shared by the Report / More forms so they look and read the same. */

export function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
      {children}
      {required ? <Text style={{ color: theme.status.dirty }}> *</Text> : null}
    </Text>
  );
}

/** Inline validation, announced when it appears. */
export function FieldError({ message, testID }: { message: string | null | undefined; testID?: string }) {
  const theme = useTheme();
  if (!message) return null;
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[styles.error, { color: theme.status.dirty }]}
      testID={testID}
    >
      {message}
    </Text>
  );
}

export function StatusText({ message, tone = "muted", testID }: { message: string; tone?: "muted" | "warn" | "ok" | "error"; testID?: string }) {
  const theme = useTheme();
  const color =
    tone === "error" ? theme.status.dirty : tone === "warn" ? theme.status.pickup : tone === "ok" ? theme.status.ready : theme.textMuted;
  return (
    <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color }]} testID={testID}>
      {message}
    </Text>
  );
}

interface TextAreaProps extends TextInputProps {
  label: string;
  /** Shown as "n/max" under the field when set. */
  max?: number;
  invalid?: boolean;
}

export function TextArea({ label, max, invalid, value, style, ...rest }: TextAreaProps) {
  const theme = useTheme();
  const length = (value ?? "").length;
  return (
    <View style={styles.areaWrap}>
      <TextInput
        {...rest}
        value={value}
        multiline
        maxLength={max}
        accessibilityLabel={label}
        placeholderTextColor={theme.textMuted}
        textAlignVertical="top"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[
          styles.area,
          { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: invalid ? theme.status.dirty : theme.border },
          style,
        ]}
      />
      {max ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel={`${length} / ${max}`}
          style={[styles.counter, { color: length >= max ? theme.status.dirty : theme.textMuted }]}
        >
          {length}/{max}
        </Text>
      ) : null}
    </View>
  );
}

export function RadioOption({
  label,
  hint,
  selected,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      style={[
        styles.radio,
        { backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle, borderColor: selected ? theme.primaryLine : theme.border },
        disabled && styles.dim,
      ]}
      testID={testID}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? theme.primaryAction : theme.textMuted} />
      <View style={styles.flex}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.radioLabel, { color: theme.textPrimary }]}>
          {label}
        </Text>
        {hint ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.radioHint, { color: theme.textSecondary }]}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
  tone,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Overrides the selected fill (e.g. urgent). */
  tone?: { bg: string; fg: string };
  testID?: string;
}) {
  const theme = useTheme();
  const bg = selected ? (tone?.bg ?? theme.primarySoft) : theme.surfaceSubtle;
  const fg = selected ? (tone?.fg ?? theme.primaryAction) : theme.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      style={[styles.chip, { backgroundColor: bg, borderColor: selected ? (tone?.bg ?? theme.primaryLine) : theme.border }, disabled && styles.dim]}
      testID={testID}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 4 },
  error: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  status: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  areaWrap: { gap: 4 },
  area: { minHeight: 96, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  counter: { fontSize: 12, textAlign: "right" },
  radio: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  radioLabel: { fontSize: 15, fontWeight: "700" },
  radioHint: { fontSize: 13, lineHeight: 18 },
  chip: { minHeight: 44, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "700" },
  dim: { opacity: 0.5 },
});
