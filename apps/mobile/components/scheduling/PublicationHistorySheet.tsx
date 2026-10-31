import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import {
  fetchHistory,
  fetchNotificationStatus,
  fetchRevision,
  fetchRevisionEvents,
  startCorrection,
  type Revision,
  type RevisionChange,
  type RevisionStatus,
} from "@/lib/api/schedulingRevisions";
import type { TeamPerson } from "@/lib/api/schedulingTeam";
import { useRemote } from "@/lib/scheduling/requestHooks";
import { eventLabel, faceWindow, notificationHeadline, pushLines, stampText } from "@/lib/scheduling/publishText";
import { formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  /** Open straight on one publication (from the publish confirmation). */
  initialId?: string | null;
  people: readonly TeamPerson[];
  zone: string | null;
  language?: string;
  isOnline: boolean;
  onClose: () => void;
  /** A corrective draft was opened: the drafts should be re-read. */
  onCorrectionStarted: () => void;
  t: Translate;
}

type Filter = "all" | RevisionStatus;
const FILTERS: Filter[] = ["all", "published", "discarded"];

export function PublicationHistorySheet(props: Props) {
  if (!props.visible) return null;
  return <HistoryBody {...props} />;
}

function HistoryBody({ initialId, people, zone, language, isOnline, onClose, onCorrectionStarted, t }: Props) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => setSelected(initialId ?? null), [initialId]);
  const list = useRemote(() => fetchHistory({ status: filter === "all" ? undefined : filter }), [filter], isOnline && selected === null);
  const nameOf = useCallback((id: string) => people.find((person) => person.userId === id)?.name ?? t("teamSchedule.unnamed"), [people, t]);

  return (
    <BottomSheet visible title={t(selected ? "teamSchedule.publish.history.detailTitle" : "teamSchedule.publish.history.title")} onClose={onClose} tall testID="publication-history">
      {selected ? (
        <Detail id={selected} nameOf={nameOf} zone={zone} language={language} isOnline={isOnline} onBack={() => setSelected(null)} onCorrectionStarted={onCorrectionStarted} t={t} />
      ) : (
        <View style={styles.block}>
          <View style={styles.chips}>
            {FILTERS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setFilter(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === value }}
                style={[styles.chip, { borderColor: filter === value ? theme.primaryAction : theme.border, backgroundColor: filter === value ? theme.primarySoft : "transparent" }]}
                testID={`history-filter-${value}`}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                  {t(`teamSchedule.publish.history.filter.${value}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          {list.status === "loading" ? <Muted text={t("teamSchedule.publish.history.loading")} /> : null}
          {list.status === "failed" ? <Muted text={t("teamSchedule.publish.history.failed")} testID="history-failed" /> : null}
          {list.status === "ready" && (list.data?.items.length ?? 0) === 0 ? <Muted text={t("teamSchedule.publish.history.empty")} testID="history-empty" /> : null}
          {(list.data?.items ?? []).map((revision) => (
            <Pressable
              key={revision.id}
              onPress={() => setSelected(revision.id)}
              accessibilityRole="button"
              accessibilityLabel={summaryLine(revision, t)}
              style={[styles.row, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]}
              testID={`history-row-${revision.id}`}
            >
              <View style={styles.flex}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
                  {stamp(revision, zone, language) || t("teamSchedule.publish.history.undated")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                  {summaryLine(revision, t)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </Pressable>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

function stamp(revision: Revision, zone: string | null, language?: string): string {
  return stampText(revision.publishedAt ?? revision.updatedAt, zone, language);
}

function summaryLine(revision: Revision, t: Translate): string {
  const result = revision.result;
  const parts = [t(`teamSchedule.publish.status.${revision.status}`)];
  if (revision.publishedByName) parts.push(revision.publishedByName);
  if (result) parts.push(t("teamSchedule.publish.counts", { created: result.created, updated: result.updated, cancelled: result.cancelled }));
  if (result) parts.push(t("teamSchedule.publish.history.employees", { count: result.employeesAffected }));
  return parts.join(" · ");
}

function Detail({ id, nameOf, zone, language, isOnline, onBack, onCorrectionStarted, t }: {
  id: string; nameOf: (id: string) => string; zone: string | null; language?: string; isOnline: boolean; onBack: () => void; onCorrectionStarted: () => void; t: Translate;
}) {
  const theme = useTheme();
  const revision = useRemote(() => fetchRevision(id), [id], isOnline);
  const events = useRemote(() => fetchRevisionEvents(id), [id], isOnline);
  const notices = useRemote(() => fetchNotificationStatus(id), [id], isOnline);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const row = revision.data;

  const correct = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await startCorrection(id);
      onCorrectionStarted();
      onBack();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!row) {
    return <Muted text={t(revision.status === "failed" ? "teamSchedule.publish.history.failed" : "teamSchedule.publish.history.loading")} testID="history-detail-loading" />;
  }
  return (
    <View style={styles.block} testID="history-detail">
      <Button label={t("teamSchedule.publish.history.back")} icon="chevron-back" size="sm" variant="ghost" onPress={onBack} testID="history-back" />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
        {stamp(row, zone, language)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="history-summary">
        {summaryLine(row, t)}
      </Text>
      {row.correctsRevisionId ? <Muted text={t("teamSchedule.publish.history.corrective")} testID="history-corrective" /> : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.textPrimary }]}>
        {t("teamSchedule.publish.history.changes")}
      </Text>
      {(row.changes ?? []).map((change) => (
        <Text key={change.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID={`history-change-${change.id}`}>
          {changeLine(change, nameOf, zone, language, t)}
        </Text>
      ))}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.textPrimary }]}>
        {t("teamSchedule.publish.notify.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="history-notify">
        {notificationHeadline(notices.data, notices.status === "failed", t)}
      </Text>
      {pushLines(notices.data, t).map((line) => (
        <Muted key={line} text={line} />
      ))}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.textPrimary }]}>
        {t("teamSchedule.publish.history.trail")}
      </Text>
      {(events.data ?? []).map((event) => (
        <Text key={event.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID={`history-event-${event.id}`}>
          {[stampText(event.createdAt, zone, language) || null, eventLabel(event.event, t), event.actorName].filter(Boolean).join(" · ")}
        </Text>
      ))}

      {row.status === "published" ? (
        <View style={styles.block}>
          <Muted text={t("teamSchedule.publish.history.correctHint")} />
          <Button label={t("teamSchedule.publish.history.correct")} variant="secondary" onPress={() => void correct()} loading={busy} disabled={busy || !isOnline} testID="history-correct" />
          {failed ? <Muted text={t("teamSchedule.publish.history.correctFailed")} testID="history-correct-failed" /> : null}
        </View>
      ) : null}
    </View>
  );
}

function changeLine(change: RevisionChange, nameOf: (id: string) => string, zone: string | null, language: string | undefined, t: Translate): string {
  const face = change.proposed ?? change.before;
  const who = nameOf(face?.userId ?? "");
  const date = face ? formatShortDate(face.workDate, language) : "";
  if (change.kind === "cancel") return t("teamSchedule.publish.history.change.cancel", { name: who, date, window: faceWindow(change.before, zone, language) });
  if (change.kind === "create") return t("teamSchedule.publish.history.change.create", { name: who, date, window: faceWindow(change.proposed, zone, language) });
  return t("teamSchedule.publish.history.change.update", { name: who, date, before: faceWindow(change.before, zone, language), after: faceWindow(change.proposed, zone, language) });
}

function Muted({ text, testID }: { text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID={testID}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10, marginBottom: 12 },
  flex: { flex: 1, gap: 2 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, justifyContent: "center" },
  chipText: { fontSize: 13.5, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, padding: 12 },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 13.5, lineHeight: 19 },
  h2: { fontSize: 15, fontWeight: "700", marginTop: 6 },
});
