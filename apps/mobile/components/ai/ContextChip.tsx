import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { ActiveContext } from "@/lib/ai/launch";

const MAX_FONT_SCALE = 1.6;

/** Contexts worth showing: the person should always see what the assistant is about, and be able to drop it. */
export function showsContext(context: ActiveContext): boolean {
  return context.type !== "general";
}

interface Props {
  context: ActiveContext;
  /** A room number the SERVER confirmed for this context, or the launcher's own label (unconfirmed). */
  label: { text: string | null; verified: boolean };
  onClear: () => void;
  palette?: Palette;
}

/** "About: Room 218 ✓" with a way to remove it. Hidden for the plain housekeeping context. */
export function ContextChip({ context, label, onClear, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (!showsContext(context)) return null;

  const name = label.text
    ? t(`assistant.context.${context.type}With`, { name: label.text })
    : t(`assistant.context.${context.type}`);
  return (
    <View style={styles.chip} testID="assistant-context-chip" accessible accessibilityLabel={t("assistant.context.about", { name })}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.text} numberOfLines={1}>
        {t("assistant.context.about", { name })}
      </Text>
      {label.verified ? <Ionicons name="checkmark-circle" size={14} color={theme.status.ready} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("assistant.context.remove")}
        hitSlop={10}
        onPress={onClear}
        style={styles.remove}
        testID="assistant-context-clear"
      >
        <Ionicons name="close" size={16} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    chip: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 36,
      paddingLeft: 12,
      paddingRight: 4,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.ai.line,
      backgroundColor: theme.ai.soft,
      maxWidth: "100%",
    },
    text: { flexShrink: 1, fontSize: 13, fontWeight: "700", color: theme.textPrimary },
    remove: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  });
