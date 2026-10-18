import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { HousekeeperPickerBody } from "@/components/supervisor/HousekeeperPicker";
import { statusLabelKey } from "@/lib/housekeeping/roomBoardModel";
import type { AssignmentController, AssignmentErrorKind } from "@/lib/housekeeping/useRoomAssignment";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Assignment panel ──────────────────────────────────────────────────────
   Renders the controller's current step INSIDE the Room Detail drawer's one Modal (picker → review, or the
   removal confirmation), so there is never a second modal on top and Android back steps one view at a time.
   It draws state; every rule and every write lives in `useRoomAssignment` / `roomAssignment`. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

function CloseButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }, disabled && styles.dimmed]}
      testID="assign-close"
    >
      <Ionicons name="close" size={22} color={theme.textPrimary} />
    </Pressable>
  );
}

function Banner({ kind, t, tone = "warn", testID }: { kind: AssignmentErrorKind; t: Translate; tone?: "warn" | "info"; testID: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.banner, { backgroundColor: theme.surfaceMuted, borderColor: tone === "warn" ? theme.destructiveAction : theme.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Ionicons name={tone === "warn" ? "alert-circle-outline" : "information-circle-outline"} size={18} color={tone === "warn" ? theme.destructiveAction : theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
        {t(`roomBoard.assign.error.${kind}`)}
      </Text>
    </View>
  );
}

function Fact({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factValue, { color: theme.textPrimary }]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

export function AssignmentPanel({
  controller,
  paused,
  bottomInset,
}: {
  controller: AssignmentController;
  /** Why changes are paused right now (offline / stale board), or null. */
  paused: string | null;
  bottomInset: number;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { flow, room, picker, review, removal, busy, error, block } = controller;
  if (!flow || !room) return null;

  const roomNumber = room.roomNumber;
  const reassign = controller.intent === "reassign";
  const title =
    flow.step === "remove"
      ? t("roomBoard.assign.remove.title")
      : flow.step === "review"
        ? t(reassign ? "roomBoard.assign.review.titleReassign" : "roomBoard.assign.review.titleAssign", { room: roomNumber })
        : t(reassign ? "roomBoard.assign.picker.titleReassign" : "roomBoard.assign.picker.titleAssign", { room: roomNumber });
  // Why the room can't be changed now, a conflict, or the last failure — the most specific one wins.
  const banner: AssignmentErrorKind | null =
    error ?? block ?? (controller.changedSinceReview ? "assignee_changed" : null);

  return (
    <View style={styles.panel} testID={`assign-panel-${flow.step}`}>
      <View style={styles.header}>
        {flow.step === "review" ? (
          <Pressable
            onPress={controller.back}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("roomBoard.assign.review.back")}
            hitSlop={6}
            style={[styles.iconButton, busy && styles.dimmed]}
            testID="assign-back"
          >
            <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
          </Pressable>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="assign-title">
          {title}
        </Text>
        <CloseButton label={t("common.close")} onPress={controller.close} disabled={busy} />
      </View>

      {paused ? (
        <View style={[styles.banner, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="assign-paused">
          <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
            {paused}
          </Text>
        </View>
      ) : null}

      {flow.step === "picker" && picker ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
            {t("roomBoard.assign.picker.subtitle")}
          </Text>
          {banner ? <Banner kind={banner} t={t} testID="assign-banner" /> : null}
          <HousekeeperPickerBody
            picker={picker}
            query={flow.query}
            selectedId={flow.selectedId}
            t={t}
            onQuery={controller.setQuery}
            onFilter={controller.setFilter}
            onSelect={controller.select}
          />
          <View style={[styles.footer, { paddingBottom: bottomInset }]}>
            <Button
              label={t(reassign ? "roomBoard.assign.picker.reviewCtaReassign" : "roomBoard.assign.picker.reviewCta")}
              onPress={controller.toReview}
              disabled={!flow.selectedId || block !== null || !!paused}
              testID="assign-review"
            />
            <Button label={t("common.cancel")} variant="secondary" onPress={controller.close} testID="assign-cancel" />
          </View>
        </>
      ) : null}

      {flow.step === "review" && review ? (
        <ReviewStep controller={controller} banner={banner} paused={paused} bottomInset={bottomInset} t={t} />
      ) : null}

      {flow.step === "remove" && removal ? (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {banner ? <Banner kind={banner} t={t} testID="assign-banner" /> : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.removeBody, { color: theme.textPrimary }]} testID="remove-body">
              {removal.assigneeName
                ? t("roomBoard.assign.remove.body", { room: removal.roomNumber, name: removal.assigneeName })
                : t("roomBoard.assign.remove.bodyUnnamed", { room: removal.roomNumber })}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.removeNote, { color: theme.textSecondary }]}>
              {t("roomBoard.assign.remove.outcome")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.removeNote, { color: theme.textSecondary }]} testID="remove-status-kept">
              {t("roomBoard.assign.remove.statusKept")}
            </Text>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: bottomInset }]}>
            <Button
              label={flow.needsCheck ? t("roomBoard.assign.checkAgain") : t("roomBoard.assign.remove.confirm")}
              variant={flow.needsCheck ? "secondary" : "destructive"}
              icon={flow.needsCheck ? "refresh-outline" : "person-remove-outline"}
              onPress={() => void controller.confirm()}
              loading={busy}
              disabled={!controller.canConfirm}
              testID="remove-confirm"
            />
            <Button label={t("common.cancel")} variant="secondary" onPress={controller.close} disabled={busy} testID="remove-cancel" />
          </View>
        </>
      ) : null}
    </View>
  );
}

