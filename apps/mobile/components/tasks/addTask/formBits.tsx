import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";

/* Small building blocks shared by the Add Task steps. */

export function FieldLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
      {children}
    </Text>
  );
}

/** An inline, accessible validation message; announced when it appears. */
export function FieldError({ message, testID }: { message: string | null | undefined; testID?: string }) {
  const theme = useTheme();
  if (!message) return null;
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.error, { color: theme.status.dirty }]}
      testID={testID}
    >
      {message}
    </Text>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  /** Draws attention (a suggestion the person must still confirm). */
  attention?: boolean;
  disabled?: boolean;
}

/** A one-of-many choice (task type, priority, day). Radio semantics for screen readers. */
export function Chip({ label, selected, onPress, testID, attention = false, disabled = false }: ChipProps) {
  const theme = useTheme();
  // A suggestion still waiting to be confirmed is drawn as a warning, selected or not.
  const border = attention ? theme.status.dirty : selected ? theme.primaryAction : theme.borderSubtle;
  const background = attention ? theme.status.dirtySoft : selected ? theme.primaryAction : theme.surfaceSubtle;
  const color = attention ? theme.status.dirty : selected ? theme.onPrimary : theme.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.chip,
        {
          borderColor: border,
          backgroundColor: background,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.chipText, { color }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chipRow}>
      {children}
    </View>
  );
}

interface ValueRowProps {
  label: string;
  value: string;
  actionLabel: string;
  onPress: () => void;
  /** Value is a problem (unverified / unresolved) and is drawn as an error. */
  invalid?: boolean;
  testID?: string;
}

/** A read-only value with a "Change" action that opens its editor. */
export function ValueRow({ label, value, actionLabel, onPress, invalid = false, testID }: ValueRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${actionLabel}`}
      testID={testID}
      style={[
        styles.valueRow,
        { backgroundColor: theme.surfaceSubtle, borderColor: invalid ? theme.status.dirty : theme.borderSubtle },
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={2}
        style={[styles.value, { color: invalid ? theme.status.dirty : theme.textPrimary }]}
      >
        {value}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.action, { color: theme.primaryAction }]}>
        {actionLabel}
      </Text>
    </Pressable>
  );
}

export const inputStyle = {
  borderWidth: 1,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 15,
  minHeight: 48,
} as const;

const styles = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: "700", letterSpacing: 0.2 },
  error: { fontSize: 12.5, fontWeight: "600", lineHeight: 17 },
  field: { gap: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "700" },
  valueRow: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  value: { flex: 1, fontSize: 15, fontWeight: "600" },
  action: { fontSize: 14, fontWeight: "800", minWidth: 44, textAlign: "right" },
});
