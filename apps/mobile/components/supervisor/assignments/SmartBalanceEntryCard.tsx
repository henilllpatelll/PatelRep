import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── The Smart Balance entry card ──────────────────────────────────────────
   Quiet on purpose: it sits at the top of the Rooms list for everyday manual work to carry on beneath it. It never
   generates anything - it opens the setup sheet. While the board or connection cannot support planning it says so, and
   it still opens (the sheet then explains what to do). With a plan in progress it offers to resume it. */

export function SmartBalanceEntryCard({ onPress, paused, proposedChanges, t }: { onPress: () => void; paused: "offline" | "not_live" | null; proposedChanges: number | null; t: Translate }) {
  const theme = useTheme();
  const resuming = proposedChanges !== null;
  const title = resuming ? t("assignments.v2.smart.entry.resume") : t("assignments.v2.smart.entry.title");
  const body = resuming ? t("assignments.v2.smart.entry.resumeBody", { count: proposedChanges ?? 0 }) : t("assignments.v2.smart.entry.body");
  const note = paused ? t(`assignments.v2.smart.entry.paused.${paused}`) : null;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[title, body, note].filter(Boolean).join(". ")}
        accessibilityHint={t("assignments.v2.smart.entry.hint")}
        style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.88 }]}
        testID="smart-entry"
      >
        <View style={[styles.badge, { backgroundColor: theme.surfaceSubtle }]}>
          <Ionicons name="sparkles-outline" size={20} color={theme.primaryAction} />
        </View>
        <View style={styles.body}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
            {title}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textSecondary }]}>
            {body}
          </Text>
          {note ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textMuted }]} testID="smart-entry-paused">
              {note}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cta, { color: theme.primaryAction }]}>
            {resuming ? t("assignments.v2.smart.entry.resume") : t("assignments.v2.smart.entry.cta")} →
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 10 },
  card: { flexDirection: "row", gap: 12, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.lg, padding: 14 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "800" },
  text: { fontSize: 13.5, lineHeight: 19 },
  cta: { fontSize: 14.5, fontWeight: "800", paddingTop: 4 },
});
