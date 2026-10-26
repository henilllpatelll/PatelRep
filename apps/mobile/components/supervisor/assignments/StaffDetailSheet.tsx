import { useRef } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R, monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { AttendanceChip, CapacityMeter, NoteLine } from "@/components/supervisor/assignments/TeamParts";
import type { RecoveryPanel } from "@/lib/housekeeping/assignmentMidshiftText";
import type { StaffDetailModel, StaffDetailRoom, StaffRoomPhase } from "@/lib/housekeeping/assignmentTeamView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PHASE_ICON: Record<StaffRoomPhase, string> = {
  in_progress: "ellipse",
  not_started: "ellipse-outline",
  completed: "checkmark-circle",
  unavailable: "ban-outline",
  unknown: "help-circle-outline",
};

/**
 * One housekeeper's day, as a near-full-height bottom sheet: attendance (with the recorded clock-in), workload,
 * capacity and every room they own in operational order. The rooms are one virtualized list inside the sheet, so a
 * long assignment scrolls without a nested scroller. It performs no write: tapping a room hands off to the room
 * sheet (which owns the safe, gated actions), and "Assign more rooms" hands off to the room chooser, which feeds the
 * same single-room assignment flow — this sheet has no assignment logic of its own.
 */
export function StaffDetailSheet({
  detail,
  t,
  onClose,
  onOpenRoom,
  onAssignMore,
  assignPaused = false,
  recovery,
  onReassignRemaining,
}: {
  detail: StaffDetailModel;
  t: Translate;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
  /** Starts "choose a room for this person". Omitted when this person cannot be given work from here. */
  onAssignMore?: () => void;
  /** Changes are paused (offline / board not live): the button is shown but disabled, and says why. */
  assignPaused?: boolean;
  /** Midshift recovery for this person: the verified concern, what can move and what stays, and why it may be unavailable. */
  recovery?: RecoveryPanel | null;
  /** Starts "Reassign remaining work". Shown with `recovery`; enabled only when `recovery.enabled`. */
  onReassignRemaining?: () => void;
}) {
  const theme = useTheme();
  const listRef = useRef<FlatList<StaffDetailRoom>>(null);
  const insets = useSafeAreaInsets();
  const phaseColor = (phase: StaffRoomPhase) => (phase === "completed" ? theme.status.ready : phase === "in_progress" ? theme.status.pickup : theme.textSecondary);

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.identity}>
        <Avatar name={detail.unnamed ? "?" : detail.name} size={48} />
        <View style={styles.identityText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.name, { color: theme.textPrimary }]} testID="team-detail-name">
            {detail.name}
          </Text>
          <AttendanceChip badge={detail.attendance} testID="team-detail-attendance" />
          {detail.startedText ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="team-detail-started">
              {detail.startedText}
            </Text>
          ) : null}
          {detail.coverage ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]} testID="team-detail-coverage">
              {detail.coverage}
            </Text>
          ) : null}
        </View>
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
        {t("assignments.v2.team.detail.workloadTitle").toUpperCase()}
      </Text>
      <View style={[styles.rows, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="team-detail-rows">
        {detail.rows.map((row, index) => (
          <View key={row.key} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]} testID={`team-detail-row-${row.key}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textSecondary }]}>
              {row.label}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: row.muted ? theme.textMuted : theme.textPrimary }]} testID={`team-detail-row-${row.key}-value`}>
              {row.value}
            </Text>
          </View>
        ))}
        {detail.capacity && detail.capacity.percent !== null ? (
          <View style={styles.meter}>
            <CapacityMeter capacity={detail.capacity} testID="team-detail-capacity" />
          </View>
        ) : null}
      </View>

      {detail.notes.length > 0 ? (
        <View style={styles.notes} testID="team-detail-notes">
          {detail.notes.map((note) => (
            <NoteLine key={note.key} note={note} testID={`team-detail-note-${note.key}`} />
          ))}
        </View>
      ) : null}

      {recovery && onReassignRemaining ? (
        <View style={styles.recovery} testID="team-detail-recovery">
          {recovery.attention ? (
            <>
              <SectionLabel>{t("assignments.v2.midshift.attentionTitle")}</SectionLabel>
              <Notice icon="alert-circle-outline" testID="team-detail-recovery-attention">
                {recovery.attention}
              </Notice>
            </>
          ) : null}
          {recovery.movable ? <Body strong testID="team-detail-recovery-movable">{recovery.movable}</Body> : null}
          {recovery.staying ? <Body tone="secondary" testID="team-detail-recovery-staying">{recovery.staying}</Body> : null}
          {recovery.held ? <Body tone="secondary" testID="team-detail-recovery-held">{recovery.held}</Body> : null}
          <Button
            label={t("assignments.v2.midshift.action")}
            icon="swap-horizontal-outline"
            variant={recovery.prominent ? "primary" : "secondary"}
            onPress={onReassignRemaining}
            disabled={!recovery.enabled}
            testID="team-detail-reassign-remaining"
            accessibilityLabel={t("assignments.v2.midshift.action")}
          />
          {recovery.disabledReason ? <Body tone="muted" testID="team-detail-reassign-disabled">{recovery.disabledReason}</Body> : <Body tone="muted">{t("assignments.v2.midshift.actionHint")}</Body>}
          {detail.hasRooms ? (
            <Button
              label={t("assignments.v2.midshift.viewRooms")}
              icon="list-outline"
              variant="ghost"
              onPress={() => listRef.current?.scrollToIndex({ index: 0, animated: true })}
              testID="team-detail-view-rooms"
            />
          ) : null}
        </View>
      ) : null}

      {onAssignMore ? (
        <View style={styles.assignMore}>
          <Button label={t("assignments.v2.assign.team.assignMore")} icon="person-add-outline" onPress={onAssignMore} disabled={assignPaused} testID="team-detail-assign-more" />
          {assignPaused ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]} testID="team-detail-assign-paused">
              {t("assignments.v2.state.actionsPaused")}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
        {t("assignments.v2.team.detail.roomsTitle").toUpperCase()}
      </Text>
    </View>
  );

  const renderRoom = ({ item }: { item: StaffDetailRoom }) => (
    <Pressable
      onPress={() => onOpenRoom(item.roomId)}
      accessibilityRole="button"
      accessibilityLabel={item.a11yLabel}
      accessibilityHint={t("assignments.v2.team.detail.roomHint")}
      testID={`team-detail-room-${item.number}`}
      style={({ pressed }) => [styles.room, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
        {item.number}
      </Text>
      <View style={styles.roomBody}>
        <View style={styles.roomStatus}>
          <Ionicons name={PHASE_ICON[item.phase] as never} size={14} color={phaseColor(item.phase)} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomStatusText, { color: phaseColor(item.phase) }]} testID={`team-detail-room-status-${item.number}`}>
            {item.status}
          </Text>
        </View>
        {[item.statusNote, item.estimate, item.credits, item.location].filter(Boolean).length > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomMeta, { color: theme.textMuted }]}>
            {[item.statusNote, item.estimate, item.credits, item.location].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="team-detail-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(12, insets.bottom + 8) }]} accessibilityViewIsModal testID="team-detail-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.bar}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.barTitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {t("assignments.v2.team.detail.title")}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.close} testID="team-detail-close">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.closeText, { color: theme.primaryAction }]}>
                {t("common.close")}
              </Text>
            </Pressable>
          </View>
          <FlatList
            ref={listRef}
            data={detail.rooms}
            keyExtractor={(room) => room.roomId}
            renderItem={renderRoom}
            ListHeaderComponent={header}
            ListEmptyComponent={
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="team-detail-no-rooms">
                {t("assignments.v2.team.detail.noRooms")}
              </Text>
            }
            ItemSeparatorComponent={Separator}
            contentContainerStyle={styles.listContent}
            initialNumToRender={10}
            windowSize={7}
            testID="team-detail-list"
          />
        </View>
      </View>
    </Modal>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { height: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 2 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  barTitle: { flex: 1, fontSize: 13, fontWeight: "800", letterSpacing: 0.4 },
  close: { minHeight: MIN_TARGET, minWidth: 64, alignItems: "flex-end", justifyContent: "center" },
  closeText: { fontSize: 15, fontWeight: "800" },
  listContent: { paddingHorizontal: 16, paddingBottom: 12 },
  headerBlock: { gap: 10, paddingBottom: 6 },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityText: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 22, lineHeight: 27, fontWeight: "800" },
  sub: { fontSize: 13.5, fontWeight: "600" },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 1, marginTop: 8 },
  rows: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 40 },
  rowLabel: { fontSize: 14, fontWeight: "600" },
  rowValue: { flexShrink: 1, fontSize: 14, fontWeight: "800", textAlign: "right" },
  meter: { paddingVertical: 10 },
  notes: { gap: 6 },
  assignMore: { gap: 4 },
  recovery: { gap: 8 },
  room: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 8 },
  roomNumber: { width: 56, fontFamily: monoFont, fontSize: 20, fontWeight: "800" },
  roomBody: { flex: 1, minWidth: 0, gap: 2 },
  roomStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  roomStatusText: { fontSize: 14, fontWeight: "800" },
  roomMeta: { fontSize: 12.5 },
  separator: { height: 8 },
  empty: { fontSize: 14, paddingVertical: 12 },
});
