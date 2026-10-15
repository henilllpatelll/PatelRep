import { useState, type ComponentProps, type Ref } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface AuthTextFieldProps extends ComponentProps<typeof TextInput> {
  icon: IconName;
  /** Adds a show/hide control; the field starts hidden. */
  revealable?: boolean;
  invalid?: boolean;
  inputRef?: Ref<TextInput>;
}

/** Themed single-line field shared by sign-in, recovery and password screens. */
export function AuthTextField({ icon, revealable, invalid, inputRef, testID, style, ...inputProps }: AuthTextFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.surface, borderColor: invalid ? theme.status.dirty : theme.border },
      ]}
      testID={testID ? `${testID}-container` : undefined}
    >
      <Ionicons name={icon} size={15} color={theme.textMuted} />
      <TextInput
        {...inputProps}
        ref={inputRef}
        testID={testID}
        accessibilityLabel={inputProps.accessibilityLabel ?? inputProps.placeholder}
        secureTextEntry={revealable ? !revealed : inputProps.secureTextEntry}
        maxFontSizeMultiplier={1.4}
        style={[styles.input, { color: theme.textPrimary }, style]}
        placeholderTextColor={theme.textMuted}
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
}

const styles = StyleSheet.create({
  wrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  eye: { width: 36, height: 44, alignItems: "center", justifyContent: "center", marginRight: -6 },
});
