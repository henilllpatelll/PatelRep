import { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { EmptyBlock, ErrorBlock, InfoCard, LoadingBlock, Pill, SegmentTabs } from "@/components/supervisor/panels/PanelParts";
import {
  fetchCleanSessionDetail,
  fetchCleanSessions,
  fetchRoomHistory,
  fetchRoomInspections,
  fetchWorkOrderDetail,
} from "@/lib/api/roomPanels";
import {
  buildActivity,
  buildCleaningHistory,
  buildSessionDetail,
  HISTORY_PAGE_SIZE,
  type HistoryContext,
  type SessionDetail,
} from "@/lib/housekeeping/roomCleaningHistory";
import {
  buildInspectionHistory,
  DEFAULT_INSPECTION_RANGE,
  INSPECTION_RANGES,
  inspectionWindow,
  type InspectionRangeDays,
} from "@/lib/housekeeping/roomInspectionHistory";
import { buildWorkOrderDetail } from "@/lib/housekeeping/roomWorkOrderDetail";
import { useRoomResource } from "@/lib/housekeeping/useRoomResource";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: muted ? theme.textMuted : theme.textPrimary }]}>{value}</Text>
    </View>
  );
}

/* ─── Cleaning history + activity ───────────────────────────────────────────
   Cleans come from clean sessions; Activity from the room's status history (status changes and notes). Activity
   is read only when its tab is opened. One bounded fetch (the server's 50) revealed ten at a time. */

export type HistoryTab = "cleans" | "activity";

export function CleaningHistoryPanel({
  roomId,
  ctx,
  tab,
  onTab,
  onOpenSession,
  t,
}: {
  roomId: string;
  ctx: HistoryContext;
  tab: HistoryTab;
  onTab: (tab: HistoryTab) => void;
  onOpenSession: (sessionId: string) => void;
  t: Translate;
}) {
  const theme = useTheme();
  const [visible, setVisible] = useState(HISTORY_PAGE_SIZE);
  const sessions = useRoomResource(tab === "cleans" ? `sessions:${roomId}` : null, () => fetchCleanSessions(roomId));
  const activity = useRoomResource(tab === "activity" ? `activity:${roomId}` : null, () => fetchRoomHistory(roomId));
  const tabs = [
    { key: "cleans" as const, label: t("roomBoard.panel.cleaning.tabCleans") },
    { key: "activity" as const, label: t("roomBoard.panel.cleaning.tabActivity") },
  ];

  const history = useMemo(() => (sessions.state.status === "ready" ? buildCleaningHistory(sessions.state.data, ctx, visible) : null), [sessions.state, ctx, visible]);
  const entries = useMemo(() => (activity.state.status === "ready" ? buildActivity(activity.state.data, ctx) : null), [activity.state, ctx]);

  return (
    <View style={styles.stack} testID="room-cleaning-panel">
      <SegmentTabs tabs={tabs} selected={tab} onSelect={onTab} />
      {tab === "cleans" ? (
        sessions.state.status === "loading" ? (
          <LoadingBlock label={t("roomBoard.panel.loading")} />
        ) : sessions.state.status === "error" ? (
          <ErrorBlock error={sessions.state.error} onRetry={sessions.reload} t={t} />
        ) : history && history.total === 0 ? (
          <EmptyBlock title={t("roomBoard.panel.cleaning.emptyTitle")} body={t("roomBoard.panel.cleaning.emptyBody")} />
        ) : history ? (
          <>
            {history.groups.map((group) => (
              <View key={group.dayKey} style={styles.group}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{group.label}</Text>
                {group.rows.map((row) => (
                  <View key={row.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`clean-session-${row.id}`}>
                    <View style={styles.cardTop}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>{row.typeLabel ?? t("roomBoard.panel.cleaning.typeUnknown")}</Text>
                      {row.state !== "completed" ? (
                        <Pill label={row.stateLabel} color={theme.status.pickup} bg={theme.status.pickupSoft} line={theme.status.pickupLine} />
                      ) : null}
                    </View>
                    {row.timeLine ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>{row.timeLine}</Text> : null}
                    {row.state === "completed" ? (
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: row.duration ? theme.textSecondary : theme.textMuted }]} testID={`clean-session-duration-${row.id}`}>
                        {row.duration ? t("roomBoard.panel.cleaning.duration", { duration: row.duration }) : t("roomBoard.panel.cleaning.durationMissing")}
                      </Text>
                    ) : null}
                    {row.checklist ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>{t("roomBoard.panel.cleaning.checklist", { count: row.checklist })}</Text> : null}
                    {row.housekeeper ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>{row.housekeeper}</Text> : null}
                    {row.note ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]}>{row.note}</Text> : null}
                    <Button label={t("roomBoard.panel.cleaning.viewDetails")} variant="ghost" size="sm" onPress={() => onOpenSession(row.id)} testID={`clean-session-open-${row.id}`} />
                  </View>
                ))}
              </View>
            ))}
            {history.shown < history.total ? (
              <Button label={t("roomBoard.panel.cleaning.loadMore")} variant="secondary" size="sm" onPress={() => setVisible((n) => n + HISTORY_PAGE_SIZE)} testID="clean-history-more" />
            ) : (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="clean-history-end">
                {t("roomBoard.panel.cleaning.recentOnly", { count: history.total })}
              </Text>
            )}
          </>
        ) : null
      ) : activity.state.status === "loading" ? (
        <LoadingBlock label={t("roomBoard.panel.loading")} />
      ) : activity.state.status === "error" ? (
        <ErrorBlock error={activity.state.error} onRetry={activity.reload} t={t} />
      ) : entries && entries.length === 0 ? (
        <EmptyBlock title={t("roomBoard.panel.activity.emptyTitle")} body={t("roomBoard.panel.activity.emptyBody")} />
      ) : entries ? (
        <>
          {entries.map((entry) => (
            <View key={entry.key} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`activity-${entry.kind}`}>
              <View style={styles.cardTop}>
                <Pill
                  label={t(`roomBoard.panel.activity.kind.${entry.kind}`)}
                  color={entry.kind === "note" ? theme.status.pickup : theme.textSecondary}
                  bg={entry.kind === "note" ? theme.status.pickupSoft : theme.surfaceSubtle}
                  line={entry.kind === "note" ? theme.status.pickupLine : theme.borderSubtle}
                />
                {entry.at ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>{entry.at}</Text> : null}
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]}>{entry.text}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>{entry.actor ?? t("roomBoard.panel.activity.actorUnknown")}</Text>
            </View>
          ))}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>{t("roomBoard.panel.activity.scope")}</Text>
        </>
      ) : null}
    </View>
  );
}

