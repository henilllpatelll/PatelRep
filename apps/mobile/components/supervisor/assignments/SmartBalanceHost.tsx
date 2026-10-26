import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Body } from "@/components/supervisor/assignments/BulkParts";
import { SmartBalanceDetailStep } from "@/components/supervisor/assignments/SmartBalanceDetailStep";
import { SmartBalanceExceptionsStep } from "@/components/supervisor/assignments/SmartBalanceExceptionsStep";
import { SmartBalancePreviewStep } from "@/components/supervisor/assignments/SmartBalancePreviewStep";
import { SmartBalanceSetupStep } from "@/components/supervisor/assignments/SmartBalanceSetupStep";
import { Button } from "@/components/ui/Button";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { SmartBalanceController } from "@/lib/housekeeping/useSmartBalance";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── The Smart Balance sheet ───────────────────────────────────────────────
   ONE bottom-sheet Modal for the whole workflow - setup → preview → person / exceptions / confirm - so there is never a
   second modal on top and Android Back steps one view at a time. It draws the controller's state; every rule lives in the
   hooks. When the plan goes into the draft the sheet closes and the Phase 5 review (a different, single sheet) opens. */

export function SmartBalanceHost({
  smart,
  model,
  dateLabel,
  onRefresh,
  onViewRoom,
  onViewStaff,
  toast,
}: {
  smart: SmartBalanceController;
  model: AssignmentsModel;
  dateLabel: string | null;
  onRefresh: () => void;
  onViewRoom: (roomId: string) => void;
  onViewStaff: (userId: string) => void;
  toast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { panel } = smart;
  if (!panel) return null;

  const nameOf = (userId: string) => (model.team ?? []).find((member) => member.userId === userId)?.name ?? t("assignments.v2.smart.detail.unnamed");

  let body: React.ReactNode = null;
  if (panel === "setup") body = <SmartBalanceSetupStep smart={smart} onRefresh={onRefresh} t={t} />;
  else if (panel === "preview") body = <SmartBalancePreviewStep smart={smart} dateLabel={dateLabel} nameOf={nameOf} onRefresh={onRefresh} t={t} />;
  else if (panel === "detail") body = <SmartBalanceDetailStep smart={smart} model={model} nameOf={nameOf} toast={toast} t={t} />;
  else if (panel === "exceptions") body = <SmartBalanceExceptionsStep smart={smart} onViewRoom={onViewRoom} onViewStaff={onViewStaff} t={t} />;
  else if (panel === "conflict") {
    body = (
      <View style={styles.confirm} testID="smart-conflict">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.confirmTitle, { color: theme.textPrimary }]}>
          {t("assignments.v2.smart.conflict.title")}
        </Text>
        <Body tone="secondary">{t("assignments.v2.smart.conflict.body", { count: smart.draftOverlap })}</Body>
        <Button label={t("assignments.v2.smart.conflict.merge")} onPress={() => smart.addToDraft("merge")} testID="smart-conflict-merge" />
        <Body tone="muted">{t("assignments.v2.smart.conflict.mergeHint")}</Body>
        <Button label={t("assignments.v2.smart.conflict.replace")} variant="destructive" onPress={() => smart.addToDraft("replace")} testID="smart-conflict-replace" />
        <Body tone="muted">{t("assignments.v2.smart.conflict.replaceHint")}</Body>
        <Button label={t("assignments.v2.smart.conflict.cancel")} variant="secondary" onPress={smart.back} testID="smart-conflict-cancel" />
      </View>
    );
  } else if (panel === "discard") {
    body = (
      <View style={styles.confirm} testID="smart-discard-confirm">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.confirmTitle, { color: theme.textPrimary }]}>
          {t("assignments.v2.smart.discard.title")}
        </Text>
        <Body tone="secondary">{t("assignments.v2.smart.discard.body")}</Body>
        <Button label={t("assignments.v2.smart.discard.confirm")} variant="destructive" onPress={smart.confirmDiscard} testID="smart-discard-yes" />
        <Button label={t("assignments.v2.smart.discard.keep")} variant="secondary" onPress={smart.back} testID="smart-discard-keep" />
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={smart.back} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={smart.back} accessible={false} importantForAccessibility="no" testID="smart-backdrop" />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.background }]} testID="smart-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          {body}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10, maxHeight: "94%" },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 10 },
  confirm: { gap: 12, paddingVertical: 8 },
  confirmTitle: { fontSize: 19, fontWeight: "800" },
});
