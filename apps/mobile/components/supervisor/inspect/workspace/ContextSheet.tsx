import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import { fetchCleanSessions, fetchRoomHistory, fetchRoomInspections, fetchRoomWorkOrders, ROOM_WORK_ORDER_FETCH_LIMIT } from "@/lib/api/roomPanels";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { HistoryContext } from "@/lib/housekeeping/roomCleaningHistory";
import { inspectionWindow } from "@/lib/housekeeping/roomInspectionHistory";
import { useRoomResource, type Resource } from "@/lib/housekeeping/useRoomResource";
import type { QueueItem } from "@/lib/inspections/queue";
import { cleanKindOf } from "@/lib/inspections/queueView";
import { latestInspection, matchingCleanSession, openWorkOrders, recentNotes } from "@/lib/inspections/roomContext";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Room context — a read-only drawer ─────────────────────────────────────
   Opened from More. Everything is read through the Room Board's existing endpoints, and only when the drawer opens
   (the body below mounts with the sheet and unmounts with it, so each opening reads fresh). Each section has its own
   loading / failed / ready state: a failed read says it failed and offers a retry — it never reads as "nothing
   recorded". There is nothing to edit here. */

const HISTORY_WINDOW_DAYS = 90;

export function ContextSheet({
  visible,
  item,
  scopeKey,
  timeZone,
  language,
  now,
  t,
  onClose,
  onViewRoom,
}: {
  visible: boolean;
  item: QueueItem;
  /** `hotel:user` — part of every read's key, so an answer for another account can never be painted here. */
  scopeKey: string;
  timeZone: string | null | undefined;
  language: string;
  now: number;
  t: Translate;
  onClose: () => void;
  onViewRoom: (roomId: string) => void;
}) {
  return (
    <WorkspaceSheet visible={visible} title={t("inspect.workspace.context.title", { room: item.roomNumber })} onClose={onClose} onBackdrop={onClose} testID="workspace-context" t={t}>
      <ContextBody item={item} scopeKey={scopeKey} timeZone={timeZone} language={language} now={now} t={t} onViewRoom={onViewRoom} />
    </WorkspaceSheet>
  );
}

