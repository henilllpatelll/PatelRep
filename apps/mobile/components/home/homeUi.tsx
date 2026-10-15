import { forwardRef, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, type View } from "react-native";
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
export const LinkButton = forwardRef<View, LinkButtonProps>(function LinkButton(
  { label, onPress, icon, disabled, testID, accessibilityLabel, expanded },
  ref,
) {
  const theme = useTheme();
  const color = disabled ? theme.textDisabled : theme.primary;
  return (
    <Pressable
      ref={ref}
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
});

interface MoreButtonProps {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/** "More" for a room card: opens that room's actions drawer. A full-size target that never competes with the primary action. */
export const MoreButton = forwardRef<View, MoreButtonProps>(function MoreButton({ label, accessibilityLabel, onPress, testID }, ref) {
  const theme = useTheme();
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.more, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, pressed && { opacity: 0.65 }]}
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.moreText, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  more: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  moreText: { fontSize: 14, fontWeight: "700" },
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
