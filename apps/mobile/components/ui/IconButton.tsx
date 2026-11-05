import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2, touchV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";

export interface IconButtonProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  /** Required: an icon-only control must always have a spoken name. */
  accessibilityLabel: string;
  onPress: () => void;
  variant?: "plain" | "tonal";
  /** Unread/attention count. Rendered as text too, so it is not color-only. */
  badgeCount?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** IconButton: 44x44 minimum hit target (the glyph itself is 22). */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = "plain",
  badgeCount,
  disabled = false,
  style,
  testID,
}: IconButtonProps) {
  const theme = useTheme();
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;
  const label = showBadge ? `${accessibilityLabel}, ${badgeCount}` : accessibilityLabel;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: variant === "tonal" || pressed ? theme.surfaceMuted : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={22} color={theme.textPrimary} />
      {showBadge ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: theme.destructiveAction, borderColor: theme.surface },
          ]}
        >
          <AppText
            variant="micro"
            style={{ color: theme.onDestructive }}
            maxFontSizeMultiplier={1.2}
          >
            {badgeCount > 9 ? "9+" : String(badgeCount)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: touchV2.min,
    minHeight: touchV2.min,
    borderRadius: radiusV2.control,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
