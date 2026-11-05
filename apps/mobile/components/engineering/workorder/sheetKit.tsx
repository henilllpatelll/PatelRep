import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";

/* Small form pieces the repair-workspace sheets share. Presentation only: no requests, no rules. */

export function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  const theme = useTheme();
  const x = useV2Text();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, x.label, { color: theme.textMuted }]}>
      {children}
      {required ? <Text style={{ color: theme.status.dirty }}> *</Text> : null}
    </Text>
  );
}

export function InlineError({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.errorRow} accessibilityLiveRegion="polite" testID={testID}>
      <Ionicons name="alert-circle-outline" size={14} color={theme.status.dirty} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.errorText, { color: theme.status.dirty }]}>
        {children}
      </Text>
    </View>
  );
}

export function Note({ children, tone = "muted", testID }: { children: ReactNode; tone?: "muted" | "warn"; testID?: string }) {
  const theme = useTheme();
  const color = tone === "warn" ? theme.status.pickup : theme.textMuted;
  return (
    <View style={styles.errorRow} testID={testID}>
      <Ionicons name={tone === "warn" ? "information-circle-outline" : "cloud-offline-outline"} size={14} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.errorText, { color }]}>
        {children}
      </Text>
    </View>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Single-choice pills. Selected state is announced, not only coloured. */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
  disabled,
}: {
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (next: T) => void;
  testIDPrefix: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={option.hint ? `${option.label}. ${option.hint}` : option.label}
            testID={`${testIDPrefix}-${option.value}`}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle,
                borderColor: selected ? theme.primaryLine : theme.border,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.chipText, { color: selected ? theme.primaryAction : theme.textPrimary }]}
            >
              {option.label}
            </Text>
            {option.hint ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipHint, { color: theme.textMuted }]}>
                {option.hint}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextArea(props: TextInputProps & { invalid?: boolean }) {
  const theme = useTheme();
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      multiline
      placeholderTextColor={theme.textDisabled}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[
        styles.input,
        styles.area,
        { backgroundColor: theme.surfaceSubtle, borderColor: invalid ? theme.status.dirty : theme.border, color: theme.textPrimary },
        style,
      ]}
    />
  );
}

export function LineInput(props: TextInputProps & { invalid?: boolean }) {
  const theme = useTheme();
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={theme.textDisabled}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[
        styles.input,
        { backgroundColor: theme.surfaceSubtle, borderColor: invalid ? theme.status.dirty : theme.border, color: theme.textPrimary },
        style,
      ]}
    />
  );
}

export const sheetStyles = StyleSheet.create({
  stack: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
});

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 6 },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  errorText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  chips: { gap: 8 },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  chipText: { fontSize: 14.5, fontWeight: "700" },
  chipHint: { fontSize: 12, marginTop: 2 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5 },
  area: { minHeight: 92, textAlignVertical: "top" },
});
