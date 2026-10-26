import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { ResultBadge } from "@/components/supervisor/inspect/history/ResultBadge";
import { ChecklistSections, IssueList, InfoRows, RecordSection, RelatedList } from "@/components/supervisor/inspect/record/RecordParts";
import { TimelineSheet } from "@/components/supervisor/inspect/record/TimelineSheet";
import { PhotoViewer } from "@/components/supervisor/inspect/workspace/PhotoViewer";
import { WorkspaceHeader } from "@/components/supervisor/inspect/workspace/WorkspaceHeader";
import { InspectNotice, InspectSkeleton } from "@/components/supervisor/inspect/InspectListStates";
import { normalizeRoomIdParam } from "@/lib/housekeeping/inspectionTarget";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { buildRecord, recordDateLabel, type IssueView } from "@/lib/inspections/history/record";
import { relatedInspections } from "@/lib/inspections/history/timeline";
import { hasCycle, useInspectionRecord } from "@/lib/inspections/history/useInspectionRecord";
import { parseRecordOrigin, recordFallbackHref, recordHref } from "@/lib/inspections/route";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Inspection details — the read-only record of a finished inspection ─────
   ONE canonical screen for every way into a completed inspection (Done list, a correction, the Room Board's room
   history, another inspection of the same correction cycle). It is named by the stable inspection id, shows only
   what the server recorded - a fact that was never stored reads "Not recorded" - and offers no way to change a
   finished checklist. The original failure stays a failure even after a later reinspection passes. */

