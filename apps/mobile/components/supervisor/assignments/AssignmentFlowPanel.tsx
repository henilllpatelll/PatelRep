import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { AssignPickerStep } from "@/components/supervisor/assignments/AssignPickerStep";
import { AppliedOutcome, ConflictOutcome, UnknownOutcome } from "@/components/supervisor/assignments/AssignOutcomeStep";
import { AssignRemoveStep } from "@/components/supervisor/assignments/AssignRemoveStep";
import { AssignReviewStep } from "@/components/supervisor/assignments/AssignReviewStep";
import type { AssignmentFlowController } from "@/lib/housekeeping/useAssignmentFlow";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Assignment flow panel ─────────────────────────────────────────────────
   Renders the controller's current step INSIDE the room sheet's one Modal — picker → review → result, or the
   removal confirmation — so there is never a second modal on top and Android Back steps one view at a time.
   It draws state; every rule and every write lives in `useAssignmentFlow` and `assignmentPicker`. */

export function AssignmentFlowPanel({
  controller,
  paused,
  outOfView,
}: {
  controller: AssignmentFlowController;
  /** Why changes are paused right now (offline / board not live), or null. */
  paused: string | null;
  /** The room no longer matches the list the supervisor is looking at (shown after a successful change). */
  outOfView: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { flow, entry, busy, error, conflict } = controller;
  if (!flow || !entry) return null;

  const outcome = flow.outcome;
  const roomNumber = entry.room.roomNumber;
  const reassign = entry.ownership.assigned;
  const title =
    flow.step === "remove"
      ? t("assignments.v2.assign.remove.title")
      : flow.step === "review"
        ? t(reassign ? "assignments.v2.assign.review.titleReassign" : "assignments.v2.assign.review.titleAssign")
        : t(reassign ? "assignments.v2.assign.picker.titleReassign" : "assignments.v2.assign.picker.titleAssign", { room: roomNumber });
  const showBack = flow.step === "review" && !outcome && !conflict;
  const hardBlock = entry.eligibility.hardBlock;

  // The most specific reason first: a failure of the last press, else a room that can no longer be changed.
  const bannerKey = error ? `assignments.v2.assign.error.${error}` : hardBlock && !outcome ? `assignments.v2.sheet.frozen.${hardBlock}` : null;
  const banner = bannerKey ? (
    <View
      style={[styles.banner, { backgroundColor: theme.surfaceMuted, borderColor: error ? theme.destructiveAction : theme.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="assign-banner"
    >
      <Ionicons name={error ? "alert-circle-outline" : "information-circle-outline"} size={18} color={error ? theme.destructiveAction : theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
        {t(bannerKey)}
      </Text>
    </View>
  ) : null;

  let body: React.ReactNode;
  if (outcome?.kind === "applied") body = <AppliedOutcome outcome={outcome} outOfView={outOfView} controller={controller} t={t} />;
  else if (outcome?.kind === "unknown") body = <UnknownOutcome controller={controller} error={error === "still_unknown"} t={t} />;
  else if (conflict) body = <ConflictOutcome conflict={conflict} controller={controller} t={t} />;
  else if (flow.step === "picker") body = <AssignPickerStep controller={controller} paused={paused} t={t} />;
  else if (flow.step === "review") body = <AssignReviewStep controller={controller} banner={banner} paused={paused} t={t} />;
  else body = <AssignRemoveStep controller={controller} banner={banner} paused={paused} t={t} />;

  return (
    <View style={styles.panel} testID={`assign-panel-${outcome ? outcome.kind : conflict ? "conflict" : flow.step}`}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            onPress={controller.back}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("assignments.v2.assign.review.backToPicker")}
            hitSlop={6}
            style={[styles.iconButton, busy && styles.dimmed]}
            testID="assign-back"
          >
            <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
          </Pressable>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="assign-title">
          {outcome || conflict ? "" : title}
        </Text>
        <Pressable
          onPress={controller.close}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          accessibilityState={{ disabled: busy }}
          hitSlop={6}
          style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }, busy && styles.dimmed]}
          testID="assign-close"
        >
          <Ionicons name="close" size={22} color={theme.textPrimary} />
        </Pressable>
      </View>

      {paused && !outcome ? (
        <View style={[styles.banner, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="assign-paused">
          <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
            {paused}
          </Text>
        </View>
      ) : null}

      {flow.step === "picker" && !outcome && !conflict ? banner : null}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 1, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 17, fontWeight: "800" },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  dimmed: { opacity: 0.5 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
