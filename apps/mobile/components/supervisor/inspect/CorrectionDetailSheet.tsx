import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { PhotoViewer } from "@/components/supervisor/inspect/workspace/PhotoViewer";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import { fetchInspectionDetail, type InspectionDetail } from "@/lib/api/inspections";
import { activityLines, drawerActions, pendingStep, type ActionFailure } from "@/lib/inspections/correctionActions";
import type { CorrectionItem } from "@/lib/inspections/lists";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; detail: InspectionDetail };

/**
 * ROOM 205 · CORRECTION. Everything shown is what the server recorded: the failed items with their notes and original
 * photos, the real owner, the task's real state and priority, and the events it timestamped. Nothing is estimated (no
 * completion forecast, no invented SLA), and an event the server did not record is simply not listed. It is read-only
 * except for the actions the server would accept right now.
 */
export function CorrectionDetailSheet({
  correction,
  reloadToken,
  roomAwaitingInspection,
  busy,
  failure,
  timeZone,
  language,
  t,
  onReassign,
  onEscalate,
  onReinspect,
  onRepair,
  onViewRoom,
  onViewRecord,
  onClose,
}: {
  correction: CorrectionItem | null;
  /** Bumped by the screen after a change so the drawer re-reads the server's record. */
  reloadToken: number;
  roomAwaitingInspection: boolean;
  busy: boolean;
  failure: ActionFailure | null;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  onReassign: (item: CorrectionItem, detail: InspectionDetail) => void;
  onEscalate: (item: CorrectionItem) => void;
  onReinspect: (item: CorrectionItem) => void;
  onRepair: (item: CorrectionItem) => void;
  onViewRoom: (item: CorrectionItem) => void;
  /** Open the failed inspection's full read-only record. */
  onViewRecord?: (item: CorrectionItem) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });
  const [confirmEscalate, setConfirmEscalate] = useState(false);
  const [viewing, setViewing] = useState<{ uri: string; label: string } | null>(null);
  const latest = useRef<string | null>(null);
  const id = correction?.inspectionId ?? null;

  const load = useCallback((inspectionId: string) => {
    latest.current = inspectionId;
    Promise.resolve()
      .then(() => fetchInspectionDetail(inspectionId))
      .then(
      (detail) => {
        if (latest.current !== inspectionId) return;
        setState(detail ? { status: "ready", detail } : (previous) => (previous.status === "ready" ? previous : { status: "failed" }));
      },
      () => {
        if (latest.current === inspectionId) setState((previous) => (previous.status === "ready" ? previous : { status: "failed" }));
      },
    );
  }, []);

  useEffect(() => {
    setConfirmEscalate(false);
    setViewing(null);
    if (id) {
      setState({ status: "loading" });
      load(id);
    } else latest.current = null;
  }, [id, load]);

  // After a change the previous detail stays on screen until the fresh one lands (no flash of "loading").
  useEffect(() => {
    if (id && reloadToken > 0) load(id);
  }, [reloadToken]);

  const detail = state.status === "ready" ? state.detail : null;
  const info = detail?.correction ?? null;
  const task = info?.task ?? null;
  const actions = drawerActions(info, roomAwaitingInspection && !(correction?.roomNotClean ?? false));
  const failed = (detail?.items ?? []).filter((item) => item.result === "fail");
  const lines = activityLines(info?.activity, timeZone, language, t);
  const next = pendingStep(info);
  const owner = task?.assigned_name?.trim() || (task?.assigned_to ? t("inspect.correction.ownerUnnamed") : t("inspect.correction.unassigned"));
  const statusKey = info ? (correction?.roomNotClean ? "roomNotClean" : info.status) : null;

  return (
    <WorkspaceSheet
      visible={correction !== null}
      title={correction ? t("inspect.drawer.title", { room: correction.roomNumber }) : ""}
      onClose={onClose}
      onBackdrop={onClose}
      closeLabel={t("inspect.record.close")}
      testID="correction-sheet"
      t={t}
    >
      {correction ? (
        <View style={styles.body}>
          <View style={styles.row}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
              {t("inspect.drawer.statusLabel").toUpperCase()}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]} testID="correction-sheet-status">
              {statusKey ? t(`inspect.correction.detail.${statusKey}`) : t(`inspect.correction.detail.${correction.status}`)}
            </Text>
          </View>

          {state.status === "loading" ? (
            <View style={styles.inline} accessibilityLabel={t("inspect.record.loading")}>
              <ActivityIndicator size="small" color={theme.primaryAction} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                {t("inspect.record.loading")}
              </Text>
            </View>
          ) : state.status === "failed" ? (
            <View style={styles.block} accessibilityRole="alert">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.dirty }]}>
                {t("inspect.record.failed")}
              </Text>
              <Button label={t("inspect.record.retry")} variant="secondary" size="sm" onPress={() => id && (setState({ status: "loading" }), load(id))} testID="correction-sheet-retry" />
            </View>
          ) : null}

          <View style={styles.block} testID="correction-sheet-issues">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
              {t("inspect.drawer.issue").toUpperCase()}
            </Text>
            {(detail ? failed : correction.failedLabels.map((label) => ({ template_item_id: label, description: label, note: null, severity: null, photo_url: null }))).map((item) => (
              <View key={item.template_item_id ?? item.description} style={[styles.issue, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                  {item.description ?? item.note ?? "—"}
                </Text>
                {item.note && item.note !== item.description ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
                    {item.note}
                  </Text>
                ) : null}
                {item.severity ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
                    {t("inspect.drawer.severity", { severity: t(`inspect.workspace.issue.severity.${item.severity}`) })}
                  </Text>
                ) : null}
                {item.photo_url ? (
                  <Pressable
                    onPress={() => setViewing({ uri: item.photo_url as string, label: item.description ?? "" })}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={t("inspect.drawer.photoA11y", { item: item.description ?? "" })}
                    style={styles.photoWrap}
                    testID={`correction-sheet-photo-${item.template_item_id}`}
                  >
                    <Image source={{ uri: item.photo_url }} style={[styles.photo, { backgroundColor: theme.surfaceMuted }]} resizeMode="cover" />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {detail && failed.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                {t("inspect.record.noFailedItems")}
              </Text>
            ) : null}
          </View>

          <View style={styles.cols}>
            <View style={styles.col} testID="correction-sheet-owner">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
                {t("inspect.drawer.assignedTo").toUpperCase()}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                {detail ? owner : correction.owner.kind === "named" ? correction.owner.name : correction.owner.kind === "unnamed" ? t("inspect.correction.ownerUnnamed") : t("inspect.correction.unassigned")}
              </Text>
            </View>
            {task?.priority ? (
              <View style={styles.col} testID="correction-sheet-priority">
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
                  {t("inspect.drawer.priority").toUpperCase()}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                  {t(`inspect.drawer.priorityValue.${task.priority}`)}
                </Text>
              </View>
            ) : null}
          </View>

          {detail ? (
            <View style={styles.block} testID="correction-sheet-activity">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
                {t("inspect.drawer.activity").toUpperCase()}
              </Text>
              {lines.map((line) => (
                <Text key={line.key} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                  <Text style={{ fontFamily: monoFont }}>{line.time}</Text> — {line.text}
                </Text>
              ))}
              {next ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="correction-sheet-pending">
                  {t(`inspect.drawer.pending.${next}`)}
                </Text>
              ) : null}
            </View>
          ) : null}

          {failure ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="correction-sheet-error">
              {t(`inspect.drawer.failure.${failure}`)}
            </Text>
          ) : null}

          {confirmEscalate ? (
            <View style={[styles.confirm, { borderColor: theme.status.pickupLine, backgroundColor: theme.status.pickupSoft }]} testID="correction-sheet-confirm-escalate">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                {t("inspect.drawer.escalateConfirm")}
              </Text>
              <View style={styles.actions}>
                <Button label={t("inspect.drawer.escalate")} loading={busy} onPress={() => { onEscalate(correction); setConfirmEscalate(false); }} testID="correction-sheet-escalate-yes" />
                <Button label={t("common.cancel")} variant="secondary" disabled={busy} onPress={() => setConfirmEscalate(false)} />
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              {actions.reinspect ? <Button label={t("inspect.correction.startReinspection")} size="lg" disabled={busy} onPress={() => onReinspect(correction)} testID="correction-sheet-reinspect" /> : null}
              {actions.repair ? <Button label={t("inspect.correction.requestAgain")} size="lg" loading={busy} onPress={() => onRepair(correction)} testID="correction-sheet-repair" /> : null}
              {actions.reassign && detail ? (
                <Button label={t(task?.assigned_to ? "inspect.drawer.reassign" : "inspect.correction.assign")} variant={actions.reinspect ? "secondary" : "primary"} size="lg" disabled={busy} onPress={() => onReassign(correction, detail)} testID="correction-sheet-reassign" />
              ) : null}
              {actions.escalate ? <Button label={t("inspect.drawer.escalate")} variant="secondary" size="lg" disabled={busy} onPress={() => setConfirmEscalate(true)} testID="correction-sheet-escalate" /> : null}
              {onViewRecord ? <Button label={t("inspect.history.record.viewOriginal")} variant="ghost" size="lg" disabled={busy} onPress={() => onViewRecord(correction)} testID="correction-sheet-view-record" /> : null}
              <Button label={t("inspect.correction.viewRoom")} variant="ghost" size="lg" disabled={busy} onPress={() => onViewRoom(correction)} testID="correction-sheet-view-room" />
            </View>
          )}
          <PhotoViewer uri={viewing?.uri ?? null} label={viewing?.label ?? ""} t={t} onClose={() => setViewing(null)} />
        </View>
      ) : null}
    </WorkspaceSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 8 },
  row: { gap: 2 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  block: { gap: 6 },
  cols: { flexDirection: "row", gap: 16 },
  col: { flex: 1, gap: 2 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  value: { fontSize: 15.5, lineHeight: 22, fontWeight: "700" },
  muted: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  error: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  issue: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 4 },
  photoWrap: { alignSelf: "flex-start", marginTop: 4 },
  photo: { width: 120, height: 90, borderRadius: R.sm },
  confirm: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 10 },
  actions: { gap: 8 },
});
