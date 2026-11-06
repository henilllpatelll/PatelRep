import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2, touchV2, typeV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";

export interface TextFieldProps
  extends Omit<TextInputProps, "style" | "placeholderTextColor"> {
  label: string;
  helper?: string;
  /** Error text. Shown with an icon so the state is not color-only. */
  error?: string;
  leadingIcon?: React.ComponentProps<typeof Ionicons>["name"];
  style?: StyleProp<ViewStyle>;
}

/** TextField: visible label above the control (never placeholder-as-label), 48dp minimum height,
 *  a >=3:1 edge (theme.border), a thicker primary edge on focus and an icon+text error state. */
export function TextField({
  label,
  helper,
  error,
  leadingIcon,
  style,
  multiline,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const edge = error ? theme.status.dirty : focused ? theme.primaryAction : theme.border;

  return (
    <View style={[styles.wrap, style]}>
      <AppText variant="label" tone="secondary">
        {label}
      </AppText>
      <View
        style={[
          styles.field,
          {
            minHeight: multiline ? 96 : touchV2.comfortable,
            borderColor: edge,
            borderWidth: focused || error ? 2 : 1,
            backgroundColor: theme.surface,
            alignItems: multiline ? "flex-start" : "center",
          },
        ]}
      >
        {leadingIcon ? (
          <Ionicons name={leadingIcon} size={18} color={theme.textMuted} style={styles.icon} />
        ) : null}
        <TextInput
          {...inputProps}
          multiline={multiline}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          placeholderTextColor={theme.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, typeV2.body, { color: theme.textPrimary }]}
        />
      </View>
      {error ? (
        <View style={styles.messageRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={theme.status.dirty} />
          <AppText variant="caption" tone="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : helper ? (
        <AppText variant="caption" tone="muted">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

export interface SearchFieldProps
  extends Omit<TextFieldProps, "label" | "leadingIcon" | "multiline"> {
  /** Accessible name and placeholder, e.g. "Search rooms". */
  label: string;
  clearLabel: string;
  onClear: () => void;
}

/** SearchField: a TextField with a search glyph and a 44dp clear button once there is text. */
export function SearchField({ label, clearLabel, onClear, value, ...rest }: SearchFieldProps) {
  const theme = useTheme();
  const hasText = typeof value === "string" && value.length > 0;
  return (
    <View style={styles.searchWrap}>
      <TextField
        {...rest}
        label={label}
        value={value}
        placeholder={label}
        leadingIcon="search-outline"
        returnKeyType="search"
        autoCorrect={false}
      />
      {hasText ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          hitSlop={4}
          style={styles.clear}
        >
          <Ionicons name="close-circle" size={20} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: {
    flexDirection: "row",
    borderRadius: radiusV2.input,
    paddingHorizontal: 12,
  },
  icon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 10 },
  messageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flex: { flex: 1 },
  searchWrap: { position: "relative" },
  clear: {
    position: "absolute",
    right: 4,
    bottom: 2,
    width: touchV2.min,
    height: touchV2.comfortable,
    alignItems: "center",
    justifyContent: "center",
  },
});
