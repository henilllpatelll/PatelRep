import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import {
  AssignmentCard,
  CleaningCard,
  ExceptionBlock,
  FactRows,
  FlagChips,
  NoteCard,
  Section,
  StatusBadgeLarge,
  WorkOrderCard,
} from "@/components/supervisor/detail/RoomDetailParts";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { assignmentsHref } from "@/lib/navigation/supervisorRoutes";
import { AssignmentPanel } from "@/components/supervisor/assignment/AssignmentPanel";
import { RoomActionsList } from "@/components/supervisor/detail/RoomActionsList";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView } from "@/lib/housekeeping/roomBoardState";
import { buildRoomDetail, type DetailActionKey, type RoomDetailContext } from "@/lib/housekeeping/roomDetailView";
import type { AssignmentController } from "@/lib/housekeeping/useRoomAssignment";
import { CleaningHistoryPanel, InspectionHistoryPanel, SessionPanel, WorkOrderPanel, type HistoryTab } from "@/components/supervisor/panels/HistoryPanels";
import { NotePanel, WellnessPanel } from "@/components/supervisor/panels/NoteAndWellnessPanels";
import { PanelHeader } from "@/components/supervisor/panels/PanelParts";
import type { HistoryContext } from "@/lib/housekeeping/roomCleaningHistory";
import { useRoomNote } from "@/lib/housekeeping/useRoomNote";
import { useRoomWellness } from "@/lib/housekeeping/useRoomWellness";
import { inspectionHref, recordHref } from "@/lib/inspections/route";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";


/* ─── Room detail drawer — what the supervisor needs before acting ─────────
   ONE bottom-sheet Modal for the whole flow (Room → More actions), so there is never a second modal stacked on
   top: Android back steps More actions → Room → closed. Everything shown comes from the verified Phase 1
   `BoardRoomView` through `buildRoomDetail`; this component fetches nothing and subscribes to nothing, so a
   realtime update to the board simply re-renders it for the same room.

   Assign / reassign / remove open the assignment panel IN THIS SAME Modal (picker → review, or the removal
   confirmation) and hand control back to the room when it closes; the controller owns the one mutation state.
   Phase 6 adds the note, wellness-check, cleaning-history (+ activity), session, inspection-history and read-only
   work-order views to the SAME Modal as a small stack: Back pops one, nothing opens a second Modal, and a write in
   flight (assignment, note, wellness) cannot be dismissed. "Inspect room" closes the drawer and opens the
   inspection queue already focused on THIS room (by id). */

export type RoomDetailSheetContext = Omit<RoomDetailContext, "t" | "language">;

/** The views stacked over the room. An empty stack is the room itself. */
type PanelView = "actions" | "note" | "wellness" | "cleaning" | "session" | "inspections" | "workOrder";

/** What the drawer needs from the screen to write and to refresh (kept out of the pure context). */
export interface RoomDetailDeps {
  scopeKey: string | null;
  userId: string | null;
  refresh: () => Promise<void>;
}