/* ─── One clean session ───────────────────────────────────────────────────── */

function PhotoTile({ url, label, onOpen, onFail, failed, t }: { url: string | null; label: string; onOpen: () => void; onFail: () => void; failed: boolean; t: Translate }) {
  const theme = useTheme();
  const missing = url === null || failed;
  return (
    <Pressable
      onPress={missing ? undefined : onOpen}
      accessibilityRole={missing ? "text" : "imagebutton"}
      accessibilityLabel={missing ? t("roomBoard.panel.session.photoUnavailable") : label}
      style={[styles.photo, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
      testID="clean-photo"
    >
      {missing ? (
        <Ionicons name="image-outline" size={22} color={theme.textMuted} />
      ) : (
        <Image source={{ uri: url }} style={styles.photoImage} onError={onFail} accessible={false} resizeMode="cover" />
      )}
    </Pressable>
  );
}

export function SessionPanel({ sessionId, ctx, t }: { sessionId: string; ctx: HistoryContext; t: Translate }) {
  const theme = useTheme();
  const res = useRoomResource(`session:${sessionId}`, () => fetchCleanSessionDetail(sessionId));
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const detail: SessionDetail | null = useMemo(() => (res.state.status === "ready" ? buildSessionDetail(res.state.data, ctx) : null), [res.state, ctx]);
  if (res.state.status === "loading") return <LoadingBlock label={t("roomBoard.panel.loading")} />;
  if (res.state.status === "error") return <ErrorBlock error={res.state.error} onRetry={res.reload} t={t} />;
  if (!detail) return null;
  const expired = detail.photos.some((photo) => photo.url !== null && failed[photo.id]);
  const open = detail.photos.find((photo) => photo.id === viewing) ?? null;

  if (open && open.url && !failed[open.id]) {
    return (
      <View style={styles.stack} testID="clean-photo-viewer">
        <Image
          source={{ uri: open.url }}
          style={styles.viewer}
          resizeMode="contain"
          onError={() => setFailed((current) => ({ ...current, [open.id]: true }))}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t("roomBoard.panel.session.photoLabel", { time: open.takenAt ?? t("roomBoard.panel.cleaning.dateUnknown") })}
        />
        <Button label={t("common.close")} variant="secondary" onPress={() => setViewing(null)} testID="clean-photo-close" />
      </View>
    );
  }

  return (
    <View style={styles.stack} testID="clean-session-panel">
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.cardTop}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>{detail.row.typeLabel ?? t("roomBoard.panel.cleaning.typeUnknown")}</Text>
          <Pill label={detail.row.stateLabel} color={detail.row.state === "completed" ? theme.status.ready : theme.status.pickup} bg={detail.row.state === "completed" ? theme.status.readySoft : theme.status.pickupSoft} line={detail.row.state === "completed" ? theme.status.readyLine : theme.status.pickupLine} />
        </View>
        {detail.facts.map((fact) => (
          <Row key={fact.key} label={fact.label} value={fact.value} muted={fact.value === t("roomBoard.panel.cleaning.notRecorded")} />
        ))}
        {detail.row.checklist ? <Row label={t("roomBoard.detail.cleaning.checklist")} value={detail.row.checklist} /> : null}
        {detail.row.note ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]}>{detail.row.note}</Text> : null}
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{t("roomBoard.panel.session.checklist")}</Text>
      {detail.checklist.length === 0 ? (
        <EmptyBlock title={t("roomBoard.panel.session.noChecklist")} />
      ) : (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="clean-session-checklist">
          {detail.checklist.map((item) => (
            <View key={item.key} style={styles.checkRow}>
              <Ionicons name={item.checked ? "checkbox-outline" : "square-outline"} size={18} color={item.checked ? theme.status.ready : theme.textMuted} />
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                accessibilityLabel={`${item.label}, ${t(item.checked ? "roomBoard.panel.session.done" : "roomBoard.panel.session.notDone")}`}
                style={[styles.meta, { flex: 1, color: item.checked ? theme.textPrimary : theme.textSecondary }]}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{t("roomBoard.panel.session.photos")}</Text>
      {detail.photos.length === 0 ? (
        <EmptyBlock title={t("roomBoard.panel.session.noPhotos")} />
      ) : (
        <View style={styles.photoGrid}>
          {detail.photos.map((photo) => (
            <PhotoTile
              key={photo.id}
              url={photo.url}
              failed={!!failed[photo.id]}
              label={t("roomBoard.panel.session.photoLabel", { time: photo.takenAt ?? t("roomBoard.panel.cleaning.dateUnknown") })}
              onOpen={() => setViewing(photo.id)}
              onFail={() => setFailed((current) => ({ ...current, [photo.id]: true }))}
              t={t}
            />
          ))}
        </View>
      )}
      {expired ? (
        <InfoCard tone="warn" testID="clean-photo-expired">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.meta, { color: theme.textPrimary }]}>{t("roomBoard.panel.session.photoExpired")}</Text>
          <Button
            label={t("roomBoard.panel.session.reloadPhotos")}
            variant="secondary"
            size="sm"
            onPress={() => {
              setFailed({});
              res.reload();
            }}
            testID="clean-photo-reload"
          />
        </InfoCard>
      ) : null}
    </View>
  );
}

/* ─── Inspection history ──────────────────────────────────────────────────── */

export function InspectionHistoryPanel({ roomId, ctx, t, onOpenInspection }: { roomId: string; ctx: HistoryContext; t: Translate; onOpenInspection?: (inspectionId: string) => void }) {
  const theme = useTheme();
  const [days, setDays] = useState<InspectionRangeDays>(DEFAULT_INSPECTION_RANGE);
  const window = useMemo(() => inspectionWindow(days, ctx.now, ctx.timeZone), [days, ctx.now, ctx.timeZone]);
  const res = useRoomResource(`inspections:${roomId}:${window.from}:${window.to}`, () => fetchRoomInspections(roomId, window.from, window.to));
  const rows = useMemo(() => (res.state.status === "ready" ? buildInspectionHistory(res.state.data, ctx) : null), [res.state, ctx]);
  const tabs = INSPECTION_RANGES.map((n) => ({ key: String(n), label: t("roomBoard.panel.inspections.range", { days: n }) }));
  const tone = (result: string) =>
    result === "passed"
      ? { color: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }
      : result === "failed"
        ? { color: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }
        : { color: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine };
  return (
    <View style={styles.stack} testID="room-inspections-panel">
      <SegmentTabs tabs={tabs} selected={String(days)} onSelect={(key) => setDays(Number(key) as InspectionRangeDays)} />
      {res.state.status === "loading" ? (
        <LoadingBlock label={t("roomBoard.panel.loading")} />
      ) : res.state.status === "error" ? (
        <ErrorBlock error={res.state.error} onRetry={res.reload} t={t} />
      ) : rows && rows.length === 0 ? (
        <EmptyBlock title={t("roomBoard.panel.inspections.emptyTitle")} body={t("roomBoard.panel.inspections.emptyBody", { days })} />
      ) : (
        rows?.map((row) => {
          const c = tone(row.result);
          const Wrapper = onOpenInspection ? Pressable : View;
          const wrapperProps = onOpenInspection
            ? {
                onPress: () => onOpenInspection(row.id),
                accessibilityRole: "button" as const,
                accessibilityLabel: t("roomBoard.panel.inspections.openA11y", { result: row.resultLabel, time: row.at ?? "" }),
              }
            : {};
          return (
            <Wrapper key={row.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`inspection-${row.id}`} {...wrapperProps}>
              <View style={styles.cardTop}>
                <Pill label={row.resultLabel} color={c.color} bg={c.bg} line={c.line} />
                {row.at ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>{row.at}</Text> : null}
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: row.inspector ? theme.textSecondary : theme.textMuted }]}>
                {row.inspector ? t("roomBoard.panel.inspections.inspector", { name: row.inspector }) : t("roomBoard.panel.inspections.inspectorUnknown")}
              </Text>
              {row.note ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]}>{t("roomBoard.panel.inspections.notes", { notes: row.note })}</Text> : null}
              {onOpenInspection ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.primaryAction, fontWeight: "800" }]}>{t("roomBoard.panel.inspections.openDetails")}</Text> : null}
            </Wrapper>
          );
        })
      )}
    </View>
  );
}

