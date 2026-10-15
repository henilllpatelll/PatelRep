import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const MAX_FONT_SCALE = 1.4;

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
}

/** One navigation row inside a SettingsSection: icon tile, label + subtitle, optional badge, chevron. */
export function SettingsRow({ icon, label, subtitle, onPress, destructive, trailing, first, testID }: SettingsRowProps) {
  const theme = useTheme();
  const fg = destructive ? theme.status.dirty : theme.textPrimary;
  const a11yLabel = [label, subtitle, trailing].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      testID={testID}
      android_ripple={{ color: theme.borderSubtle }}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: theme.surfaceMuted },
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
      {onPress && !destructive ? <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} /> : null}
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
