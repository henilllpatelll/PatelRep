import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetActionRow, SheetFact, SheetGone, SheetNotice, SheetSection } from "@/components/home/sheetParts";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import { describeAttentionRow } from "@/lib/housekeeping/homeText";
import type { IssueDetailsView, IssueKind } from "@/lib/housekeeping/homeSheets";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import { describeAttention, describeRush, formatClock, type TextContext, type Translate } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  view: IssueDetailsView;
  note: HomeModel["supervisorInstruction"];
  t: Translate;
  ctx: TextContext;
  onViewRoom: (roomId: string) => void;
  onAddNote: (roomId: string) => void;
  onViewWorkOrder: (workOrderId: string) => void;
  onClose: () => void;
}

type FactLine = { icon: "time-outline" | "information-circle-outline" | "list-outline" | "build-outline" | "flag-outline"; text: string };

/**
 * One drawer for every condition the person can only read about or hand to the
 * right place: restricted entry, unverified checkout, maintenance, reclean. It
 * never offers Start and has no control that clears a restriction; actions are
 * limited to looking at the room and adding a note through the existing form.
 */
export function IssueDetailsSheet({ visible, view, note, t, ctx, onViewRoom, onAddNote, onViewWorkOrder, onClose }: Props) {
  const theme = useTheme();

  if (view.state === "resolved") {
    return (
      <BottomSheet visible={visible} title={t("home.issue.resolvedTitle")} onClose={onClose} grabber testID="issue-sheet">
        <SheetGone
          title={t("home.issue.resolvedTitle")}
          body={t("home.issue.resolvedBody")}
          closeLabel={t("common.close")}
          onClose={onClose}
          testID="issue-resolved"
        />
      </BottomSheet>
    );
  }

  const { item, kind, entry, restricted, noteAction, canViewRoom } = view;
  const room = entry?.room ?? null;
  const copy = describeAttentionRow({ item, group: "info", entry }, note, t, ctx);
  const facts = factsFor(kind, view, t, ctx);
  const workOrderId = kind === "maintenance" ? (room?.open_work_order_id ?? null) : null;

  return (
    <BottomSheet visible={visible} title={copy.title} onClose={onClose} grabber testID="issue-sheet">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.headline, { color: theme.textPrimary }]} testID="issue-headline">
        {t(`home.issue.kind.${kind}.headline`)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="issue-body">
        {t(`home.issue.kind.${kind}.body`)}
      </Text>

      {facts.length > 0 ? (
        <View style={styles.facts}>
          {facts.map((fact, index) => (
            <SheetFact key={`${index}-${fact.text}`} icon={fact.icon} text={fact.text} testID={`issue-fact-${index}`} />
          ))}
        </View>
      ) : null}

      {restricted ? <SheetNotice tone="warn" text={t("home.issue.waitNotice")} testID="issue-wait-notice" /> : null}

      {canViewRoom || noteAction || workOrderId ? (
        <SheetSection>
          {canViewRoom && entry ? (
            <SheetActionRow
              icon="arrow-forward-circle-outline"
              title={t("home.issue.viewRoom")}
              hint={t("home.issue.viewRoomHint")}
              onPress={() => onViewRoom(entry.room.id)}
              testID="issue-view-room"
            />
          ) : null}
          {workOrderId ? (
            <SheetActionRow
              icon="build-outline"
              title={t("home.issue.viewWorkOrder")}
              onPress={() => onViewWorkOrder(workOrderId)}
              testID="issue-view-work-order"
            />
          ) : null}
          {noteAction && entry ? (
            <SheetActionRow
              kind="form"
              icon="chatbubble-outline"
              title={t("home.issue.addNote")}
              hint={t("home.issue.addNoteHint")}
              disabledReason={noteAction.disabledReason ? t(`rooms.work.more.disabled.${noteAction.disabledReason}`) : null}
              onPress={() => onAddNote(entry.room.id)}
              testID="issue-add-note"
            />
          ) : null}
        </SheetSection>
      ) : null}
    </BottomSheet>
  );
}

function factsFor(kind: IssueKind, view: Extract<IssueDetailsView, { state: "ready" }>, t: Translate, ctx: TextContext): FactLine[] {
  const { entry, item } = view;
  if (!entry) return [];
  const room = entry.room;
  const lines: FactLine[] = [];

  switch (kind) {
    case "checkout": {
      // A scheduled time and the front desk's confirmation are different facts.
      const scheduled = formatClock(room.checkout_time, ctx);
      const confirmed = formatClock(room.actual_checkout_at, ctx);
      if (scheduled) lines.push({ icon: "time-outline", text: t("home.issue.checkoutScheduled", { time: scheduled }) });
      lines.push({
        icon: "information-circle-outline",
        text: confirmed ? t("home.issue.checkoutConfirmed", { time: confirmed }) : t("home.issue.checkoutNotConfirmed"),
      });
      return lines;
    }
    case "reclean": {
      const details = room.reclean_details;
      const inspectedAt = formatClock(details?.inspected_at, ctx);
      if (inspectedAt) lines.push({ icon: "time-outline", text: t("rooms.dash.detail.reclean.inspectedAt", { time: inspectedAt }) });
      const corrections = details?.items ?? [];
      if (corrections.length === 0) {
        lines.push({ icon: "information-circle-outline", text: t("home.issue.correctionsUnavailable") });
      } else {
        for (const correction of corrections) {
          lines.push({ icon: "list-outline", text: correction.note ? `${correction.label}: ${correction.note}` : correction.label });
        }
      }
      if (details?.notes?.trim()) lines.push({ icon: "information-circle-outline", text: `${t("rooms.dash.detail.reclean.inspectorNotes")}: ${details.notes.trim()}` });
      return lines;
    }
    case "rush": {
      const rush = describeRush(entry, t, ctx);
      if (rush?.reason) lines.push({ icon: "flag-outline", text: rush.reason });
      if (rush?.deadline) lines.push({ icon: "time-outline", text: rush.deadline });
      // The supervisor's own words, only when they wrote some.
      if (entry.rush?.note) lines.push({ icon: "information-circle-outline", text: t("home.issue.supervisorNote", { note: entry.rush.note }) });
      return lines;
    }
    case "maintenance":
    case "dnd":
    case "declined":
    case "come_back_later":
    case "guest_inside":
    case "access":
    case "other": {
      // Describe the condition this item is about (a room can carry several).
      const copy = describeAttention({ ...entry, attention: item.code as RoomEntry["attention"] }, t, ctx);
      // The drawer's own explanation already says what the condition means; do not repeat the generic one-liner under it.
      const generic = kind === "maintenance" || kind === "other" ? null : t(`rooms.dash.attention.${item.code}.detail`);
      for (const detail of copy.details.filter((line) => line !== generic)) lines.push({ icon: kind === "maintenance" ? "build-outline" : "information-circle-outline", text: detail });
      return lines;
    }
    default:
      return lines;
  }
}

const styles = StyleSheet.create({
  headline: { fontSize: 18, fontWeight: "800", lineHeight: 24 },
  body: { fontSize: 14, lineHeight: 20 },
  facts: { gap: 8 },
});
