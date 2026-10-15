import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";

/** Larger system text scales the layout up to here, then stops (it must still fit a small phone). */
export const MAX_FONT_SCALE = 1.6;
/** Platform-recommended minimum touch target. */
export const MIN_TARGET = 48;

/** Small uppercase section label ("YOUR PROGRESS"). */
export function Kicker({ children, color }: { children: string; color?: string }) {
  const theme = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      accessibilityRole="header"
      style={[styles.kicker, { color: color ?? theme.textMuted }]}
    >
      {children}
    </Text>
  );
}

interface LinkButtonProps {
  label: string;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  expanded?: boolean;
}

/** A quiet text action with a full-size touch target ("View all →"). */
export function LinkButton({ label, onPress, icon, disabled, testID, accessibilityLabel, expanded }: LinkButtonProps) {
  const theme = useTheme();
  const color = disabled ? theme.textDisabled : theme.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled), ...(expanded === undefined ? {} : { expanded }) }}
      testID={testID}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color }]}>
        {label}
      </Text>
      {icon ? <Ionicons name={icon} size={16} color={color} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  link: {
    minHeight: MIN_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  linkText: { fontSize: 14, fontWeight: "700" },
});
