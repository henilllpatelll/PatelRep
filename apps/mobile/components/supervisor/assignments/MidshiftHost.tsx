import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Body } from "@/components/supervisor/assignments/BulkParts";
import { MidshiftDestinationStep } from "@/components/supervisor/assignments/MidshiftDestinationStep";
import { ChangesNotice } from "@/components/supervisor/assignments/MidshiftParts";
import { MidshiftReviewStep } from "@/components/supervisor/assignments/MidshiftReviewStep";
import { MidshiftSelectStep } from "@/components/supervisor/assignments/MidshiftSelectStep";
import { Button } from "@/components/ui/Button";
import type { MidshiftController, MidshiftStep } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── The midshift redistribution sheet ─────────────────────────────────────
   ONE bottom-sheet Modal for the guided flow — rooms → who → review — so there is never a second modal on top and Android
   Back steps one view at a time (and closes from the first). A sticky footer carries each step's action. It draws the
   controller's state; every rule lives in the domain and the hook. Closing it changes nothing: nothing is staged until
   "Add changes to draft", and nothing is published from here at all. */

const STEP_NUMBER: Record<Exclude<MidshiftStep, "conflict">, number> = { select: 1, destination: 2, preview: 3 };

function ConflictView({ midshift, t }: { midshift: MidshiftController; t: (key: string, options?: Record<string, unknown>) => string }) {
  const theme = useTheme();
  return (
    <View style={styles.conflict} testID="midshift-conflict">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.conflictTitle, { color: theme.textPrimary }]}>
        {t("assignments.v2.midshift.conflict.title")}
      </Text>
      <Body tone="secondary">{t("assignments.v2.midshift.conflict.body", { count: midshift.overlap.length })}</Body>
      <Button label={t("assignments.v2.midshift.conflict.replace")} onPress={() => midshift.addToDraft("replace")} testID="midshift-conflict-replace" />
      <Body tone="muted">{t("assignments.v2.midshift.conflict.replaceHint")}</Body>
      <Button label={t("assignments.v2.midshift.conflict.keep")} variant="secondary" onPress={() => midshift.addToDraft("keep")} testID="midshift-conflict-keep" />
      <Body tone="muted">{t("assignments.v2.midshift.conflict.keepHint")}</Body>
      <Button label={t("assignments.v2.midshift.conflict.cancel")} variant="secondary" onPress={midshift.cancelConflict} testID="midshift-conflict-cancel" />
    </View>
  );
}

export function MidshiftHost({ midshift, onOpenBoard }: { midshift: MidshiftController; onOpenBoard: (roomId: string) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { source, step } = midshift;
  if (!midshift.userId || !source) return null;

  const name = source.name;
  const title = name ? t("assignments.v2.midshift.title", { name }) : t("assignments.v2.midshift.titleUnnamed");
  const number = step === "conflict" ? STEP_NUMBER.preview : STEP_NUMBER[step];
  const stepName = t(`assignments.v2.midshift.steps.${step === "select" ? "select" : step === "destination" ? "destination" : "review"}`);
  const canGoBack = step !== "select";

  let body: React.ReactNode;
  if (step === "select") body = <MidshiftSelectStep midshift={midshift} t={t} onOpenBoard={onOpenBoard} />;
  else if (step === "destination") body = <MidshiftDestinationStep midshift={midshift} t={t} />;
  else if (step === "conflict") body = <ConflictView midshift={midshift} t={t} />;
  else body = <MidshiftReviewStep midshift={midshift} t={t} />;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={midshift.back} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={midshift.close} accessible={false} importantForAccessibility="no" testID="midshift-backdrop" />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.background }]} testID="midshift-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            {canGoBack ? (
              <Pressable onPress={midshift.back} accessibilityRole="button" accessibilityLabel={t("assignments.v2.midshift.back")} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID="midshift-back">
                <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
              </Pressable>
            ) : null}
            <View style={styles.titleBlock}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="midshift-title" numberOfLines={2}>
                {title}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="midshift-subtitle">
                {t("assignments.v2.midshift.subtitle", { count: source.counts.assigned })} · {t("assignments.v2.midshift.stepOf", { step: number, total: 3 })} · {stepName}
              </Text>
            </View>
            <Pressable onPress={midshift.close} accessibilityRole="button" accessibilityLabel={t("assignments.v2.midshift.close")} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID="midshift-close">
              <Ionicons name="close" size={22} color={theme.textPrimary} />
            </Pressable>
          </View>
          {midshift.changes ? (
            <View style={styles.changes}>
              <ChangesNotice midshift={midshift} t={t} />
            </View>
          ) : null}
          {body}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { height: "92%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 19, fontWeight: "800" },
  sub: { fontSize: 12.5, fontWeight: "600" },
  icon: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  changes: { marginTop: 8 },
  conflict: { gap: 10, paddingVertical: 8 },
  conflictTitle: { fontSize: 19, fontWeight: "800" },
});
