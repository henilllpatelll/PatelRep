import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { SheetHeader } from "@/components/supervisor/assignments/SmartBalanceParts";
import { Button } from "@/components/ui/Button";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { attendanceLabel, minutesText, missingText } from "@/lib/housekeeping/assignmentFlowText";
import { loadView } from "@/lib/housekeeping/assignmentPicker";
import { addableRooms } from "@/lib/housekeeping/smartBalancePlan";
import { explain, type ProposedRow } from "@/lib/housekeeping/smartBalancePreview";
import { explainText, leftOutText, refusalText } from "@/lib/housekeeping/smartBalanceText";
import type { SmartBalanceController } from "@/lib/housekeeping/useSmartBalance";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Rooms offered in "Add another room" before the rest are summarised. */
const ADDABLE_SHOWN = 40;

/* ─── One person's part of the plan ─────────────────────────────────────────
   Existing work is listed but never editable here: what is finished, being cleaned or staying with its owner is
   "Protected" / "Retained". Only the newly proposed rooms can be moved, taken out or (for a room that came from
   another person) restored. Every tap changes the LOCAL proposal and the numbers update at once; nothing is sent. */

export function SmartBalanceDetailStep({ smart, model, nameOf, toast, t }: { smart: SmartBalanceController; model: AssignmentsModel; nameOf: (userId: string) => string; toast: (message: string) => void; t: Translate }) {
  const theme = useTheme();
  const { detail, plan, picker } = smart;
  if (!detail || !plan) return null;
  const name = detail.name ?? t("assignments.v2.smart.detail.unnamed");
  const attempt = (refusal: ReturnType<SmartBalanceController["move"]>) => {
    if (refusal) toast(refusalText(refusal, t));
  };

  if (picker?.kind === "move") {
    const row = detail.proposed.find((item) => item.roomId === picker.roomId);
    const choices = (model.team ?? []).filter((member) => plan.receiverIds.includes(member.userId) && member.userId !== detail.userId);
    return (
      <>
        <SheetHeader title={t("assignments.v2.smart.detail.picker.moveTitle", { room: row?.roomNumber ?? "" })} onBack={smart.back} backLabel={t("assignments.v2.smart.detail.picker.cancel")} testID="smart-move" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="smart-move-scroll">
          {choices.length === 0 ? <Notice testID="smart-move-none">{t("assignments.v2.smart.detail.picker.none")}</Notice> : null}
          {choices.map((member) => {
            const memberName = member.name ?? t("assignments.v2.smart.detail.unnamed");
            const remaining = minutesText(loadView(member.load).minutes, t);
            return (
              <Pressable
                key={member.userId}
                onPress={() => attempt(smart.move(picker.roomId, member.userId))}
                accessibilityRole="button"
                accessibilityLabel={`${memberName}. ${attendanceLabel(member.attendance, t)}. ${remaining}`}
                style={({ pressed }) => [styles.person, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && { opacity: 0.85 }]}
                testID={`smart-move-to-${member.userId}`}
              >
                <Body strong>{memberName}</Body>
                <Body tone="secondary">
                  {attendanceLabel(member.attendance, t)} · {remaining}
                </Body>
              </Pressable>
            );
          })}
        </ScrollView>
      </>
    );
  }

  if (picker?.kind === "add") {
    const rooms = addableRooms(model, plan);
    const shown = rooms.slice(0, ADDABLE_SHOWN);
    return (
      <>
        <SheetHeader title={t("assignments.v2.smart.detail.picker.addTitle", { name })} onBack={smart.back} backLabel={t("assignments.v2.smart.detail.picker.cancel")} testID="smart-add" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="smart-add-scroll">
          {rooms.length === 0 ? <Notice testID="smart-add-none">{t("assignments.v2.smart.detail.picker.noRooms")}</Notice> : null}
          {shown.map((entry) => (
            <Pressable
              key={entry.room.roomId}
              onPress={() => attempt(smart.add(entry.room.roomId, detail.userId))}
              accessibilityRole="button"
              accessibilityLabel={`${entry.room.roomNumber}. ${entry.estimate ? t("assignments.v2.assign.picker.estimate", { minutes: entry.estimate.minutes }) : t("assignments.v2.assign.picker.noEstimate")}`}
              style={({ pressed }) => [styles.person, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && { opacity: 0.85 }]}
              testID={`smart-add-room-${entry.room.roomNumber}`}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.number, { color: theme.textPrimary }]}>
                {entry.room.roomNumber}
              </Text>
              <Body tone="secondary">
                {[plan.leftOut[entry.room.roomId] ? leftOutText(plan.leftOut[entry.room.roomId].reason, t) : null, entry.estimate ? t("assignments.v2.assign.picker.estimate", { minutes: entry.estimate.minutes }) : t("assignments.v2.assign.picker.noEstimate")].filter(Boolean).join(" · ")}
              </Body>
            </Pressable>
          ))}
          {rooms.length > shown.length ? <Body tone="muted">{t("assignments.v2.bulk.edit.moreRooms", { count: rooms.length - shown.length })}</Body> : null}
        </ScrollView>
      </>
    );
  }

  const after = detail.after;
  const incomplete = after ? missingText(after.minutes, t) : null;
  return (
    <>
      <SheetHeader title={name} onBack={smart.back} backLabel={t("assignments.v2.smart.preview.back")} testID="smart-detail" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="smart-detail-scroll">
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Body tone="secondary">{attendanceLabel(detail.attendance, t)}</Body>
          {after ? (
            <Body strong testID="smart-detail-remaining">
              {t("assignments.v2.smart.detail.proposedRemaining", { value: minutesText(after.minutes, t) })}
            </Body>
          ) : null}
          {incomplete ? <Body tone="muted">{incomplete}</Body> : null}
          {after ? <WarningLines warnings={after.warnings} t={t} testIDPrefix="smart-detail-warning" /> : null}
        </View>

        <SectionLabel>{t("assignments.v2.smart.detail.existing")}</SectionLabel>
        {detail.existing.length === 0 ? <Body tone="muted">{t("assignments.v2.smart.detail.noneExisting")}</Body> : null}
        {detail.existing.map((row) => (
          <View key={row.roomId} style={[styles.existing, { borderColor: theme.border }]} testID={`smart-existing-${row.roomNumber}`}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.number, { color: theme.textPrimary }]}>
              {row.roomNumber}
            </Text>
            <Body tone="secondary" style={styles.grow}>
              {t(`assignments.v2.smart.detail.stage.${row.stage}`)}
            </Body>
            <Body strong tone={row.status === "moving_out" ? "alert" : "secondary"}>
              {t(`assignments.v2.smart.detail.status.${row.status}`, { name: row.movingToUserId ? nameOf(row.movingToUserId) : "" })}
            </Body>
          </View>
        ))}

        <SectionLabel>{t("assignments.v2.smart.detail.proposed")}</SectionLabel>
        {detail.proposed.length === 0 ? <Body tone="muted">{t("assignments.v2.smart.detail.noneProposed")}</Body> : null}
        {detail.proposed.map((row) => (
          <ProposedCard key={row.roomId} row={row} nameOf={nameOf} smart={smart} t={t} />
        ))}

        {detail.canAddMore ? <Button label={t("assignments.v2.smart.detail.actions.addAnother")} variant="secondary" icon="add-circle-outline" onPress={() => smart.openPicker({ kind: "add" })} testID="smart-add-another" /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t("assignments.v2.smart.detail.actions.done")} onPress={smart.back} testID="smart-detail-done" />
      </View>
    </>
  );
}

