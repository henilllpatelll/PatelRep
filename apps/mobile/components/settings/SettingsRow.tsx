import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

type IconName = React.ComponentProps<typeof Ionicons>["name"];


interface SettingsRowProps {
  icon: IconName;
  label: string;
  subtitle?: string | null;
  onPress?: () => void;
  destructive?: boolean;
  /** Short trailing badge shown before the chevron. */
  trailing?: string | null;
  first?: boolean;
  testID?: string;
  /** Greys the row out and ignores presses (feature unavailable right now). */
  disabled?: boolean;
  /** Renders an on/off switch instead of a chevron; pressing the row toggles it. */
  switchValue?: boolean;
  onSwitchChange?: (next: boolean) => void;
  /** Spoken after the label, e.g. what a double tap will do. */
  accessibilityHint?: string;
}

/** One navigation row inside a SettingsSection: icon tile, label + subtitle, optional badge, chevron. */
export function SettingsRow({
  icon,
  label,
  subtitle,
  onPress,
  destructive,
  trailing,
  first,
  testID,
  disabled,
  switchValue,
  onSwitchChange,
  accessibilityHint,
}: SettingsRowProps) {
  const theme = useTheme();
  const fg = destructive ? theme.status.dirty : theme.textPrimary;
  const isSwitch = switchValue !== undefined;
  const a11yLabel = [label, subtitle, trailing].filter(Boolean).join(", ");
  const press = isSwitch ? () => onSwitchChange?.(!switchValue) : onPress;
  return (
    <Pressable
      onPress={press}
      disabled={!press || disabled}
      accessibilityRole={isSwitch ? "switch" : "button"}
      accessibilityState={isSwitch ? { checked: switchValue, disabled: !!disabled } : { disabled: !!disabled }}
      accessibilityLabel={a11yLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      android_ripple={{ color: theme.borderSubtle }}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: theme.surfaceMuted },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: destructive ? theme.status.dirtySoft : theme.primarySoft }]}>
        <Ionicons name={icon} size={18} color={destructive ? theme.status.dirty : theme.primary} />
      </View>
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: fg }]}>
          {label}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: theme.primary }]}>
            {trailing}
          </Text>
        </View>
      ) : null}
      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          disabled={disabled}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          trackColor={{ true: theme.primaryAction, false: theme.border }}
          testID={testID ? `${testID}-switch` : undefined}
        />
      ) : null}
      {onPress && !destructive && !isSwitch ? <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} /> : null}
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
  },
  iconTile: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 12.5, lineHeight: 17 },
  badge: { minWidth: 22, borderRadius: 11, paddingHorizontal: 7, paddingVertical: 2, alignItems: "center" },
  badgeText: { fontSize: 12, fontWeight: "700" },
});