/* ─── Work order (read-only) ──────────────────────────────────────────────── */

export function WorkOrderPanel({
  workOrderId,
  roomId,
  roomNumber,
  boardOpen,
  ctx,
  t,
}: {
  workOrderId: string;
  roomId: string;
  roomNumber: string;
  /** The board still lists this order as open. */
  boardOpen: boolean;
  ctx: HistoryContext;
  t: Translate;
}) {
  const theme = useTheme();
  const res = useRoomResource(`wo:${workOrderId}`, () => fetchWorkOrderDetail(workOrderId));
  const view = useMemo(
    () => (res.state.status === "ready" ? buildWorkOrderDetail(res.state.data, { ...ctx, expectedRoomId: roomId, roomNumber }) : null),
    [res.state, ctx, roomId, roomNumber],
  );
  if (res.state.status === "loading") return <LoadingBlock label={t("roomBoard.panel.loading")} />;
  if (res.state.status === "error") {
    return res.state.error === "not_found" ? (
      <EmptyBlock title={t("roomBoard.panel.workOrder.goneTitle")} body={t("roomBoard.panel.workOrder.goneBody")} testID="work-order-gone" />
    ) : (
      <ErrorBlock error={res.state.error} onRetry={res.reload} t={t} />
    );
  }
  if (!view) return null;
  if (view.kind === "wrong_room") return <EmptyBlock title={t("roomBoard.panel.workOrder.wrongRoomTitle")} body={t("roomBoard.panel.workOrder.wrongRoomBody")} testID="work-order-wrong-room" />;
  const d = view.detail;
  return (
    <View style={styles.stack} testID="work-order-panel">
      <View style={styles.stack}>
        {d.number ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.groupTitle, { color: theme.textMuted }]}>{t("roomBoard.detail.workOrder.number", { number: d.number })}</Text> : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.woTitle, { color: theme.textPrimary }]} testID="work-order-title">{d.title}</Text>
        <View style={styles.badges}>
          {d.statusLabel ? <Pill label={d.statusLabel} color={d.closed ? theme.textSecondary : theme.status.pickup} bg={d.closed ? theme.surfaceSubtle : theme.status.pickupSoft} line={d.closed ? theme.borderSubtle : theme.status.pickupLine} /> : null}
          {d.priorityLabel ? <Pill label={d.priorityLabel} color={d.highPriority ? theme.status.dirty : theme.textSecondary} bg={d.highPriority ? theme.status.dirtySoft : theme.surfaceSubtle} line={d.highPriority ? theme.status.dirtyLine : theme.borderSubtle} /> : null}
        </View>
      </View>
      {d.closed && boardOpen ? (
        <InfoCard tone="warn" testID="work-order-closed-notice">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.meta, { color: theme.textPrimary }]}>{t("roomBoard.panel.workOrder.closedSince")}</Text>
        </InfoCard>
      ) : null}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {d.rows.map((row) => (
          <Row key={row.key} label={row.label} value={row.value} />
        ))}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{t("roomBoard.panel.workOrder.description")}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: d.description ? theme.textPrimary : theme.textMuted }]} testID="work-order-description">
        {d.description ?? t("roomBoard.panel.workOrder.noDescription")}
      </Text>
      {d.resolution ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="work-order-resolution">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{t("roomBoard.panel.workOrder.resolution")}</Text>
          {d.resolution.notes ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]}>{d.resolution.notes}</Text> : null}
          {d.resolution.parts ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>{t("roomBoard.panel.workOrder.parts", { parts: d.resolution.parts })}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  group: { gap: 8 },
  groupTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 13, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  rowLabel: { maxWidth: "42%", fontSize: 13 },
  rowValue: { flex: 1, textAlign: "right", fontSize: 13, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, minHeight: 28 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 96, height: 96, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImage: { width: "100%", height: "100%" },
  viewer: { width: "100%", height: 360, borderRadius: R.md },
  woTitle: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