export function RoomDetailSheet({
  room,
  view,
  context,
  assignment,
  deps,
  onClose,
}: {
  room: BoardRoom;
  view: BoardRoomView;
  context: RoomDetailSheetContext;
  assignment: AssignmentController;
  deps: RoomDetailDeps;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const [stack, setStack] = useState<PanelView[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("cleans");
  const top: PanelView | "detail" = (stack[stack.length - 1] as PanelView | undefined) ?? "detail";
  const push = (next: PanelView) => setStack((current) => [...current, next]);
  const pop = () => setStack((current) => current.slice(0, -1));

  const language = i18n?.language ?? "en";
  const detail = useMemo(
    () => buildRoomDetail(view, { ...context, language, t }),
    // The screen rebuilds `context` only when something it reads changes, so this recomputes on real changes.
    [view, context, language, t],
  );

  const note = useRoomNote({ room, gate: context.gate, scopeKey: deps.scopeKey, userId: deps.userId, refresh: deps.refresh, onSaved: pop, t, toast });
  const wellness = useRoomWellness({ room, gate: context.gate, scopeKey: deps.scopeKey, refresh: deps.refresh });
  const historyCtx = useMemo<HistoryContext>(
    () => ({
      now: context.now,
      timeZone: context.timeZone,
      language,
      t,
      nameOf: (userId) => {
        const name = context.staffNamesKnown ? context.staff.find((member) => member.userId === userId)?.name?.trim() : undefined;
        return name && name !== "—" ? name : null;
      },
    }),
    [context.now, context.timeZone, context.staff, context.staffNamesKnown, language, t],
  );

  // The room's owner, in Assignments: their rooms and workload. This drawer closes first so two sheets never stack.
  const viewWorkload = (staffId: string) => {
    onClose();
    openSupervisorHref(assignmentsHref({ staffId }));
  };
  const assigning = assignment.flow !== null && assignment.flow.roomId === room.roomId;
  const saving = assignment.busy;
  // Never dismiss mid-write; never let a stray tap on the backdrop throw away a typed note.
  const writing = assignment.busy || note.busy || wellness.busy;
  const draftOpen = top === "note" && note.draft.trim().length > 0;
  // Android back / swipe: one view at a time (assignment step → panel → room → closed). Never mid-write.
  const back = () => {
    if (writing) return;
    if (assigning) assignment.back();
    else if (stack.length > 0) pop();
    else onClose();
  };
  const dismiss = () => {
    if (writing || draftOpen) return;
    if (assigning) assignment.close();
    onClose();
  };
  const cancelNote = () => {
    note.reset();
    pop();
  };
  const cancelWellness = () => {
    wellness.reset();
    pop();
  };

  const run = (key: DetailActionKey) => {
    switch (key) {
      case "assign":
      case "reassign":
        assignment.openAssign(room.roomId);
        return;
      case "remove":
        assignment.openRemove(room.roomId);
        return;
      case "inspect":
        // Close first, then open the active inspection for this room by its stable id (the number is display only).
        // The workspace itself decides whether the room can be inspected; opening it starts nothing.
        onClose();
        router.push(inspectionHref(room.roomId, room.roomNumber, "board") as never);
        return;
      case "note":
        push("note");
        return;
      case "wellness":
        push("wellness");
        return;
      case "cleaningHistory":
        setHistoryTab("cleans");
        push("cleaning");
        return;
      case "inspectionHistory":
        push("inspections");
        return;
      case "workOrder":
        push("workOrder");
        return;
    }
  };

  const titleOf = (view: PanelView): string => {
    const params = { room: detail.roomNumber };
    switch (view) {
      case "actions":
        return t("roomBoard.detail.actionsTitle", params);
      case "note":
        return t("roomBoard.panel.note.title", params);
      case "wellness":
        return t("roomBoard.panel.wellness.title", params);
      case "cleaning":
        return t(historyTab === "activity" ? "roomBoard.panel.activity.title" : "roomBoard.panel.cleaning.title", params);
      case "session":
        return t("roomBoard.panel.session.title", params);
      case "inspections":
        return t("roomBoard.panel.inspections.title", params);
      case "workOrder":
        return t("roomBoard.panel.workOrder.title", params);
    }
  };

  const assignAction = [detail.primary, ...detail.menu].find((action) => action?.key === "assign" || action?.key === "reassign") ?? null;
  const primaryIsAssign = detail.primary?.key === "assign" || detail.primary?.key === "reassign";
  const hasIssues = detail.note !== null || detail.workOrder !== null || detail.exceptions.length > 0;
  const scrollProps = { style: styles.scroll, contentContainerStyle: styles.scrollContent, showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: "handled" as const };

  const panelBody = () => {
    switch (top) {
      case "note":
        return <NotePanel roomNumber={detail.roomNumber} controller={note} t={t} onCancel={cancelNote} />;
      case "wellness":
        return <WellnessPanel controller={wellness} t={t} onDone={cancelWellness} onCancel={cancelWellness} />;
      case "cleaning":
        return (
          <CleaningHistoryPanel
            roomId={room.roomId}
            ctx={historyCtx}
            tab={historyTab}
            onTab={setHistoryTab}
            onOpenSession={(id) => {
              setSessionId(id);
              push("session");
            }}
            t={t}
          />
        );
      case "session":
        return sessionId ? <SessionPanel sessionId={sessionId} ctx={historyCtx} t={t} /> : null;
      case "inspections":
        return (
          <InspectionHistoryPanel
            roomId={room.roomId}
            ctx={historyCtx}
            t={t}
            onOpenInspection={(inspectionId) => {
              // The same canonical record screen as the Inspect tab: close the drawer, then open it by the inspection's id.
              onClose();
              router.push(recordHref(inspectionId, "board", room.roomId, room.roomNumber) as never);
            }}
          />
        );
      case "workOrder":
        return detail.workOrder?.id ? (
          <WorkOrderPanel workOrderId={detail.workOrder.id} roomId={room.roomId} roomNumber={detail.roomNumber} boardOpen ctx={historyCtx} t={t} />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={back} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessible={false} importantForAccessibility="no" testID="room-detail-backdrop" />
      <View
        accessibilityViewIsModal
        style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.background }]}
        testID={top === "detail" ? "room-detail-sheet" : top === "actions" ? "room-actions-sheet" : `room-panel-${top}`}
      >
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />

        {assigning ? (
          <AssignmentPanel controller={assignment} paused={detail.paused} bottomInset={0} />
        ) : top === "detail" ? (
          <View style={styles.header}>
            <View style={styles.headerBody} accessible accessibilityLabel={detail.accessibilityLabel} testID="room-detail-header">
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.roomNumber, { color: theme.textPrimary }]} testID="room-detail-number">
                {detail.roomNumber}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]} testID="room-detail-subtitle">
                {[detail.roomType, detail.location].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <CloseButton label={t("common.close")} onPress={onClose} />
          </View>
        ) : top === "actions" ? (
          <View style={styles.header}>
            <Pressable
              onPress={pop}
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              hitSlop={6}
              style={styles.iconButton}
              testID="room-actions-back"
            >
              <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
            </Pressable>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              accessibilityRole="header"
              style={[styles.actionsTitle, { color: theme.textPrimary }]}
              testID="room-actions-title"
            >
              {titleOf("actions")}
            </Text>
            <CloseButton label={t("common.close")} onPress={onClose} />
          </View>
        ) : (
          <PanelHeader title={titleOf(top)} onBack={back} onClose={() => (writing ? undefined : onClose())} backDisabled={writing} />
        )}

        {detail.paused && !assigning ? (
          <View style={[styles.paused, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="room-detail-paused">
            <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pausedText, { color: theme.textSecondary }]}>{detail.paused}</Text>
          </View>
        ) : null}

        {assigning ? null : top === "detail" ? (
          <>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              testID="room-detail-scroll"
            >
              <View style={styles.badges}>
                <StatusBadgeLarge rawStatus={detail.rawStatus} label={detail.statusLabel} />
                <FlagChips flags={detail.flags} />
              </View>

              <Section title={t("roomBoard.detail.section.status")} testID="room-detail-section-status">
                <FactRows rows={detail.statusRows} />
              </Section>

              <Section title={t("roomBoard.detail.section.assignment")} testID="room-detail-section-assignment">
                <AssignmentCard
                  assignment={detail.assignment}
                  primaryIsAssignment={primaryIsAssign}
                  saving={saving}
                  onAssign={() => assignAction && run(assignAction.key)}
                  action={assignAction}
                  onViewWorkload={room.assignedTo && !writing ? () => viewWorkload(room.assignedTo as string) : undefined}
                  t={t}
                />
              </Section>

              <Section title={t("roomBoard.detail.section.cleaning")} testID="room-detail-section-cleaning">
                <CleaningCard cleaning={detail.cleaning} />
              </Section>

              {hasIssues ? (
                <Section title={t("roomBoard.detail.section.issues")} testID="room-detail-section-issues">
                  {detail.note ? <NoteCard note={detail.note} t={t} /> : null}
                  {detail.workOrder ? <WorkOrderCard workOrder={detail.workOrder} t={t} /> : null}
                  {detail.workOrder?.id ? (
                    <Button label={t("roomBoard.detail.action.workOrder")} icon="construct-outline" variant="secondary" size="sm" onPress={() => run("workOrder")} testID="room-detail-work-order-open" />
                  ) : null}
                  {detail.exceptions.map((exception) => (
                    <ExceptionBlock key={exception.key} exception={exception} />
                  ))}
                  {detail.wellnessCheck ? (
                    <Button
                      label={t("roomBoard.panel.wellness.open")}
                      icon="moon-outline"
                      variant="secondary"
                      size="sm"
                      onPress={() => run("wellness")}
                      disabled={!context.gate.allowed}
                      testID="room-detail-wellness"
                    />
                  ) : null}
                </Section>
              ) : null}
            </ScrollView>

            <View style={styles.footer}>
              {detail.primary ? (
                <Button
                  label={detail.primary.label}
                  icon={detail.primary.key === "inspect" ? "shield-checkmark-outline" : "person-add-outline"}
                  onPress={() => run((detail.primary as { key: DetailActionKey }).key)}
                  loading={saving && primaryIsAssign}
                  disabled={detail.primary.disabled}
                  size="md"
                  testID="room-detail-primary"
                />
              ) : null}
              {detail.menu.length > 0 ? (
                <Button
                  label={t("roomBoard.detail.moreActions")}
                  icon="ellipsis-horizontal"
                  variant="secondary"
                  size="md"
                  onPress={() => push("actions")}
                  testID="room-detail-more"
                />
              ) : null}
            </View>
          </>
        ) : top === "actions" ? (
          <ScrollView {...scrollProps}>
            <RoomActionsList actions={detail.menu} onSelect={run} />
          </ScrollView>
        ) : (
          <ScrollView {...scrollProps} testID="room-panel-scroll">
            {panelBody()}
          </ScrollView>
        )}
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }]}
      testID="room-detail-close"
    >
      <Ionicons name="close" size={22} color={theme.textPrimary} />
    </Pressable>
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
  actionsTitle: { flex: 1, fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  paused: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 8 },
  pausedText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  scroll: { flexGrow: 0, marginTop: 10 },
  scrollContent: { gap: 14, paddingBottom: 12 },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  footer: { gap: 8, paddingTop: 8 },
});
