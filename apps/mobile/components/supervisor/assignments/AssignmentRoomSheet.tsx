import { useMemo } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { AssignmentPanel } from "@/components/supervisor/assignment/AssignmentPanel";
import { ExceptionBlock, FactRows, FlagChips, NoteCard, Section, StatusBadgeLarge, WorkOrderCard } from "@/components/supervisor/detail/RoomDetailParts";
import type { AssignmentRoom } from "@/lib/housekeeping/assignmentModel";
import { describeSheetActions, locationText } from "@/lib/housekeeping/assignmentRoomsView";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { buildRoomDetail, type DetailRow, type RoomDetailContext } from "@/lib/housekeeping/roomDetailView";
import type { AssignmentController } from "@/lib/housekeeping/useRoomAssignment";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Assignment room sheet ─────────────────────────────────────────────────
   The assignment-focused view of ONE room: who has it, how long it should take, why it matters and what is in
   the way, with the actions the rules allow. ONE bottom-sheet Modal for the whole flow: the summary, or — once
   the supervisor starts assigning — the existing assignment panel (picker → review, or the removal
   confirmation), so there is never a second modal on top and Android back steps one view at a time.

   It draws the shared Room Board detail model (`buildRoomDetail`) plus the Assignments eligibility; it fetches
   nothing, owns no write, and cannot offer what the rules refuse: a room being cleaned, submitted, inspected or
   out of service offers no assign / reassign / remove, and a held-back room only the acknowledged path. */

export type AssignmentSheetContext = Omit<RoomDetailContext, "t" | "language">;

interface Props {
  entry: AssignmentRoom;
  context: AssignmentSheetContext;
  assignment: AssignmentController;
  onClose: () => void;
  /** Leaves for the full Room Board detail of this room. */
  onOpenBoard: () => void;
}

