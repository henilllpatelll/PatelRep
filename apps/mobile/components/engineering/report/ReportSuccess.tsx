import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { DetailRow, Panel } from "@/components/engineering/assets/assetUi";
import { InlineError } from "@/components/engineering/workorder/sheetKit";
import type { ReportDraft, ReportOutcome, ReportPhoto } from "@/lib/engineering/reportIssue";

interface Props {
  outcome: Extract<ReportOutcome, { kind: "created" | "queued" }>;
  draft: ReportDraft;
  photosPending: readonly ReportPhoto[];
  retryingPhotos: boolean;
  onRetryPhotos: () => void;
  onView: () => void;
  onBack: () => void;
  onAnother: () => void;
  backLabel: string;
}

function placeOf(draft: ReportDraft): string {
  const location = draft.location;
  if (!location) return "";
  return location.kind === "room" ? location.roomNumber : location.text;
}

/**
 * What happened to the report. "Created" appears only from the server's own answer; a report saved offline gets its
 * own wording and never a work order number, because the server has not accepted it yet.
 */
export function ReportSuccess({ outcome, draft, photosPending, retryingPhotos, onRetryPhotos, onView, onBack, onAnother, backLabel }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queued = outcome.kind === "queued";
  const number = outcome.kind === "created" && outcome.workOrderNumber ? `WO-${String(outcome.workOrderNumber).replace(/^WO-/i, "")}` : null;

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} testID={queued ? "report-queued" : "report-created"}>
      <View style={styles.head} accessibilityLiveRegion="polite">
        <Ionicons name={queued ? "cloud-upload-outline" : "checkmark-circle"} size={44} color={queued ? theme.status.pickup : theme.status.ready} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {queued ? t("report.success.queuedTitle") : t("report.success.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {queued ? t("report.success.queuedBody") : outcome.kind === "created" && outcome.replayed ? t("report.success.replayedBody") : t("report.success.body")}
        </Text>
      </View>

      <Panel>
        {number ? <DetailRow label={t("report.success.number")} value={number} /> : null}
        <DetailRow label={t("report.success.issue")} value={draft.title.trim()} />
        <DetailRow label={t("report.success.location")} value={placeOf(draft)} />
        <DetailRow label={t("report.success.priority")} value={t(`workQueue.priority.${draft.priority}`)} />
        <DetailRow label={t("report.success.status")} value={queued ? t("report.success.statusQueued") : outcome.kind === "created" && outcome.status ? t(`workOrders.status.${outcome.status}`, { defaultValue: outcome.status }) : t("report.success.statusUnknown")} />
      </Panel>

      {queued && outcome.kind === "queued" && outcome.photosDropped > 0 ? (
        <InlineError testID="report-photos-dropped">{t("report.success.photosNotSaved", { count: outcome.photosDropped })}</InlineError>
      ) : null}

      {outcome.kind === "created" && outcome.roomDown ? (
        <View style={[styles.notice, { backgroundColor: outcome.roomDown === "confirmed" ? theme.status.readySoft : theme.status.pickupSoft }]} accessibilityLiveRegion="polite" testID="report-room-down-result">
          <Ionicons name={outcome.roomDown === "confirmed" ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={outcome.roomDown === "confirmed" ? theme.status.ready : theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
            {outcome.roomDown === "confirmed" ? t("report.success.roomDownConfirmed", { room: placeOf(draft) }) : t("report.success.roomDownUnconfirmed", { room: placeOf(draft) })}
          </Text>
        </View>
      ) : null}

      {outcome.kind === "created" && photosPending.length > 0 ? (
        <View style={[styles.notice, { backgroundColor: theme.status.pickupSoft }]} accessibilityLiveRegion="polite" testID="report-photos-failed">
          <Ionicons name="alert-circle-outline" size={18} color={theme.status.pickup} />
          <View style={styles.noticeBody}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textPrimary }]}>
              {t("report.success.photosFailed", { count: photosPending.length })}
            </Text>
            <Button label={t("report.success.retryPhotos")} variant="secondary" size="sm" onPress={onRetryPhotos} loading={retryingPhotos} disabled={retryingPhotos} testID="report-retry-photos" />
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        {!queued && outcome.kind === "created" && outcome.workOrderId ? <Button label={t("report.success.view")} size="lg" onPress={onView} testID="report-view" /> : null}
        <Button label={backLabel} variant={queued ? "primary" : "secondary"} size="lg" onPress={onBack} testID="report-back" />
        <Button label={t("report.success.another")} variant="ghost" onPress={onAnother} testID="report-another" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16 },
  head: { alignItems: "center", gap: 8, paddingTop: 12 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  body: { fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  notice: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 12, alignItems: "flex-start" },
  noticeBody: { flex: 1, gap: 8 },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  actions: { gap: 10 },
});
