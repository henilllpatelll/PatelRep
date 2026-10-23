import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { BulkAllocateStep } from "@/components/supervisor/assignments/BulkAllocateStep";
import { BulkEditStep } from "@/components/supervisor/assignments/BulkEditStep";
import { Body } from "@/components/supervisor/assignments/BulkParts";
import { CommittedView, PublishingView, RejectedView, UnknownView } from "@/components/supervisor/assignments/BulkOutcomeViews";
import { BulkReviewStep } from "@/components/supervisor/assignments/BulkReviewStep";
import { Button } from "@/components/ui/Button";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import type { MidshiftNote } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── The bulk-assignment sheet ─────────────────────────────────────────────
   ONE bottom-sheet Modal for the whole workflow — allocate → review → edit, and the result of publishing — so there
   is never a second modal on top and Android Back steps one view at a time. It draws the controller's state; every
   rule and every write lives in the hooks.

   Leaving is safe at every step except one: while a request is in flight the sheet cannot be dismissed (the outcome
   would be hidden). An unclear outcome can be closed — the draft indicator stays on the Rooms view — and a result
   is left through its own buttons (Android Back counts as "Return to Rooms"). */

export function BulkAssignHost({ bulk, onViewTeam, midshiftNote }: { bulk: BulkAssignmentController; onViewTeam: () => void; midshiftNote?: MidshiftNote | null }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { panel, publication } = bulk;
  if (!panel) return null;

  const state = publication.state;
  const showingOutcome = panel === "review" && state.kind !== "idle";

  const back = () => {
    if (state.kind === "publishing") return;
    if (panel === "edit") bulk.backToReview();
    else if (panel === "discard") bulk.cancelDiscard();
    else if (showingOutcome && state.kind === "committed") bulk.finish();
    else bulk.closePanel();
  };

  let body: React.ReactNode = null;
  if (panel === "allocate") body = <BulkAllocateStep bulk={bulk} t={t} />;
  else if (panel === "edit") body = <BulkEditStep bulk={bulk} t={t} />;
  else if (panel === "discard") {
    const count = bulk.draft.changeCount;
    body = (
      <View style={styles.discard} testID="bulk-discard">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.discardTitle, { color: theme.textPrimary }]}>
          {t("assignments.v2.bulk.discard.title")}
        </Text>
        <Body tone="secondary">{t("assignments.v2.bulk.discard.body", { count })}</Body>
        <Button label={t("assignments.v2.bulk.discard.confirm")} variant="destructive" onPress={bulk.confirmDiscard} testID="bulk-discard-confirm" />
        <Button label={t("assignments.v2.bulk.discard.keep")} variant="secondary" onPress={bulk.cancelDiscard} testID="bulk-discard-keep" />
      </View>
    );
  } else if (state.kind === "publishing") body = <PublishingView t={t} />;
  else if (state.kind === "committed") body = <CommittedView bulk={bulk} state={state} onViewTeam={onViewTeam} t={t} />;
  else if (state.kind === "rejected") body = <RejectedView bulk={bulk} state={state} t={t} />;
  else if (state.kind === "unknown") body = <UnknownView bulk={bulk} state={state} t={t} />;
  else if (bulk.draft.review) body = <BulkReviewStep bulk={bulk} t={t} midshiftNote={midshiftNote ?? null} />;
  else {
    body = (
      <View style={styles.discard} testID="bulk-review-unavailable">
        <Body tone="secondary">{t("assignments.v2.bulk.review.unavailable")}</Body>
        <Button label={t("common.close")} variant="secondary" onPress={bulk.closePanel} testID="bulk-review-unavailable-close" />
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={back} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={back} accessible={false} importantForAccessibility="no" testID="bulk-backdrop" />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.background }]} testID="bulk-sheet">
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
  discard: { gap: 12, paddingVertical: 8 },
  discardTitle: { fontSize: 19, fontWeight: "800" },
});