function ReviewStep({
  controller,
  banner,
  paused,
  bottomInset,
  t,
}: {
  controller: AssignmentController;
  banner: AssignmentErrorKind | null;
  paused: string | null;
  bottomInset: number;
  t: Translate;
}) {
  const theme = useTheme();
  const { flow, review, room, busy } = controller;
  if (!flow || !review || !room) return null;
  const reassign = review.intent === "reassign";
  const unnamed = t("roomBoard.assign.review.unnamed");
  const employee = review.employeeName ?? unnamed;
  const minutes = (value: number) => t("roomBoard.assign.review.minutes", { minutes: value });
  const stateLabel = t(`roomBoard.assign.availability.${review.employeeAvailability}`);
  const ackLabel =
    review.ack === "unverified"
      ? t("roomBoard.assign.review.ackUnverified")
      : review.ack === "not_on_shift"
        ? t("roomBoard.assign.review.ackNotOnShift", { name: employee, state: stateLabel.toLowerCase() })
        : null;
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" testID="assign-review-scroll">
        {banner ? <Banner kind={banner} t={t} testID="assign-banner" /> : null}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Fact label={t("roomBoard.assign.review.room")} value={review.roomNumber} testID="review-room" />
          {reassign ? <Fact label={t("roomBoard.assign.review.from")} value={review.previousName ?? unnamed} testID="review-from" /> : null}
          <Fact label={reassign ? t("roomBoard.assign.review.to") : t("roomBoard.assign.review.employee")} value={employee} testID="review-employee" />
          {reassign ? <Fact label={t("roomBoard.assign.review.status")} value={t(statusLabelKey(room.statusInfo))} testID="review-status" /> : null}
          {review.cleanTypeLabel ? <Fact label={t("roomBoard.assign.review.cleanType")} value={review.cleanTypeLabel} testID="review-clean-type" /> : null}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="review-workload">
          {review.projection ? (
            <>
              <Fact label={t("roomBoard.assign.review.currentWorkload")} value={minutes(review.projection.currentMinutes)} testID="review-current" />
              <Fact label={t("roomBoard.assign.review.roomEstimate", { room: review.roomNumber })} value={minutes(review.projection.roomMinutes)} testID="review-room-estimate" />
              <Fact label={t("roomBoard.assign.review.projected")} value={minutes(review.projection.projectedMinutes)} testID="review-projected" />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.estimateNote, { color: theme.textMuted }]}>
                {t("roomBoard.assign.review.estimateNote")}
              </Text>
              {review.projection.overload ? (
                <View style={styles.inline}>
                  <Ionicons name="warning-outline" size={16} color={theme.destructiveAction} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.estimateNote, { color: theme.destructiveAction }]} testID="review-overload">
                    {t("roomBoard.assign.review.overload", { name: employee })}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.estimateNote, { color: theme.textMuted }]} testID="review-no-estimate">
              {t("roomBoard.assign.review.noEstimate")}
            </Text>
          )}
        </View>

        {ackLabel ? (
          <Pressable
            onPress={() => controller.setAck(!flow.ack)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: flow.ack }}
            accessibilityLabel={ackLabel}
            style={[styles.ack, { borderColor: flow.ack ? theme.primaryAction : theme.border, backgroundColor: theme.surface }]}
            testID="review-ack"
          >
            <Ionicons name={flow.ack ? "checkbox" : "square-outline"} size={24} color={flow.ack ? theme.primaryAction : theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ackText, { color: theme.textPrimary }]}>
              {ackLabel}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <Button
          label={flow.needsCheck ? t("roomBoard.assign.checkAgain") : t(reassign ? "roomBoard.assign.review.confirmReassign" : "roomBoard.assign.review.confirmAssign")}
          icon={flow.needsCheck ? "refresh-outline" : "checkmark"}
          onPress={() => void controller.confirm()}
          loading={busy}
          disabled={!controller.canConfirm || !!paused}
          testID="assign-confirm"
        />
        <Button
          label={controller.changedSinceReview ? t("roomBoard.assign.reviewAgain") : t("common.cancel")}
          variant="secondary"
          onPress={controller.back}
          disabled={busy}
          testID="assign-review-cancel"
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 1, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
  subtitle: { fontSize: 14, fontWeight: "600" },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  dimmed: { opacity: 0.5 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: 12, paddingBottom: 8 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 6 },
  factLabel: { fontSize: 13, fontWeight: "600", flexShrink: 0, maxWidth: "45%" },
  factValue: { fontSize: 14.5, fontWeight: "700", flex: 1, textAlign: "right" },
  estimateNote: { fontSize: 12.5, lineHeight: 17, paddingVertical: 4, flexShrink: 1 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  ack: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, minHeight: 52, paddingVertical: 8 },
  ackText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  removeBody: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  removeNote: { fontSize: 14, lineHeight: 20 },
  footer: { gap: 8, paddingTop: 6 },
});
