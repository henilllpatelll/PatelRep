import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

/* Small shared pieces of the bulk-assignment surfaces. Nothing here knows about rooms or drafts. */

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Text that follows the app's font scaling cap and theme. */
export function Body({ children, tone = "primary", style, testID, strong }: { children: React.ReactNode; tone?: "primary" | "secondary" | "muted" | "alert"; style?: StyleProp<TextStyle>; testID?: string; strong?: boolean }) {
  const theme = useTheme();
  const color = tone === "primary" ? theme.textPrimary : tone === "secondary" ? theme.textSecondary : tone === "muted" ? theme.textMuted : theme.destructiveAction;
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color }, strong && styles.strong, style]} testID={testID}>
      {children}
    </Text>
  );
}

export function SectionLabel({ children, testID }: { children: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textMuted }]} testID={testID}>
      {children.toUpperCase()}
    </Text>
  );
}

/** A square or round choice mark; the surrounding Pressable carries the role and state. */
export function Mark({ checked, shape = "square", disabled }: { checked: boolean; shape?: "square" | "round"; disabled?: boolean }) {
  const theme = useTheme();
  const name: IconName = disabled ? "ban-outline" : shape === "round" ? (checked ? "radio-button-on" : "radio-button-off") : checked ? "checkbox" : "square-outline";
  return <Ionicons name={name} size={26} color={disabled ? theme.textMuted : checked ? theme.primaryAction : theme.textSecondary} />;
}

/** An inline, never colour-only, statement with an icon. */
export function Notice({ icon = "information-circle-outline", tone = "info", children, testID, live }: { icon?: IconName; tone?: "info" | "alert"; children: React.ReactNode; testID?: string; live?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: tone === "alert" ? theme.destructiveAction : theme.border }]}
      accessibilityRole="alert"
      {...(live ? { accessibilityLiveRegion: "polite" as const } : {})}
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={tone === "alert" ? theme.destructiveAction : theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
        {children}
      </Text>
    </View>
  );
}

/** A chip that can be pressed (floor / building shortcuts). */
export function ToggleChip({ label, state, onPress, testID, a11yLabel, a11yHint }: { label: string; state: "all" | "some" | "none"; onPress: () => void; testID?: string; a11yLabel: string; a11yHint?: string }) {
  const theme = useTheme();
  const on = state !== "none";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: state === "all" ? true : state === "some" ? "mixed" : false }}
      accessibilityLabel={a11yLabel}
      {...(a11yHint ? { accessibilityHint: a11yHint } : {})}
      style={({ pressed }) => [styles.chip, { backgroundColor: on ? theme.surface : theme.surfaceMuted, borderColor: on ? theme.primaryAction : theme.border }, pressed && { opacity: 0.85 }]}
      testID={testID}
    >
      <Ionicons name={state === "all" ? "checkmark-circle" : state === "some" ? "remove-circle-outline" : "add-circle-outline"} size={16} color={on ? theme.primaryAction : theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  strong: { fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TARGET, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1 },
  chipText: { fontSize: 13.5, fontWeight: "700" },
});
