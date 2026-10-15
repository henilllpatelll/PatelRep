import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * The few building blocks every Home drawer shares: a spacious action row, a
 * labelled section, a fact line, a notice and a "nothing here any more" state.
 * Kept here (not in the sheets) so the drawers read the same.
 */

export function SheetSection({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
          {title}
        </Text>
      ) : null}
      {children}
      {hint ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

interface ActionRowProps {
  icon: IconName;
  title: string;
  hint?: string;
  /** Words (not just a dimmed row) for why it cannot be used. */
  disabledReason?: string | null;
  onPress: () => void;
  /** "navigate" shows a chevron; "form" shows an add mark: the row opens a form, it does not send anything. */
  kind?: "navigate" | "form";
  testID?: string;
  accessibilityLabel?: string;
}

export function SheetActionRow({ icon, title, hint, disabledReason, onPress, kind = "navigate", testID, accessibilityLabel }: ActionRowProps) {
  const theme = useTheme();
  const disabled = Boolean(disabledReason);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}. ${disabledReason ?? hint ?? ""}`.trim()}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
        disabled && styles.dim,
        pressed && !disabled && { opacity: 0.7 },
      ]}
      testID={testID}
    >
      <Ionicons name={icon} size={22} color={theme.textSecondary} />
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
          {title}
        </Text>
        {disabledReason || hint ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.rowHint, { color: disabledReason ? theme.status.pickup : theme.textSecondary }]}
          >
            {disabledReason ?? hint}
          </Text>
        ) : null}
      </View>
      <Ionicons name={kind === "form" ? "add" : "chevron-forward"} size={18} color={theme.textMuted} />
    </Pressable>
  );
}

export function SheetFact({ icon, text, testID }: { icon: IconName; text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact} testID={testID}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} style={styles.factIcon} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factText, { color: theme.textPrimary }]}>
        {text}
      </Text>
    </View>
  );
}

export function SheetNotice({ text, tone = "info", testID }: { text: string; tone?: "info" | "warn" | "error"; testID?: string }) {
  const theme = useTheme();
  const color = tone === "error" ? theme.status.dirty : tone === "warn" ? theme.status.pickup : theme.textSecondary;
  const icon: IconName = tone === "error" ? "alert-circle-outline" : tone === "warn" ? "lock-closed-outline" : "information-circle-outline";
  return (
    <View
      style={[styles.notice, { backgroundColor: theme.surfaceMuted }]}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={color} style={styles.factIcon} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
        {text}
      </Text>
    </View>
  );
}

/** What a drawer shows when the thing it was opened for is gone or changed. */
export function SheetGone({ title, body, closeLabel, onClose, testID }: { title: string; body: string; closeLabel: string; onClose: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.gone} testID={testID}>
      <Ionicons name="information-circle-outline" size={28} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.goneTitle, { color: theme.textPrimary }]}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.goneBody, { color: theme.textSecondary }]}>
        {body}
      </Text>
      <Button label={closeLabel} onPress={onClose} variant="secondary" testID={testID ? `${testID}-close` : undefined} />
    </View>
  );
}

export function SheetSubtitle({ text }: { text: string | null }) {
  const theme = useTheme();
  if (!text) return null;
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  hint: { fontSize: 12, lineHeight: 17 },
  row: {
    minHeight: Math.max(MIN_TARGET, 60),
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { fontSize: 15, fontWeight: "800" },
  rowHint: { fontSize: 13, lineHeight: 18 },
  dim: { opacity: 0.65 },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  factIcon: { marginTop: 2 },
  factText: { flex: 1, fontSize: 14, lineHeight: 20 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, padding: 12 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  gone: { alignItems: "center", gap: 8, paddingVertical: 12 },
  goneTitle: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  goneBody: { fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20 },
});
