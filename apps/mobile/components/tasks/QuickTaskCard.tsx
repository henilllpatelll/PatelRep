import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";

/* The one clear AI-assisted way into Add Task. It opens the same Add Task sheet (Describe step) the "+ Add task"
   button opens, so there is no second form: typing opens the sheet on the description, and the microphone opens
   it already listening. Nothing is created from here and nothing is sent until the person continues. */

interface Props {
  onType: () => void;
  /** Only given when this phone can listen; otherwise the card has no microphone at all. */
  onVoice?: () => void;
  disabled?: boolean;
}

export function QuickTaskCard({ onType, onVoice, disabled = false }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="quick-task-card">
      <View style={styles.eyebrowRow}>
        <Ionicons name="sparkles-outline" size={14} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.eyebrow, { color: theme.textMuted }]}>
          {t("tasks.hk.quick.title")}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("tasks.hk.quick.body")}
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={onType}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t("tasks.hk.quick.describe")}
          accessibilityHint={t("tasks.hk.quick.hint")}
          style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, opacity: disabled ? 0.55 : 1 }]}
          testID="quick-task-describe"
        >
          <Ionicons name="add" size={18} color={theme.primaryAction} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.inputText, { color: theme.textPrimary }]} numberOfLines={1}>
            {t("tasks.hk.quick.describe")}
          </Text>
        </Pressable>
        {onVoice ? (
          <Pressable
            onPress={onVoice}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={t("tasks.hk.quick.voice")}
            hitSlop={4}
            style={[styles.mic, { backgroundColor: theme.surface, borderColor: theme.border, opacity: disabled ? 0.55 : 1 }]}
            testID="quick-task-voice"
          >
            <Ionicons name="mic-outline" size={22} color={theme.textPrimary} />
          </Pressable>
        ) : null}
      </View>
      {disabled ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="quick-task-offline">
          {t("tasks.hk.quick.offline")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  body: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  inputText: { flex: 1, fontSize: 15.5, fontWeight: "700" },
  mic: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  note: { fontSize: 12.5, lineHeight: 18 },
});
