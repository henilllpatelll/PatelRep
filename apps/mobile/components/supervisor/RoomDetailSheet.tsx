import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { AssignmentPanel } from "@/components/supervisor/assignment/AssignmentPanel";
import { RoomActionsList } from "@/components/supervisor/detail/RoomActionsList";
import { api } from "@/lib/api/client";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView } from "@/lib/housekeeping/roomBoardState";
import { buildRoomDetail, type DetailActionKey, type RoomDetailContext } from "@/lib/housekeeping/roomDetailView";
import type { AssignmentController } from "@/lib/housekeeping/useRoomAssignment";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

/* ─── Room detail drawer — what the supervisor needs before acting ─────────
   ONE bottom-sheet Modal for the whole flow (Room → More actions), so there is never a second modal stacked on
   top: Android back steps More actions → Room → closed. Everything shown comes from the verified Phase 1
   `BoardRoomView` through `buildRoomDetail`; this component fetches nothing and subscribes to nothing, so a
   realtime update to the board simply re-renders it for the same room.

   Assign / reassign / remove open the assignment panel IN THIS SAME Modal (picker → review, or the removal
   confirmation) and hand control back to the room when it closes; the controller owns the one mutation state.
   The inspection queue and the confirmed DND wellness-check task are unchanged. Notes, history and work-order
   detail are later phases. */

export type RoomDetailSheetContext = Omit<RoomDetailContext, "t" | "language">;

type Mode = "detail" | "actions";

export function RoomDetailSheet({
  room,
  view,
  context,
  assignment,
  onClose,
}: {
  room: BoardRoom;
  view: BoardRoomView;
  context: RoomDetailSheetContext;
  assignment: AssignmentController;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("detail");
  const [wellnessBusy, setWellnessBusy] = useState(false);
  const wellnessGuard = useRef(false);

  const language = i18n?.language ?? "en";
  const detail = useMemo(
    () => buildRoomDetail(view, { ...context, language, t }),
    // The screen rebuilds `context` only when something it reads changes, so this recomputes on real changes.
    [view, context, language, t],
  );

  // A realtime change can empty the menu while it is open (e.g. the room was inspected): fall back to the room.
  useEffect(() => {
    if (mode === "actions" && detail.menu.length === 0) setMode("detail");
  }, [mode, detail.menu.length]);

  const assigning = assignment.flow !== null && assignment.flow.roomId === room.roomId;
  const saving = assignment.busy;
  // Android back / swipe: one view at a time (assignment step → room/actions → closed). Never mid-write.
  const back = () => {
    if (assigning) assignment.back();
    else if (mode === "actions") setMode("detail");
    else onClose();
  };
  const dismiss = () => {
    if (assigning && assignment.busy) return;
    if (assigning) assignment.close();
    onClose();
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
        onClose();
        router.push("/(app)/inspect" as never);
        return;
    }
  };

  const createWellnessCheck = async () => {
    if (wellnessGuard.current) return;
    wellnessGuard.current = true;
    setWellnessBusy(true);
    try {
      await api.post("/tasks", {
        title: `Supervisor wellness check — Room ${room.roomNumber}`,
        task_type: "housekeeping",
        priority: "high",
        room_id: room.roomId,
      });
      toast.success(t("roomBoard.sheet.dndOverrideCreated"));
    } catch {
      toast.error(t("roomBoard.sheet.dndOverrideError"));
    } finally {
      wellnessGuard.current = false;
      setWellnessBusy(false);
    }
  };

  const confirmWellnessCheck = () => {
    Alert.alert(t("roomBoard.sheet.dndOverrideTitle", { room: room.roomNumber }), t("roomBoard.sheet.dndOverrideBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("roomBoard.sheet.dndOverrideConfirm"), onPress: () => void createWellnessCheck() },
    ]);
  };

  const assignAction = [detail.primary, ...detail.menu].find((action) => action?.key === "assign" || action?.key === "reassign") ?? null;
  const primaryIsAssign = detail.primary?.key === "assign" || detail.primary?.key === "reassign";
  const hasIssues = detail.note !== null || detail.workOrder !== null || detail.exceptions.length > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={back} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessible={false} importantForAccessibility="no" testID="room-detail-backdrop" />
      <View
        accessibilityViewIsModal
        style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8), backgroundColor: theme.background }]}
        testID={mode === "detail" ? "room-detail-sheet" : "room-actions-sheet"}
      >
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />

        {assigning ? (
          <AssignmentPanel controller={assignment} paused={detail.paused} bottomInset={0} />
        ) : mode === "detail" ? (
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
        ) : (
          <View style={styles.header}>
            <Pressable
              onPress={() => setMode("detail")}
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
              {t("roomBoard.detail.actionsTitle", { room: detail.roomNumber })}
            </Text>
            <CloseButton label={t("common.close")} onPress={onClose} />
          </View>
        )}

        {detail.paused && !assigning ? (
          <View style={[styles.paused, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="room-detail-paused">
            <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pausedText, { color: theme.textSecondary }]}>{detail.paused}</Text>
          </View>
        ) : null}

        {assigning ? null : mode === "detail" ? (
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
                  {detail.exceptions.map((exception) => (
                    <ExceptionBlock key={exception.key} exception={exception} />
                  ))}
                  {detail.wellnessCheck ? (
                    <Button
                      label={t("roomBoard.sheet.dndOverride")}
                      icon="moon-outline"
                      variant="secondary"
                      size="sm"
                      onPress={confirmWellnessCheck}
                      loading={wellnessBusy}
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
                  onPress={() => setMode("actions")}
                  testID="room-detail-more"
                />
              ) : null}
            </View>
          </>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <RoomActionsList actions={detail.menu} onSelect={run} />
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
