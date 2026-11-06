import { useState, type ComponentProps, type Ref } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { TextInputInstance } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { AppText } from "@/components/ui/AppText";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface AuthTextFieldProps extends ComponentProps<typeof TextInput> {
  icon: IconName;
  /** Adds a show/hide control; the field starts hidden. */
  revealable?: boolean;
  invalid?: boolean;
  inputRef?: Ref<TextInputInstance>;
}

/** Themed single-line field shared by sign-in, recovery and password screens. */
export function AuthTextField({ icon, revealable, invalid, inputRef, testID, style, ...inputProps }: AuthTextFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const v2 = useIsDesignV2();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const field = (
    <View
      style={[
        styles.wrap,
        v2 && styles.wrapV2,
        {
          backgroundColor: theme.surface,
          borderColor: invalid ? theme.status.dirty : v2 && focused ? theme.primaryAction : theme.border,
        },
      ]}
      testID={testID ? `${testID}-container` : undefined}
    >
      <Ionicons name={icon} size={v2 ? 18 : 15} color={theme.textMuted} />
      <TextInput
        {...inputProps}
        ref={inputRef}
        testID={testID}
        accessibilityLabel={inputProps.accessibilityLabel ?? inputProps.placeholder}
        secureTextEntry={revealable ? !revealed : inputProps.secureTextEntry}
        maxFontSizeMultiplier={1.4}
        style={[styles.input, v2 && styles.inputV2, { color: theme.textPrimary }, style]}
        placeholderTextColor={theme.textMuted}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
      />
      {revealable ? (
        <Pressable
          onPress={() => setRevealed((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={t(revealed ? "auth.hidePassword" : "auth.showPassword")}
          hitSlop={8}
          style={styles.eye}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={18} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
  if (!v2 || !inputProps.placeholder) return field;
  // V2: a visible label above the field (the placeholder is only a hint, never the sole label).
  return (
    <View style={styles.labelled}>
      <AppText variant="label" tone="secondary" maxFontSizeMultiplier={1.4}>
        {inputProps.placeholder}
      </AppText>
      {field}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  wrapV2: { minHeight: 52, borderRadius: 12, gap: 10, borderWidth: 1.5 },
  labelled: { gap: 6 },
  inputV2: { fontSize: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  eye: { width: 36, height: 44, alignItems: "center", justifyContent: "center", marginRight: -6 },
});
