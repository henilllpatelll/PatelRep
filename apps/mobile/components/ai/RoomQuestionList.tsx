import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { RoomQuestionId } from "@/lib/housekeeping/roomAssist";

const MAX_FONT_SCALE = 1.6;

const ICONS: Record<RoomQuestionId, React.ComponentProps<typeof Ionicons>["name"]> = {
  checklistLeft: "checkbox-outline",
  reportProblem: "warning-outline",
  openWorkOrders: "build-outline",
  findProcedure: "book-outline",
};

interface Props {
  ids: RoomQuestionId[];
  onAsk: (id: RoomQuestionId) => void;
  /** Rows while the conversation is empty, chips once it has started. */
  variant: "rows" | "chips";
  palette?: Palette;
}

/** "Suggested questions" for the room the assistant is about. Each one is answered from the phone, not by a model. */
export function RoomQuestionList({ ids, onAsk, variant, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (ids.length === 0) return null;
  return (
    <View style={variant === "rows" ? styles.rows : styles.chips} testID="room-questions">
      {variant === "rows" ? (
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.eyebrow}>
          {t("assistant.roomQ.suggested")}
        </Text>
      ) : null}
      {ids.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityLabel={t(`assistant.roomQ.q.${id}`)}
          onPress={() => onAsk(id)}
          style={variant === "rows" ? styles.row : styles.chip}
          testID={`room-question-${id}`}
        >
          {variant === "rows" ? <Ionicons name={ICONS[id]} size={20} color={theme.ai.primary} /> : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={variant === "rows" ? styles.rowText : styles.chipText}>
            {t(`assistant.roomQ.q.${id}`)}
          </Text>
          {variant === "rows" ? <Ionicons name="arrow-forward" size={16} color={theme.textMuted} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    rows: { gap: 8 },
    eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: theme.textMuted },
    row: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.ai.line,
      backgroundColor: theme.surfaceElevated,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    rowText: { flex: 1, fontSize: 15.5, fontWeight: "700", color: theme.textPrimary },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.ai.line,
      backgroundColor: theme.surfaceElevated,
      justifyContent: "center",
    },
    chipText: { fontSize: 13, fontWeight: "700", color: theme.textPrimary },
  });
