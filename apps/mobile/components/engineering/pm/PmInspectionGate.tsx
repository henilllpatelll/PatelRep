import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";
import type { PmInspection } from "@/lib/engineering/usePmInspection";

/** True once there is a draft against a checklist that still matches it, i.e. the technician can start working. */
export function inspectionReady(inspection: PmInspection): boolean {
  return !inspection.loading && !inspection.failure && !!inspection.draft && !!inspection.template && !!inspection.progress && inspection.compatibility === "ok";
}

/**
 * Everything that can stand between opening an inspection and answering its first step: loading, a failed load, a
 * schedule whose procedure cannot be used, a property with no checklists, the choice of checklist for a legacy schedule,
 * and a saved draft that no longer matches its checklist. None of them ever substitutes a guessed checklist.
 */
export function PmInspectionGate({ inspection }: { inspection: PmInspection }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { draft, template, progress, compatibility } = inspection;

  if (inspection.loading) return <EngineeringState status="loading" emptyTitle="" />;
  if (inspection.failure) {
    return <EngineeringState status={inspection.failure === "forbidden" ? "forbidden" : inspection.failure === "offline" ? "offline" : "error"} onRetry={inspection.reload} emptyTitle="" />;
  }
  if (inspection.checklistIssue) {
    const issue = inspection.checklistIssue.state;
    return (
      <Card style={styles.card} testID="pm-checklist-unavailable">
        <Ionicons name="alert-circle-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} accessibilityRole="header">
          {t(`pm.binding.${issue}.title`)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t(`pm.binding.${issue}.body`)}
        </Text>
      </Card>
    );
  }
  if (inspection.templates.length === 0) {
    return (
      <Card style={styles.card} testID="pm-no-templates">
        <Ionicons name="construct-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {t("pm.config.noTemplatesTitle")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.config.noTemplatesBody")}
        </Text>
      </Card>
    );
  }
  if (!draft) {
    return (
      <View style={styles.stack} testID="pm-template-picker">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header">
          {t("pm.chooseChecklist")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("pm.chooseChecklistBody")}
        </Text>
        {inspection.templates.map((tpl) => (
          <Pressable
            key={tpl.id}
            onPress={() => inspection.chooseTemplate(tpl.id)}
            style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityRole="button"
            testID={`pm-template-${tpl.id}`}
          >
            <View style={styles.grow}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
                {tpl.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t("pm.stepsCount", { count: tpl.items.length })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textDisabled} />
          </Pressable>
        ))}
      </View>
    );
  }
  if (compatibility !== "ok" || !template || !progress) {
    return (
      <Card style={styles.card} testID="pm-draft-incompatible">
        <Ionicons name="alert-circle-outline" size={22} color={theme.status.pickup} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {compatibility === "template_missing" ? t("pm.draft.templateMissingTitle") : t("pm.draft.templateChangedTitle")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {compatibility === "template_missing" ? t("pm.draft.templateMissingBody") : t("pm.draft.templateChangedBody")}
        </Text>
        {compatibility === "template_changed" ? <Button label={t("pm.draft.useUpdated")} onPress={inspection.useCurrentChecklist} testID="pm-draft-rebase" /> : null}
        <Button label={t("pm.draft.discard")} variant="secondary" onPress={() => void inspection.discard()} testID="pm-draft-discard-now" />
      </Card>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  grow: { flex: 1 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  hint: { fontSize: 13, lineHeight: 18 },
  card: { padding: 16, gap: 10 },
  title: { fontSize: 15, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 60 },
});
