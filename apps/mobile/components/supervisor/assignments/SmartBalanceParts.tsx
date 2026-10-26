import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Mark } from "@/components/supervisor/assignments/BulkParts";
import { useTheme } from "@/lib/theme/useTheme";

/* Small shared pieces of the Smart Balance sheet. Nothing here knows about plans or rooms. */

export function SheetHeader({ title, onBack, backLabel, onClose, closeLabel, testID }: { title: string; onBack?: () => void; backLabel?: string; onClose?: () => void; closeLabel?: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID={`${testID}-back`}>
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </Pressable>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID={`${testID}-title`}>
        {title}
      </Text>
      {onClose ? (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID={`${testID}-close`}>
          <Ionicons name="close" size={22} color={theme.textPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A switch row. `locked` rows are always on and cannot be pressed (a safety rule, not a preference). */
export function ToggleRow({ label, checked, onPress, locked, lockedLabel, testID }: { label: string; checked: boolean; onPress?: () => void; locked?: boolean; lockedLabel?: string; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      disabled={locked}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled: locked === true }}
      accessibilityLabel={locked && lockedLabel ? `${label}. ${lockedLabel}` : label}
      style={({ pressed }) => [styles.row, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && !locked && { opacity: 0.85 }]}
      testID={testID}
    >
      <Mark checked={checked} shape="square" />
      <View style={styles.rowBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
          {label}
        </Text>
        {locked && lockedLabel ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowHint, { color: theme.textMuted }]}>
            {lockedLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** One scope choice: a radio with a title and a sentence. */
export function ScopeRow({ label, hint, warning, selected, disabled, onPress, testID }: { label: string; hint: string; warning?: string | null; selected: boolean; disabled?: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: disabled === true }}
      accessibilityLabel={[label, hint, selected ? warning : null].filter(Boolean).join(". ")}
      style={({ pressed }) => [styles.row, { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: theme.surface }, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: 0.85 }]}
      testID={testID}
    >
      <Mark checked={selected} shape="round" disabled={disabled === true} />
      <View style={styles.rowBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
          {label}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowHint, { color: theme.textSecondary }]}>
          {hint}
        </Text>
        {selected && warning ? (
          <View style={styles.warning} testID={`${testID}-warning`}>
            <Ionicons name="warning-outline" size={15} color={theme.destructiveAction} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.warningText, { color: theme.destructiveAction }]}>
              {warning}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A figure with a caption, for the summary strip. */
export function Stat({ text, tone = "primary", testID }: { text: string; tone?: "primary" | "alert"; testID: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stat, { color: tone === "alert" ? theme.destructiveAction : theme.textPrimary }]} testID={testID}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 19, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: MIN_TARGET, borderWidth: 1.5, borderRadius: R.lg, paddingHorizontal: 12, paddingVertical: 10 },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15.5, fontWeight: "700" },
  rowHint: { fontSize: 13.5, lineHeight: 19 },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 6 },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  stat: { fontSize: 14, fontWeight: "700" },
});
