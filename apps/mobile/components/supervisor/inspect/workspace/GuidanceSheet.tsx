import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import type { ChecklistItem, RequiredNaPolicy } from "@/lib/inspections/types";
import { canAnswerNa } from "@/lib/inspections/validation";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * The standard behind one checklist item. It shows the item's configured wording exactly as the hotel wrote it, plus
 * the rules the hotel attached to it (required, photo on failure, N/A). Nothing is composed or paraphrased, and it is
 * read-only: opening and closing it never touches an answer.
 */
export function GuidanceSheet({ item, policy, t, onClose }: { item: ChecklistItem | null; policy: RequiredNaPolicy; t: Translate; onClose: () => void }) {
  const theme = useTheme();
  return (
    <WorkspaceSheet
      visible={item !== null}
      title={t("inspect.workspace.guidance.title")}
      onClose={onClose}
      onBackdrop={onClose}
      testID="workspace-guidance"
      t={t}
      footer={<Button label={t("common.close")} variant="secondary" size="lg" onPress={onClose} testID="workspace-guidance-done" />}
    >
      {item ? (
        <View style={styles.body}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, { color: theme.textMuted }]} testID="workspace-guidance-section">
            {item.section.toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textSecondary }]}>
            {t("inspect.workspace.guidance.standard")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.standard, { color: theme.textPrimary }]} testID="workspace-guidance-standard">
            {item.description}
          </Text>
          <View style={[styles.rules, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Rule text={t(item.isRequired ? "inspect.workspace.guidance.required" : "inspect.workspace.guidance.optional")} />
            {item.requiresPhotoOnFail ? <Rule text={t("inspect.workspace.guidance.photo")} /> : null}
            <Rule text={t(canAnswerNa(item, policy) ? "inspect.workspace.guidance.naAllowed" : "inspect.workspace.guidance.naNotAllowed")} />
          </View>
        </View>
      ) : null}
    </WorkspaceSheet>
  );
}

function Rule({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rule, { color: theme.textPrimary }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { gap: 6 },
  section: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  label: { fontSize: 13, fontWeight: "700", marginTop: 4 },
  standard: { fontSize: 18, lineHeight: 26, fontWeight: "700" },
  rules: { marginTop: 10, borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  rule: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
