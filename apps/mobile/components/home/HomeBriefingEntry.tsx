import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  /** The deterministic, on-phone headline ("Start with room 214"). Free: never an AI request. */
  headline: string;
  t: Translate;
  onOpen: () => void;
}

/**
 * Design System V2 entry into the Shift briefing drawer: the soft-violet AI treatment, a sparkle icon, one
 * concise line and a clear way in. Opening Home never asks the AI for anything: the line below comes from the
 * assignments on this phone, and the drawer only requests a written briefing when the person asks for one.
 */
export function HomeBriefingEntry({ headline, t, onOpen }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${t("home.briefing.open")}. ${headline}. ${t("home.briefing.v2Provenance")}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.ai.soft, borderColor: theme.ai.line },
        pressed && { opacity: 0.8 },
      ]}
      testID="briefing-open"
    >
      <View style={[styles.icon, { backgroundColor: theme.surface, borderColor: theme.ai.line }]}>
        <Ionicons name="sparkles" size={18} color={theme.ai.primary} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText variant="label" tone="ai" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {t("home.briefing.open")}
          </AppText>
          <View style={[styles.chip, { borderColor: theme.ai.line, backgroundColor: theme.surface }]}>
            <AppText variant="micro" tone="ai">
              {t("home.briefing.aiChip")}
            </AppText>
          </View>
        </View>
        <AppText variant="bodyStrong" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {headline}
        </AppText>
        <AppText variant="micro" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {t("home.briefing.v2Provenance")}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spaceV2.md,
    borderWidth: 1,
    borderRadius: radiusV2.card,
    padding: spaceV2.md,
  },
  icon: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  chip: { borderWidth: 1, borderRadius: radiusV2.pill, paddingHorizontal: 8, paddingVertical: 1 },
});