export function AssignmentRoomSheet({ entry, context, assignment, onClose, onOpenBoard }: Props) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const language = i18n?.language ?? "en";
  const { room, view, eligibility, priority, estimate } = entry;

  const detail = useMemo(() => buildRoomDetail(view, { ...context, language, t }), [view, context, language, t]);
  const actions = describeSheetActions(entry, context.gate);

  const assigning = assignment.flow !== null && assignment.flow.roomId === room.roomId;
  const writing = assignment.busy;
  const back = () => {
    if (writing) return;
    if (assigning) assignment.back();
    else onClose();
  };
  const dismiss = () => {
    if (writing) return;
    if (assigning) assignment.close();
    onClose();
  };

  const arrival = priority.arrivalAt !== null ? formatHotelTime(new Date(priority.arrivalAt), context.timeZone, language) : null;
  const rows: DetailRow[] = [
    { key: "assignedTo", label: t("assignments.v2.sheet.row.assignedTo"), value: detail.assignment.headline, ...(detail.assignment.kind === "none" ? { muted: true } : {}) },
    estimate
      ? { key: "estimate", label: t("assignments.v2.sheet.row.estimate"), value: t("assignments.v2.card.estimateShort", { minutes: Math.round(estimate.minutes) }) }
      : { key: "estimate", label: t("assignments.v2.sheet.row.estimate"), value: t("roomBoard.detail.notAvailable"), muted: true },
    {
      key: "priority",
      label: t("assignments.v2.sheet.row.priority"),
      value: priority.reasons.length > 0 ? priority.reasons.map((reason) => t(`assignments.v2.priority.${reason}`)).join(" · ") : t("assignments.v2.sheet.priorityRoutine"),
      ...(priority.reasons.length === 0 ? { muted: true } : {}),
    },
    ...(arrival ? [{ key: "arrival", label: t("assignments.v2.sheet.row.arrival"), value: arrival }] : []),
    ...(room.building ? [{ key: "building", label: t("assignments.v2.sheet.row.building"), value: room.building }] : []),
  ];

  // DND and a declined service already have their own explanatory block below; only the rest are listed here.
  const explained = new Set(detail.exceptions.map((exception) => exception.key));
  const held = eligibility.softBlocks
    .filter((block) => !(block === "dnd" && explained.has("dnd")) && !(block === "service_declined" && explained.has("declined")))
    .map((block) => (block === "return_later" ? t("assignments.v2.blocker.return_later", { time: formatHotelTime(eligibility.returnLaterUntil, context.timeZone, language) ?? "—" }) : t(`assignments.v2.blocker.${block}`)));
  const frozenText = actions.frozen ? t(`assignments.v2.sheet.frozen.${actions.frozen}`) : null;
  const hasNotes = detail.note !== null || detail.workOrder !== null || detail.exceptions.length > 0 || held.length > 0 || frozenText !== null;
  const subtitle = [detail.roomType, locationText(entry, t)].filter(Boolean).join(" · ");

  return (
    <Modal visible transparent animationType="slide" onRequestClose={back} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={dismiss} accessible={false} importantForAccessibility="no" testID="assignment-sheet-backdrop" />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.background }]} testID="assignment-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />

          {assigning ? (
            <AssignmentPanel controller={assignment} paused={detail.paused} bottomInset={0} />
          ) : (
            <>
              <View style={styles.header}>
                <View style={styles.headerBody} accessible accessibilityLabel={detail.accessibilityLabel} testID="assignment-sheet-header">
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.roomNumber, { color: theme.textPrimary }]} testID="assignment-sheet-number">
                    {detail.roomNumber}
                  </Text>
                  {subtitle ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]} testID="assignment-sheet-subtitle">
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={6} style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }]} testID="assignment-sheet-close">
                  <Ionicons name="close" size={22} color={theme.textPrimary} />
                </Pressable>
              </View>

              {detail.paused ? (
                <View style={[styles.paused, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="assignment-sheet-paused">
                  <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pausedText, { color: theme.textSecondary }]}>
                    {detail.paused}
                  </Text>
                </View>
              ) : null}

              <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} nestedScrollEnabled testID="assignment-sheet-scroll">
                <View style={styles.badges}>
                  <StatusBadgeLarge rawStatus={detail.rawStatus} label={detail.statusLabel} />
                  <FlagChips flags={detail.flags} />
                </View>

                <Section title={t("roomBoard.detail.section.assignment")} testID="assignment-sheet-section-assignment">
                  <FactRows rows={rows} testID="assignment-sheet-rows" />
                </Section>

                {hasNotes ? (
                  <Section title={t("assignments.v2.sheet.notes")} testID="assignment-sheet-section-notes">
                    {frozenText ? (
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textPrimary }]} testID="assignment-sheet-frozen">
                        {frozenText}
                      </Text>
                    ) : null}
                    {held.length > 0 ? (
                      <View style={styles.held} testID="assignment-sheet-held">
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textPrimary }]}>
                          {t("assignments.v2.sheet.heldBack")}
                        </Text>
                        {held.map((text) => (
                          <Text key={text} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
                            {"• "}
                            {text}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {detail.note ? <NoteCard note={detail.note} t={t} /> : null}
                    {detail.workOrder ? <WorkOrderCard workOrder={detail.workOrder} t={t} /> : null}
                    {detail.exceptions.map((exception) => (
                      <ExceptionBlock key={exception.key} exception={exception} />
                    ))}
                  </Section>
                ) : null}
              </ScrollView>

              <View style={styles.footer}>
                {actions.assign ? (
                  <Button
                    label={actions.assign === "assign" ? t("assignments.v2.sheet.assign") : t("assignments.v2.sheet.reviewAssign")}
                    icon="person-add-outline"
                    variant={actions.assign === "assign" ? "primary" : "secondary"}
                    onPress={() => assignment.openAssign(room.roomId)}
                    disabled={actions.paused}
                    testID="assignment-sheet-assign"
                  />
                ) : null}
                {actions.reassign ? (
                  <Button label={t("roomBoard.detail.action.reassign")} icon="swap-horizontal-outline" onPress={() => assignment.openAssign(room.roomId)} disabled={actions.paused} testID="assignment-sheet-reassign" />
                ) : null}
                {actions.remove ? (
                  <Button label={t("roomBoard.detail.action.remove")} icon="person-remove-outline" variant="secondary" onPress={() => assignment.openRemove(room.roomId)} disabled={actions.paused} testID="assignment-sheet-remove" />
                ) : null}
                <Button label={t("assignments.v2.sheet.openBoard")} icon="grid-outline" variant="ghost" onPress={onOpenBoard} testID="assignment-sheet-open-board" />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10, maxHeight: "92%" },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerBody: { flex: 1, minWidth: 0 },
  roomNumber: { fontFamily: monoFont, fontSize: 34, lineHeight: 40, fontWeight: "800" },
  subtitle: { fontSize: 13.5, fontWeight: "600" },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  paused: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 8 },
  pausedText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  scroll: { flexGrow: 0, marginTop: 10 },
  scrollContent: { gap: 14, paddingBottom: 12 },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  note: { fontSize: 14, lineHeight: 20 },
  held: { gap: 4 },
  footer: { gap: 8, paddingTop: 8 },
});
