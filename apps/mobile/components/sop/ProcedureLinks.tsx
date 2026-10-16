import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { SOPDocument } from "@/lib/api/sop";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  docs: SOPDocument[];
  onOpen: (documentId: string) => void;
}

/**
 * Procedures the hotel really has that match what is on screen. Plain links to the documents themselves: opening one
 * asks no model anything and changes nothing about the task or room being looked at.
 */
export function ProcedureLinks({ docs, onOpen }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (docs.length === 0) return null;
  return (
    <View style={styles.wrap} testID="procedure-links">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
        {t("sop.related.title")}
      </Text>
      {docs.map((doc) => (
        <Pressable
          key={doc.id}
          onPress={() => onOpen(doc.id)}
          accessibilityRole="button"
          accessibilityLabel={t("sop.related.open", { title: doc.title })}
          style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
          testID="procedure-link"
        >
          <Ionicons name="document-text-outline" size={18} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowText, { color: theme.textPrimary }]} numberOfLines={2}>
            {doc.title}
          </Text>
          <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  rowText: { flex: 1, fontSize: 14.5, fontWeight: "600" },
});