function ProposedCard({ row, nameOf, smart, t }: { row: ProposedRow; nameOf: (userId: string) => string; smart: SmartBalanceController; t: Translate }) {
  const theme = useTheme();
  const why = explainText(explain(row, nameOf), t);
  const restoring = row.kind === "moved" && row.fromUserId !== null;
  return (
    <View style={[styles.room, { backgroundColor: theme.surface, borderColor: row.origin === "edited" ? theme.primaryAction : theme.border }]} testID={`smart-proposed-${row.roomNumber}`}>
      <View style={styles.roomTop}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.number, { color: theme.textPrimary }]}>
          {row.roomNumber}
        </Text>
        <Body tone="secondary" style={styles.grow}>
          {row.kind === "moved" && row.fromUserId ? t("assignments.v2.smart.detail.kind.moved", { name: nameOf(row.fromUserId) }) : t("assignments.v2.smart.detail.kind.new")}
        </Body>
        <Body strong tone={row.origin === "edited" ? "primary" : "muted"} testID={`smart-origin-${row.roomNumber}`}>
          {t(`assignments.v2.smart.detail.origin.${row.origin}`)}
        </Body>
      </View>
      {row.estimateMissing ? <Body tone="muted">{t("assignments.v2.smart.detail.noEstimate")}</Body> : null}
      {why.map((line) => (
        <Body key={line} tone="secondary">
          {t("assignments.v2.smart.detail.why")}: {line}
        </Body>
      ))}
      <View style={styles.actions}>
        <Pressable
          onPress={() => smart.remove(row.roomId)}
          accessibilityRole="button"
          accessibilityLabel={restoring ? t("assignments.v2.smart.detail.actions.restoreLabel", { room: row.roomNumber }) : t("assignments.v2.smart.detail.actions.removeLabel", { room: row.roomNumber })}
          style={styles.action}
          testID={`smart-remove-${row.roomNumber}`}
        >
          <Body tone="alert" strong>
            {restoring && row.fromUserId ? t("assignments.v2.smart.detail.actions.restore", { name: nameOf(row.fromUserId) }) : t("assignments.v2.smart.detail.actions.remove")}
          </Body>
        </Pressable>
        <Pressable onPress={() => smart.openPicker({ kind: "move", roomId: row.roomId })} accessibilityRole="button" accessibilityLabel={t("assignments.v2.smart.detail.actions.moveLabel", { room: row.roomNumber })} style={styles.action} testID={`smart-move-${row.roomNumber}`}>
          <Body strong style={{ color: theme.primaryAction }}>
            {t("assignments.v2.smart.detail.actions.move")}
          </Body>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 10, paddingBottom: 12 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  existing: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, borderBottomWidth: StyleSheet.hairlineWidth },
  room: { borderWidth: 1.5, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  roomTop: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  number: { fontFamily: monoFont, fontSize: 21, fontWeight: "800" },
  grow: { flex: 1 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  action: { minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 10 },
  person: { minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: R.md, gap: 2 },
  footer: { paddingTop: 8 },
});
