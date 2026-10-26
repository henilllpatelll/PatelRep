import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { ValueLine, WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import { minutesText, missingText } from "@/lib/housekeeping/assignmentFlowText";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Rooms offered in "Add another room" before the rest are summarised: keeps the sheet light on a big hotel. */
const ADDABLE_SHOWN = 40;

/* ─── Edit one person's allocation ──────────────────────────────────────────
   Works on the DRAFT only: every tap changes a proposed change and the projected workload below updates at once.
   Nothing here touches a live assignment; "Save draft edits" just returns to the review. */

export function BulkEditStep({ bulk, t }: { bulk: BulkAssignmentController; t: Translate }) {
  const theme = useTheme();
  const userId = bulk.editUserId;
  const employee = bulk.draft.review?.employees.find((candidate) => candidate.userId === userId);
  const [moving, setMoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!userId) return null;
  const name = employee?.name ?? bulk.nameOf(userId) ?? t("assignments.v2.assign.unnamed");
  const rooms = employee?.added ?? [];
  const others = bulk.staff.filter((person) => person.userId !== userId);
  const missing = employee ? missingText(employee.proposed.minutes, t) : null;
  const shown = bulk.addableRooms.slice(0, ADDABLE_SHOWN);

  return (
    <>
      <View style={styles.header}>
        <Pressable onPress={bulk.backToReview} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.review.back")} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID="bulk-edit-back">
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="bulk-edit-title">
          {t("assignments.v2.bulk.edit.title", { name })}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="bulk-edit-scroll">
        {employee ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ValueLine label={t("assignments.v2.bulk.review.currentRemaining")} value={minutesText(employee.current.minutes, t)} />
            <ValueLine label={t("assignments.v2.bulk.edit.projected")} value={minutesText(employee.proposed.minutes, t)} strong testID="bulk-edit-projected" />
            {missing ? <Body tone="muted">{missing}</Body> : null}
            <WarningLines warnings={employee.proposed.warnings} t={t} testIDPrefix="bulk-edit-warning" />
          </View>
        ) : null}

        <SectionLabel>{t("assignments.v2.bulk.edit.proposedRooms")}</SectionLabel>
        {rooms.length === 0 ? <Notice testID="bulk-edit-empty">{t("assignments.v2.bulk.edit.noRooms")}</Notice> : null}
        {rooms.map((item) => (
          <View key={item.roomId} style={[styles.room, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`bulk-edit-room-${item.roomNumber}`}>
            <View style={styles.roomTop}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.number, { color: theme.textPrimary }]}>
                {item.roomNumber}
              </Text>
              <Body tone="secondary" style={styles.roomMeta}>
                {[item.cleanTypeLabel, item.estimateMinutes !== null ? t("assignments.v2.assign.picker.estimate", { minutes: item.estimateMinutes }) : t("assignments.v2.assign.picker.noEstimate")].filter(Boolean).join(" · ")}
              </Body>
            </View>
            <View style={styles.actions}>
              <Pressable onPress={() => bulk.removeRoom(item.roomId)} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.review.removeRoom", { room: item.roomNumber })} style={styles.action} testID={`bulk-edit-remove-${item.roomNumber}`}>
                <Body tone="alert" strong>
                  {t("assignments.v2.bulk.edit.remove")}
                </Body>
              </Pressable>
              <Pressable onPress={() => setMoving(moving === item.roomId ? null : item.roomId)} accessibilityRole="button" accessibilityState={{ expanded: moving === item.roomId }} accessibilityLabel={t("assignments.v2.bulk.edit.moveRoom", { room: item.roomNumber })} style={styles.action} testID={`bulk-edit-move-${item.roomNumber}`}>
                <Body strong style={{ color: theme.primaryAction }}>
                  {t("assignments.v2.bulk.edit.move")}
                </Body>
              </Pressable>
            </View>
            {moving === item.roomId ? (
              <View style={styles.pick} testID={`bulk-edit-move-list-${item.roomNumber}`}>
                {others.length === 0 ? <Body tone="muted">{t("assignments.v2.bulk.allocate.noStaff")}</Body> : null}
                {others.map((person) => (
                  <Pressable
                    key={person.userId}
                    onPress={() => {
                      bulk.moveRoom(item.roomId, person.userId);
                      setMoving(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("assignments.v2.bulk.edit.moveTo", { room: item.roomNumber, name: person.name ?? t("assignments.v2.assign.unnamed") })}
                    style={[styles.person, { borderColor: theme.border }]}
                    testID={`bulk-edit-move-to-${person.userId}`}
                  >
                    <Body strong>{person.name ?? t("assignments.v2.assign.unnamed")}</Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <Button label={t("assignments.v2.bulk.edit.addRoom")} variant="secondary" icon="add-circle-outline" onPress={() => setAdding(!adding)} testID="bulk-edit-add" />
        {adding ? (
          <View style={styles.pick} testID="bulk-edit-addable">
            {shown.length === 0 ? <Body tone="muted">{t("assignments.v2.bulk.edit.nothingToAdd")}</Body> : null}
            {shown.map((room) => (
              <Pressable
                key={room.roomId}
                onPress={() => bulk.addRoomTo(userId, room.roomId)}
                accessibilityRole="button"
                accessibilityLabel={t("assignments.v2.bulk.edit.addTo", { room: room.roomNumber, name })}
                style={[styles.person, { borderColor: theme.border }]}
                testID={`bulk-edit-add-${room.roomNumber}`}
              >
                <Body strong>{room.roomNumber}</Body>
                <Body tone="secondary">
                  {[room.cleanTypeLabel, room.estimateMinutes !== null ? t("assignments.v2.assign.picker.estimate", { minutes: room.estimateMinutes }) : t("assignments.v2.assign.picker.noEstimate")].filter(Boolean).join(" · ")}
                </Body>
              </Pressable>
            ))}
            {bulk.addableRooms.length > shown.length ? <Body tone="muted">{t("assignments.v2.bulk.edit.moreRooms", { count: bulk.addableRooms.length - shown.length })}</Body> : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={t("assignments.v2.bulk.edit.save")} icon="checkmark-outline" onPress={bulk.backToReview} testID="bulk-edit-save" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 12, paddingBottom: 12 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10 },
  room: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 8 },
  roomTop: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  number: { fontFamily: monoFont, fontSize: 22, fontWeight: "800" },
  roomMeta: { flex: 1 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  action: { minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 10 },
  pick: { gap: 6 },
  person: { minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderRadius: R.md },
  footer: { paddingTop: 8 },
});
