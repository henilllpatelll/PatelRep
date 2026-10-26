import { ScrollView, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { ImpactBlock } from "@/components/supervisor/assignments/AssignWorkloadParts";
import type { AssignmentFlowController } from "@/lib/housekeeping/useAssignmentFlow";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The removal confirmation: who has the room, what removing does, and — just as important — what it does NOT do. */
export function AssignRemoveStep({ controller, banner, paused, t }: { controller: AssignmentFlowController; banner: React.ReactNode; paused: string | null; t: Translate }) {
  const theme = useTheme();
  const { removal, busy } = controller;
  if (!removal) return null;
  const owner = removal.owner.name ?? t("assignments.v2.assign.unnamed");
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="assign-remove-scroll">
        {banner}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.roomNumber, { color: theme.textPrimary }]} testID="assign-remove-room">
            {removal.roomNumber}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
            {t("assignments.v2.assign.remove.assignedTo").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.person, { color: theme.textPrimary }]} testID="assign-remove-owner">
            {owner}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID="assign-remove-status">
            {t("assignments.v2.assign.remove.status", { status: t(removal.statusKey) })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID="assign-remove-stage">
            {t(`assignments.v2.assign.review.stage.${removal.stage}`)}
          </Text>
        </View>

        <View style={styles.will} testID="assign-remove-effects">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.willTitle, { color: theme.textPrimary }]}>
            {t("assignments.v2.assign.remove.willTitle")}
          </Text>
          {(["queue", "list", "kept"] as const).map((key) => (
            <Text key={key} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textSecondary }]} testID={`assign-remove-effect-${key}`}>
              {"• "}
              {t(`assignments.v2.assign.remove.effect.${key}`, { name: owner })}
            </Text>
          ))}
        </View>

        {removal.impact ? <ImpactBlock impact={removal.impact} heading={owner} t={t} tone="release" testID="assign-remove-impact" /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label={t("assignments.v2.assign.remove.confirm")}
          variant="destructive"
          icon="person-remove-outline"
          onPress={() => void controller.confirm()}
          loading={busy}
          disabled={!controller.canConfirm || !!paused}
          testID="assign-remove-confirm"
        />
        <Button label={t("common.cancel")} variant="secondary" onPress={controller.close} disabled={busy} testID="assign-remove-cancel" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 14, paddingBottom: 8 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  roomNumber: { fontFamily: monoFont, fontSize: 30, lineHeight: 36, fontWeight: "800" },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, paddingTop: 6 },
  person: { fontSize: 19, fontWeight: "800" },
  line: { fontSize: 14, lineHeight: 20 },
  will: { gap: 4 },
  willTitle: { fontSize: 14.5, fontWeight: "800" },
  footer: { gap: 8, paddingTop: 6 },
});
