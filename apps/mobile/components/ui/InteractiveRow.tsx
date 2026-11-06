import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";

export interface InteractiveRowProps {
  title: string;
  subtitle?: string;
  leadingIcon?: React.ComponentProps<typeof Ionicons>["name"];
  /** Replaces the default chevron (a StatusBadge, a count, a switch...). */
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Extra spoken hint, e.g. why the row is disabled. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** InteractiveRow: a >=56dp list/settings row. Pressable only when `onPress` is given; a
 *  trailing chevron signals that it navigates. Titles and subtitles wrap, never truncate to one
 *  line, so Spanish and large-text layouts stay readable. */
export function InteractiveRow({
  title,
  subtitle,
  leadingIcon,
  trailing,
  onPress,
  disabled = false,
  accessibilityHint,
  style,
  testID,
}: InteractiveRowProps) {
  const theme = useTheme();
  const content = (
    <>
      {leadingIcon ? (
        <View style={[styles.iconTile, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name={leadingIcon} size={18} color={theme.primaryAction} />
        </View>
      ) : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong" tone={disabled ? "muted" : "primary"}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        ) : null)}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, { borderColor: theme.borderSubtle }, style]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.borderSubtle },
        pressed && !disabled ? { backgroundColor: theme.surfaceMuted } : null,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radiusV2.control,
  },
  text: { flex: 1, gap: 2 },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radiusV2.input,
    alignItems: "center",
    justifyContent: "center",
  },
});
