import { Text, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { typeV2, type TypeRoleV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";

export type AppTextTone =
  | "primary"
  | "secondary"
  | "muted"
  | "accent"
  | "onAccent"
  | "ai"
  | "danger"
  | "success";

export interface AppTextProps extends Omit<TextProps, "style"> {
  /** Typography role from the V2 scale (display to micro). Defaults to `body`. */
  variant?: TypeRoleV2;
  tone?: AppTextTone;
  /** Tabular figures: use for room numbers, timers and counts so digits do not jiggle. */
  numeric?: boolean;
  style?: StyleProp<TextStyle>;
}

/** Large roles cap font scaling a little lower so a hero number cannot blow out its card;
 *  everything else scales generously (layouts wrap instead of clipping). */
const MAX_SCALE: Partial<Record<TypeRoleV2, number>> = { display: 1.3, title: 1.5 };

/** AppText is the single Text entry point for V2 typography roles. Colors resolve through
 *  `useTheme()`, so it is theme-reactive and honours the V2 scope. */
export function AppText({
  variant = "body",
  tone = "primary",
  numeric = false,
  style,
  maxFontSizeMultiplier,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const color = {
    primary: theme.textPrimary,
    secondary: theme.textSecondary,
    muted: theme.textMuted,
    accent: theme.primaryAction,
    onAccent: theme.onPrimary,
    ai: theme.ai.primary,
    danger: theme.status.dirty,
    success: theme.status.ready,
  }[tone];

  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[variant] ?? 2}
      style={[
        typeV2[variant] as TextStyle,
        { color },
        numeric ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
    />
  );
}
