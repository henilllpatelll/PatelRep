import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_STYLES: Record<
  ButtonSize,
  { minHeight: number; paddingHorizontal: number; fontSize: number; iconSize: number }
> = {
  sm: { minHeight: 44, paddingHorizontal: 12, fontSize: 14, iconSize: 14 },
  md: { minHeight: 48, paddingHorizontal: 16, fontSize: 15, iconSize: 16 },
  lg: { minHeight: 56, paddingHorizontal: 24, fontSize: 16, iconSize: 18 },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  style,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const sizeStyle = SIZE_STYLES[size];

  let idleBg: string = theme.primaryAction;
  let pressedBg: string = theme.primary;
  let fg: string = theme.onPrimary;
  let borderColor: string | undefined;
  let borderWidth = 0;

  if (variant === "secondary") {
    idleBg = theme.surface;
    pressedBg = theme.surfaceMuted;
    fg = theme.textPrimary;
    borderColor = theme.border;
    borderWidth = 1;
  } else if (variant === "ghost") {
    idleBg = "transparent";
    pressedBg = theme.primarySoft;
    fg = theme.primaryAction;
  } else if (variant === "destructive") {
    idleBg = theme.destructiveAction;
    pressedBg = theme.status.dirty;
    fg = theme.onDestructive;
  }

  if (isDisabled) {
    idleBg = theme.primarySoft;
    pressedBg = theme.primarySoft;
    fg = theme.onDisabled;
    borderColor = theme.primaryLine;
    borderWidth = 1;
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: sizeStyle.minHeight,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          borderRadius: R.md,
          backgroundColor: pressed && !isDisabled ? pressedBg : idleBg,
          borderWidth,
          borderColor,
        },
        variant === "destructive" && pressed && !isDisabled ? styles.destructivePressed : null,
        style,
      ]}
    >
      {icon && !loading ? <Ionicons name={icon} size={sizeStyle.iconSize} color={fg} /> : null}
      <View style={styles.labelWrap}>
        <Text
          style={[
            styles.label,
            { fontSize: sizeStyle.fontSize, color: fg },
            loading ? styles.labelHidden : null,
          ]}
        >
          {label}
        </Text>
        {loading ? <ActivityIndicator size="small" color={fg} style={styles.spinner} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  labelWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontWeight: "600",
  },
  labelHidden: {
    opacity: 0,
  },
  spinner: {
    position: "absolute",
  },
  destructivePressed: {
    opacity: 0.85,
  },
});