function ContextBody({
  item,
  scopeKey,
  timeZone,
  language,
  now,
  t,
  onViewRoom,
}: {
  item: QueueItem;
  scopeKey: string;
  timeZone: string | null | undefined;
  language: string;
  now: number;
  t: Translate;
  onViewRoom: (roomId: string) => void;
}) {
  const theme = useTheme();
  const base = `${scopeKey}:${item.roomId}`;
  const history = useMemo<HistoryContext>(() => ({ now, timeZone, language, t, nameOf: () => null }), [now, timeZone, language, t]);
  const range = useMemo(() => inspectionWindow(HISTORY_WINDOW_DAYS, now, timeZone), [now, timeZone]);

  const sessions = useRoomResource(`${base}:sessions`, () => fetchCleanSessions(item.roomId));
  const notes = useRoomResource(`${base}:notes`, () => fetchRoomHistory(item.roomId));
  const orders = useRoomResource(`${base}:orders`, () => fetchRoomWorkOrders(item.roomId));
  const previous = useRoomResource(`${base}:previous`, () => fetchRoomInspections(item.roomId, range.from, range.to));

  const kind = cleanKindOf(item.cleanType);
  const cleanedAt = item.cleanedAtMs !== null ? formatHotelTime(new Date(item.cleanedAtMs), timeZone, language) : null;
  const na = t("inspect.workspace.context.notAvailable");

  return (
    <View style={styles.body} testID="workspace-context-body">
      <Block title={t("inspect.workspace.context.roomInfo")} testID="context-room">
        <Row label={t("inspect.workspace.context.roomType")} value={item.roomTypeName ?? na} muted={!item.roomTypeName} />
        <Row label={t("inspect.workspace.context.location")} value={[item.building ? t("inspect.workspace.building", { building: item.building }) : null, item.floor !== null ? t("inspect.workspace.floor", { floor: item.floor }) : null].filter(Boolean).join(" · ") || na} muted={item.floor === null && !item.building} />
        <Row label={t("inspect.workspace.context.cleanType")} value={kind ? t(`inspect.card.clean.${kind}`) : na} muted={!kind} />
        <Row label={t("inspect.workspace.context.status")} value={t("inspect.workspace.context.statusValue")} />
      </Block>

      <Block title={t("inspect.workspace.context.cleaning")} testID="context-cleaning">
        <Row label={t("inspect.workspace.context.cleaner")} value={item.cleanedBy.trim() || t("inspect.workspace.context.notRecorded")} muted={!item.cleanedBy.trim()} />
        <Row label={t("inspect.workspace.context.completed")} value={cleanedAt ?? na} muted={!cleanedAt} />
        <Load state={sessions.state} reload={sessions.reload} t={t} testID="context-cleaning-load">
          {(rows) => {
            const facts = matchingCleanSession(rows, item.cleanedAtMs);
            if (!facts) return <Plain text={t("inspect.workspace.context.noSession")} />;
            return (
              <>
                {facts.minutes !== null ? <Row label={t("inspect.workspace.context.duration")} value={t("inspect.workspace.context.minutes", { count: facts.minutes })} /> : null}
                {facts.checklistDone !== null && facts.checklistTotal !== null ? (
                  <Row label={t("inspect.workspace.context.cleanChecklist")} value={t("inspect.workspace.context.cleanChecklistValue", { done: facts.checklistDone, total: facts.checklistTotal })} />
                ) : null}
              </>
            );
          }}
        </Load>
      </Block>

      <Block title={t("inspect.workspace.context.notes")} testID="context-notes">
        <Load state={notes.state} reload={notes.reload} t={t} testID="context-notes-load">
          {(rows) => {
            const { notes: list, more } = recentNotes(rows, history);
            if (list.length === 0) return <Plain text={t("inspect.workspace.context.noNotes")} />;
            return (
              <>
                {list.map((note) => (
                  <View key={note.key} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]} testID={`context-note-${note.key}`}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
                      {note.text}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardSub, { color: theme.textMuted }]}>
                      {[note.author ?? t("inspect.workspace.context.notRecorded"), note.at].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                ))}
                {more > 0 ? <Plain text={t("inspect.workspace.context.moreNotes", { count: more })} /> : null}
              </>
            );
          }}
        </Load>
      </Block>

      <Block title={t("inspect.workspace.context.orders")} testID="context-orders">
        <Load state={orders.state} reload={orders.reload} t={t} testID="context-orders-load">
          {(rows) => {
            const { orders: list, total, mayBeMore } = openWorkOrders(rows, ROOM_WORK_ORDER_FETCH_LIMIT);
            if (list.length === 0) return <Plain text={mayBeMore ? t("inspect.workspace.context.noOrdersMaybe") : t("inspect.workspace.context.noOrders")} />;
            return (
              <>
                {list.map((order) => (
                  <View key={order.id} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]} testID={`context-order-${order.id}`}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
                      {order.title}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardSub, { color: theme.textMuted }]}>
                      {[
                        order.number ? t("inspect.workspace.context.orderNumber", { number: order.number }) : null,
                        t(`inspect.workspace.context.orderStatus.${order.status}`),
                        t(`roomBoard.detail.workOrder.priority.${order.priority}`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                ))}
                {total > list.length ? <Plain text={t("inspect.workspace.context.moreOrders", { count: total - list.length })} /> : null}
              </>
            );
          }}
        </Load>
      </Block>

      <Block title={t("inspect.workspace.context.previous")} testID="context-previous">
        <Load state={previous.state} reload={previous.reload} t={t} testID="context-previous-load">
          {(rows) => {
            const last = latestInspection(rows, history);
            if (!last) return <Plain text={t("inspect.workspace.context.noPrevious", { days: HISTORY_WINDOW_DAYS })} />;
            return (
              <>
                <Row label={t("inspect.workspace.context.previousResult")} value={last.resultLabel} />
                {last.at ? <Row label={t("inspect.workspace.context.previousWhen")} value={last.at} /> : null}
                {last.inspector ? <Row label={t("inspect.workspace.context.previousBy")} value={last.inspector} /> : null}
                {last.note ? <Plain text={last.note} /> : null}
                <Button label={t("inspect.workspace.context.viewRoom")} variant="secondary" size="sm" icon="open-outline" onPress={() => onViewRoom(item.roomId)} testID="context-view-room" />
              </>
            );
          }}
        </Load>
      </Block>
    </View>
  );
}

function Block({ title, testID, children }: { title: string; testID: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.block} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.blockTitle, { color: theme.textMuted }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: muted ? theme.textMuted : theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function Plain({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.plain, { color: theme.textSecondary }]}>
      {text}
    </Text>
  );
}

/** loading → spinner; failed → says so with Retry; ready → the content. A failed read is never drawn as empty. */
function Load<T>({
  state,
  reload,
  t,
  testID,
  children,
}: {
  state: Resource<T>;
  reload: () => void;
  t: Translate;
  testID: string;
  children: (data: T) => ReactNode;
}) {
  const theme = useTheme();
  if (state.status === "loading") {
    return (
      <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={t("inspect.workspace.context.loading")} testID={`${testID}-loading`}>
        <ActivityIndicator color={theme.primaryAction} />
      </View>
    );
  }
  if (state.status === "error") {
    const key = state.error === "network" ? "network" : state.error === "unauthorized" ? "unauthorized" : "server";
    return (
      <View style={[styles.card, { borderColor: theme.status.dirtyLine, backgroundColor: theme.status.dirtySoft }]} accessibilityRole="alert" testID={`${testID}-error`}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
          {t(`inspect.workspace.context.error.${key}`)}
        </Text>
        <Button label={t("common.retry")} variant="secondary" size="sm" onPress={reload} testID={`${testID}-retry`} />
      </View>
    );
  }
  return <>{children(state.data)}</>;
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  block: { gap: 8 },
  blockTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { flexShrink: 0, maxWidth: "45%", fontSize: 14, lineHeight: 20, fontWeight: "600" },
  rowValue: { flex: 1, textAlign: "right", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  plain: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  cardTitle: { fontSize: 14.5, lineHeight: 20, fontWeight: "700" },
  cardSub: { fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
  loading: { minHeight: 36, alignItems: "flex-start", justifyContent: "center" },
});