export default function InspectionRecordScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = i18n.language === "es" ? "es" : "en";
  const timeZone = useAppStore((state) => state.hotelTimezone);
  useHotelTimezone();
  const scopeKey = useAppStore((state) => (state.user?.tenant_id && state.user?.id ? `${state.user.tenant_id}:${state.user.id}` : null));

  const params = useLocalSearchParams<{ inspectionId?: string | string[]; from?: string | string[]; roomId?: string | string[]; roomNumber?: string | string[] }>();
  const inspectionId = normalizeRoomIdParam(params.inspectionId);
  const origin = parseRecordOrigin(normalizeRoomIdParam(params.from));
  const hintRoomId = normalizeRoomIdParam(params.roomId);
  const hintRoom = normalizeRoomIdParam(params.roomNumber);

  const record = useInspectionRecord(inspectionId);
  const { detail, timeline } = record;
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [viewing, setViewing] = useState<{ issue: IssueView } | null>(null);
  const [links, setLinks] = useState<Record<string, string | null>>({});

  const goBack = useCallback(() => {
    const roomId = hintRoomId ?? (detail.status === "ready" ? detail.data.room_id : null);
    // From the Room Board, Back reopens that room's drawer (the board takes `?roomId=`), not just the board.
    if (origin === "board" && roomId) router.replace(recordFallbackHref(origin, roomId) as never);
    else if (router.canGoBack()) router.back();
    else router.replace(recordFallbackHref(origin, roomId) as never);
  }, [origin, hintRoomId, detail]);

  // Android hardware back leaves the record (closing an open drawer or the photo first is each sheet's own job).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (timelineOpen) {
          setTimelineOpen(false);
          return true;
        }
        if (viewing) {
          setViewing(null);
          return true;
        }
        goBack();
        return true;
      });
      return () => subscription.remove();
    }, [goBack, timelineOpen, viewing]),
  );

  // Another hotel or person signed in: nothing of the previous one stays on screen.
  const startScope = useRef(scopeKey);
  useEffect(() => {
    if (startScope.current === scopeKey) return;
    startScope.current = scopeKey;
    router.replace({ pathname: "/(app)/inspect" } as never);
  }, [scopeKey]);

  // A new inspection (following a related one) starts with no leftover links or open drawers.
  useEffect(() => {
    setLinks({});
    setTimelineOpen(false);
    setViewing(null);
  }, [inspectionId]);

  const data = detail.status === "ready" ? detail.data : null;
  const view = useMemo(() => (data ? buildRecord(data) : null), [data]);
  const cycle = hasCycle(data);
  const timelineLoad = record.loadTimeline;
  // The cycle's other inspections are listed on the page itself, so the timeline is read as soon as the record says it has one.
  useEffect(() => {
    if (cycle && timeline.status === "idle") timelineLoad();
  }, [cycle, timeline.status, timelineLoad]);

  const roomNumber = data?.room_number ?? hintRoom ?? null;
  const clock = view?.completedAtMs ? formatHotelTime(new Date(view.completedAtMs), timeZone, language) : null;
  const date = view ? recordDateLabel(view.completedAtMs, timeZone, language) : null;
  const when = date && clock ? t("inspect.history.record.when", { date, time: clock }) : null;

  const uriFor = useCallback((issue: IssueView): string | null => (issue.id in links ? links[issue.id] : issue.photoUrl), [links]);
  const refreshLink = useCallback(
    async (issue: IssueView) => {
      const fresh = await record.refreshEvidence(issue.id);
      setLinks((previous) => ({ ...previous, [issue.id]: fresh }));
      return fresh;
    },
    [record],
  );

  const openRecord = useCallback(
    (id: string) => {
      setTimelineOpen(false);
      router.push(recordHref(id, "cycle", data?.room_id ?? hintRoomId, roomNumber) as never);
    },
    [data?.room_id, hintRoomId, roomNumber],
  );
  const viewRoom = useCallback(() => {
    const roomId = data?.room_id ?? hintRoomId;
    if (roomId) router.push({ pathname: "/(app)/room-board", params: { roomId } } as never);
  }, [data?.room_id, hintRoomId]);

  const defaultOpen = useMemo(() => {
    if (!view) return new Set<string>();
    const failing = view.sections.filter((section) => section.failed > 0).map((section) => section.key);
    return new Set(failing.length > 0 ? failing : view.sections.slice(0, 1).map((section) => section.key));
  }, [view]);

  const related = useMemo(() => (timeline.status === "ready" ? relatedInspections(timeline.data, inspectionId ?? "") : []), [timeline, inspectionId]);

  const header = t("inspect.history.record.title");
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="inspection-record-screen">
      <WorkspaceHeader title={header} topInset={insets.top} t={t} onBack={goBack} />
      {!inspectionId ? (
        <ScrollView contentContainerStyle={styles.content}>
          <InspectNotice testID="record-invalid" tone="problem" icon="alert-circle-outline" title={t("inspect.history.record.invalidTitle")} body={t("inspect.history.record.invalidBody")} actionLabel={t("inspect.history.record.backToList")} onAction={goBack} />
        </ScrollView>
      ) : detail.status === "idle" || detail.status === "loading" ? (
        <ScrollView contentContainerStyle={styles.content}>
          <InspectSkeleton label={t("inspect.record.loading")} />
        </ScrollView>
      ) : detail.status === "failed" ? (
        <ScrollView contentContainerStyle={styles.content}>
          <InspectNotice
            testID="record-failed"
            tone="problem"
            icon={detail.failure === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
            title={t(`inspect.history.record.failure.${detail.failure}.title`)}
            body={t(`inspect.history.record.failure.${detail.failure}.body`)}
            actionLabel={detail.failure === "not_found" || detail.failure === "forbidden" ? t("inspect.history.record.backToList") : t("inspect.record.retry")}
            onAction={detail.failure === "not_found" || detail.failure === "forbidden" ? goBack : record.reload}
          />
        </ScrollView>
      ) : data && view ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} testID="record-scroll">
          {detail.stale ? (
            <View style={[styles.stale, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert" testID="record-stale">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.staleText, { color: theme.textPrimary }]}>
                {t("inspect.history.record.stale")}
              </Text>
              <Button label={t("inspect.record.retry")} variant="secondary" size="sm" onPress={record.reload} testID="record-stale-retry" />
            </View>
          ) : null}

          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.room, { color: theme.textPrimary }]} testID="record-room">
                {t("inspect.history.record.room", { room: roomNumber ?? "—" })}
              </Text>
              <ResultBadge result={view.result} size="lg" t={t} testID="record-result" />
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.when, { color: theme.textSecondary }]} testID="record-when">
              {when ?? t("inspect.history.record.timeNotRecorded")}
            </Text>
            {data.floor !== null || data.building ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.when, { color: theme.textMuted }]}>
                {[data.building, data.floor !== null ? t("inspect.history.row.floor", { floor: data.floor }) : null].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            {view.result === "conditional" ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.when, { color: theme.textMuted }]} testID="record-conditional-note">
                {t("inspect.history.record.conditionalNote")}
              </Text>
            ) : null}
          </View>

          <RecordSection title={t("inspect.history.record.information")} testID="record-information">
            <InfoRows rows={view.info} t={t} />
          </RecordSection>

          {view.issues.length > 0 ? (
            <RecordSection title={t("inspect.history.record.issues")} testID="record-issues">
              <IssueList
                issues={view.issues}
                resolveUri={uriFor}
                t={t}
                onOpenEvidence={(issue) => setViewing({ issue })}
                onRetryEvidence={(issue) => void refreshLink(issue)}
              />
            </RecordSection>
          ) : view.result === "failed" ? (
            <RecordSection title={t("inspect.history.record.issues")} testID="record-issues-missing">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                {t("inspect.history.record.issuesNotRecorded")}
              </Text>
            </RecordSection>
          ) : null}

          {data.correction ? (
            <RecordSection title={t("inspect.history.record.correction")} testID="record-correction">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.correctionStatus, { color: view.correction.outcome === "verified" ? theme.status.ready : theme.textPrimary }]} testID="record-correction-status">
                {view.correction.statusKey ? t(view.correction.statusKey) : ""}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.when, { color: theme.textMuted }]}>
                {t("inspect.history.record.correctionNote")}
              </Text>
              {view.correction.followUpId ? (
                <Button
                  label={t(view.correction.outcome === "verified" ? "inspect.history.record.viewVerifying" : "inspect.history.record.viewRepeat")}
                  variant="secondary"
                  size="sm"
                  onPress={() => openRecord(view.correction.followUpId!)}
                  testID="record-view-followup"
                />
              ) : null}
              <Button label={t("inspect.history.record.viewTimeline")} variant="secondary" size="sm" icon="git-branch-outline" onPress={() => setTimelineOpen(true)} testID="record-view-timeline" />
            </RecordSection>
          ) : null}

          <RecordSection title={t("inspect.history.record.checklist")} testID="record-checklist">
            {view.checklistMissing ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="record-checklist-missing">
                {t("inspect.history.record.checklistMissing")}
              </Text>
            ) : (
              <ChecklistSections sections={view.sections} defaultOpen={defaultOpen} t={t} />
            )}
          </RecordSection>

          <RecordSection title={t("inspect.history.record.notes")} testID="record-notes">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: view.notes ? theme.textPrimary : theme.textMuted }]} testID="record-notes-text">
              {view.notes ?? t("inspect.history.record.noNotes")}
            </Text>
          </RecordSection>

          {cycle ? (
            <RecordSection title={t("inspect.history.record.related")} testID="record-related">
              {timeline.status === "ready" ? (
                related.length > 1 ? (
                  <RelatedList items={related} timeZone={timeZone} language={language} t={t} onOpen={openRecord} />
                ) : (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
                    {t("inspect.history.record.noRelated")}
                  </Text>
                )
              ) : timeline.status === "failed" ? (
                <View style={styles.relatedFailed} accessibilityRole="alert">
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                    {t("inspect.history.record.relatedFailed")}
                  </Text>
                  <Button label={t("inspect.record.retry")} variant="secondary" size="sm" onPress={timelineLoad} testID="record-related-retry" />
                </View>
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
                  {t("inspect.record.loading")}
                </Text>
              )}
            </RecordSection>
          ) : null}

          {data.room_id ? (
            <Pressable onPress={viewRoom} accessibilityRole="button" testID="record-view-room" style={({ pressed }) => [styles.roomLink, { borderColor: theme.border, backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 }]}>
              <Ionicons name="bed-outline" size={18} color={theme.primaryAction} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomLinkText, { color: theme.primaryAction }]}>
                {t("inspect.record.viewRoom")}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      <TimelineSheet
        visible={timelineOpen}
        roomNumber={roomNumber}
        currentId={inspectionId ?? ""}
        state={timeline}
        timeZone={timeZone}
        language={language}
        t={t}
        onRetry={timelineLoad}
        onOpenInspection={openRecord}
        onClose={() => setTimelineOpen(false)}
      />
      <PhotoViewer
        uri={viewing ? uriFor(viewing.issue) : null}
        lost={viewing !== null && uriFor(viewing.issue) === null}
        label={viewing?.issue.description ?? ""}
        t={t}
        lostLabel={t("inspect.history.record.evidenceGone")}
        onClose={() => setViewing(null)}
        onUnreadable={() => viewing && void refreshLink(viewing.issue)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, flexGrow: 1 },
  titleBlock: { gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  room: { flex: 1, fontSize: 24, fontWeight: "800" },
  when: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 14.5, lineHeight: 21 },
  correctionStatus: { fontSize: 16, fontWeight: "800" },
  stale: { borderWidth: 1, borderRadius: R.lg, padding: 12, gap: 8 },
  staleText: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  relatedFailed: { gap: 8, alignItems: "flex-start" },
  roomLink: { minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: R.md },
  roomLinkText: { fontSize: 15, fontWeight: "800" },
});
