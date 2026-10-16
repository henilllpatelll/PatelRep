import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { SummaryRow } from "@/lib/ai/actionSummary";

const MAX_FONT_SCALE = 1.6;

interface Props {
  rows: SummaryRow[];
  /** "Prepared from your description" etc.; omit to hide the line. */
  prepared?: string | null;
  palette?: Palette;
}

/**
 * The list of everything an action is about to commit, as the confirmation drawer shows it. The assistant's
 * drawer (ActionConfirmPanel) and the Report Issue review both render their rows through this, so the person
 * reads the same summary whichever way a work order was prepared.
 */
export function ConfirmRows({ rows, prepared, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.wrap}>
      {prepared ? (
        <View style={styles.prepared}>
          <Ionicons name="sparkles" size={14} color={theme.ai.primary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.preparedText}>
            {prepared}
          </Text>
        </View>
      ) : null}
      {rows.length > 0 ? (
        <View style={styles.rows} testID="confirm-rows">
          {rows.map((row) => (
            <View key={row.key} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.rowLabel}>
                {row.label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, row.warn && styles.rowWarn]}>
                {row.value}
              </Text>
              {row.warn ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.warn}>
                  {t("copilot.action.roomUnverified", { room: row.value })}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    wrap: { gap: 10 },
    prepared: { flexDirection: "row", alignItems: "center", gap: 6 },
    preparedText: { fontSize: 12.5, color: theme.textMuted, fontWeight: "600" },
    rows: { borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceElevated, paddingHorizontal: 14, paddingVertical: 4 },
    row: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle, gap: 2 },
    rowLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", color: theme.textMuted },
    rowValue: { fontSize: 15.5, lineHeight: 21, color: theme.textPrimary, fontWeight: "600" },
    rowWarn: { color: theme.status.pickup },
    warn: { fontSize: 12.5, lineHeight: 18, color: theme.status.pickup },
  });
