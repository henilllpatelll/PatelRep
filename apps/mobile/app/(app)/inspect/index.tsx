import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { R, monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { api } from "@/lib/api/client";
import { type InspectionTemplate, listInspectionTemplates, submitInspection } from "@/lib/api/inspections";
import { triggerReclean } from "@/lib/api/housekeepingSupervisor";
import { localDate, localTzOffset } from "@/lib/utils/date";
import { HeroSignalRow, type HeroSignal } from "@/components/supervisor/atoms";

/* ─── Inspect — the quality gate ────────────────────────────────────────────
   Dark shell hero with the day's inspection shape, a queue of submitted
   rooms with one-tap pass/fail, and today's completed inspections. */

interface ReadyRoom {
  room_id: string;
  room_number: string;
  floor: number | null;
  cleaned_by: string;
  cleaned_at: string | null;
  housekeeper_id: string | null;
  clean_type: string | null;
}

interface InspectionRecord {
  id: string;
  room_number: string;
  inspector_name: string;
  overall_result: "passed" | "failed" | "conditional";
  completed_at: string;
}

type Tab = "queue" | "done";

export default function InspectScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  const [queue, setQueue] = useState<ReadyRoom[]>([]);
  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("queue");
  const [template, setTemplate] = useState<InspectionTemplate | undefined>();
  const [confirm, setConfirm] = useState<{ room: ReadyRoom; result: "passed" | "failed" | "conditional" } | null>(null);
  const [confirmNotes, setConfirmNotes] = useState("");
  const [failedItems, setFailedItems] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [detailRecord, setDetailRecord] = useState<InspectionRecord | null>(null);
  const [reclean, setReclean] = useState<{ room: ReadyRoom; inspectionId: string; notes: string } | null>(null);
  const [recleaning, setRecleaning] = useState(false);

  // Themed replacement for the former module-level RESULT_META constant — kept as
  // the same identifier so the detail-modal reference below resolves via closure.
  const RESULT_META = useMemo<Record<InspectionRecord["overall_result"], { fg: string; bg: string; line: string }>>(
    () => ({
      passed: { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine },
      failed: { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine },
      conditional: { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine },
    }),
    [theme],
  );

  const load = useCallback(async () => {
    const today = localDate();
    const [queueRes, recordsRes, templatesRes] = await Promise.allSettled([
      api.get<{ data: ReadyRoom[] }>(`/housekeeping/ready-for-inspection?date=${today}`),
      api.get<{ data: InspectionRecord[] }>(`/housekeeping/inspections?date_from=${today}&date_to=${today}&tz_offset=${localTzOffset()}`),
      listInspectionTemplates(),
    ]);
    if (queueRes.status === "fulfilled") setQueue(queueRes.value.data ?? []);
    if (recordsRes.status === "fulfilled") setRecords(recordsRes.value.data ?? []);
    if (templatesRes.status === "fulfilled" && templatesRes.value.data.length > 0) {
      setTemplate(templatesRes.value.data[0]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const timeSince = useCallback(
    (iso: string | null): string => {
      if (!iso) return t("inspect.justNow");
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
      if (diff < 1) return t("inspect.justNow");
      if (diff < 60) return t("inspect.minutesAgo", { minutes: diff });
      return t("inspect.hoursAgo", { hours: Math.floor(diff / 60) });
    },
    [t],
  );

  const formatClock = useCallback(
    (iso: string): string =>
      new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
    [locale],
  );

  const passedToday = useMemo(
    () => records.filter((record) => record.overall_result === "passed").length,
    [records],
  );

  const signals = useMemo<HeroSignal[]>(
    () =>
      [
        queue.length > 0 && {
          key: "waiting",
          label: t("inspect.signalWaiting", { count: queue.length }),
          fg: theme.status.clean,
          bg: theme.status.cleanSoft,
          line: theme.status.cleanLine,
        },
        queue.length === 0 && !loading && {
          key: "clear",
          label: t("inspect.allClear"),
          fg: theme.status.ready,
          bg: theme.status.readySoft,
          line: theme.status.readyLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [queue.length, loading, t, theme],
  );

  const openConfirm = useCallback((room: ReadyRoom, result: "passed" | "failed" | "conditional") => {
    setConfirm({ room, result });
    setConfirmNotes("");
    setFailedItems({});
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirm || submitting) return;
    setSubmitting(true);
    try {
      const items = (template?.items ?? []).map((item) => ({
        template_item_id: item.id,
        result: (confirm.result === "passed" || confirm.result === "conditional"
          ? "pass"
          : failedItems[item.id] ? "fail" : "pass") as "pass" | "fail" | "na",
      }));
      const { id: inspectionId } = await submitInspection({
        room_id: confirm.room.room_id,
        template_id: template?.id,
        overall_result: confirm.result,
        notes: confirmNotes.trim() || undefined,
        items,
      });
      const savedRoom = confirm.room;
      const savedNotes = confirmNotes.trim();
      const wasFailure = confirm.result === "failed" || confirm.result === "conditional";
      setQueue((prev) => prev.filter((room) => room.room_id !== savedRoom.room_id));
      setConfirm(null);
      await load();
      if (wasFailure && inspectionId) {
        setReclean({ room: savedRoom, inspectionId, notes: savedNotes });
      }
    } catch {
      toast.error(t("inspect.submitError"));
    } finally {
      setSubmitting(false);
    }
  }, [confirm, submitting, template, confirmNotes, failedItems, t, load, toast]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "queue", label: t("inspect.toInspect"), count: queue.length },
    { key: "done", label: t("inspect.doneTab"), count: records.length },
  ];
  const confirmForeground =
    confirm?.result === "failed" ? theme.onDestructive : theme.onPrimary;

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>{t("inspect.kicker")}</Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("inspect.title")}</Text>
          <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
            {t("inspect.summary", { waiting: queue.length, passed: passedToday })}
          </Text>
          <HeroSignalRow signals={signals} />
        </View>

        <View style={[styles.segmented, { backgroundColor: theme.surfaceMuted }]}>
          {tabs.map((item) => {
            const isActive = tab === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.segment,
                  isActive && [
                    styles.segmentActive,
                    { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.textPrimary },
                  ],
                ]}
                onPress={() => setTab(item.key)}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityLabel={`${item.label}${item.count > 0 ? ` ${item.count}` : ""}`}
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.segmentLabel, { color: isActive ? theme.textPrimary : theme.textMuted }]}>
                  {item.label}
                  {item.count > 0 ? ` ${item.count}` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.body}>
          {tab === "queue" ? (
            queue.length === 0 ? (
              <StateBlock
                status="empty"
                emptyIcon="shield-checkmark-outline"
                emptyTitle={t("inspect.queueEmpty")}
                emptyBody={t("inspect.queueEmptyHint")}
              />
            ) : (
              queue.map((room) => (
                <View
                  key={room.room_id}
                  style={[
                    styles.queueCard,
                    { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.textPrimary },
                  ]}
                  testID={`inspect-${room.room_number}`}
                >
                  <View style={[styles.queueRail, { backgroundColor: theme.status.clean }]} />
                  <View style={styles.queueBody}>
                    <Text style={[styles.queueRoomNumber, { color: theme.textPrimary }]}>{room.room_number}</Text>
                    <Text style={[styles.queueCleanedBy, { color: theme.textSecondary }]} numberOfLines={1}>
                      {room.cleaned_by}
                    </Text>
                    <Text style={[styles.queueMeta, { color: theme.textMuted }]}>
                      {t("inspect.doneAgo", { time: timeSince(room.cleaned_at) })}
                      {room.clean_type ? ` · ${room.clean_type}` : ""}
                    </Text>
                  </View>
                  <View style={styles.queueActions} collapsable={false}>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: theme.status.ready, borderColor: theme.status.ready }]}
                      onPress={() => openConfirm(room, "passed")}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={t("inspect.confirmPass")}
                    >
                      <Ionicons name="checkmark" size={20} color={theme.onPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
                      ]}
                      onPress={() => openConfirm(room, "conditional")}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={t("inspect.confirmTouchup")}
                    >
                      <Ionicons name="flash" size={17} color={theme.status.pickup} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine },
                      ]}
                      onPress={() => openConfirm(room, "failed")}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={t("inspect.confirmFail")}
                    >
                      <Ionicons name="close" size={20} color={theme.status.dirty} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )
          ) : records.length === 0 ? (
            <StateBlock
              status="empty"
              emptyIcon="moon-outline"
              emptyTitle={t("inspect.noneDoneYet")}
              emptyBody={t("inspect.pullToRefresh")}
            />
          ) : (
            records.map((record) => {
              const meta = RESULT_META[record.overall_result] ?? RESULT_META.conditional;
              return (
                <TouchableOpacity
                  key={record.id}
                  style={[styles.doneRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  onPress={() => setDetailRecord(record)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${record.room_number}, ${t(`inspect.result.${record.overall_result}`)}, ${record.inspector_name}`}
                >
                  <Text style={[styles.doneRoomNumber, { color: theme.textPrimary }]}>{record.room_number}</Text>
                  <View style={styles.doneBody}>
                    <Text style={[styles.doneInspector, { color: theme.textSecondary }]} numberOfLines={1}>
                      {record.inspector_name}
                    </Text>
                    <Text style={[styles.doneTime, { color: theme.textMuted }]}>{formatClock(record.completed_at)}</Text>
                  </View>
                  <View style={[styles.resultPill, { backgroundColor: meta.bg, borderColor: meta.line }]}>
                    <Text style={[styles.resultText, { color: meta.fg }]}>
                      {t(`inspect.result.${record.overall_result}`)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={!!reclean} animationType="slide" transparent onRequestClose={() => setReclean(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setReclean(null)}>
          <TouchableOpacity style={[styles.modalSheet, { backgroundColor: theme.background }]} activeOpacity={1}>
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {t("inspect.reclean.title", { room: reclean?.room.room_number })}
              </Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setReclean(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalBody, { color: theme.textSecondary }]}>
              {t("inspect.reclean.body", { housekeeper: reclean?.room.cleaned_by ?? "—" })}
            </Text>
            {reclean?.notes ? (
              <View style={[styles.recleanNotesCard, { backgroundColor: theme.status.dirtySoft }]}>
                <Text style={[styles.recleanNotesText, { color: theme.status.dirty }]}>{reclean.notes}</Text>
              </View>
            ) : null}
            <View style={styles.confirmRow}>
              <Button
                label={t("common.cancel")}
                onPress={() => setReclean(null)}
                variant="secondary"
                style={styles.cancelBtnFlex}
              />
              <Button
                label={recleaning ? t("inspect.reclean.sending") : t("inspect.reclean.confirm")}
                onPress={async () => {
                  if (!reclean || recleaning) return;
                  setRecleaning(true);
                  try {
                    await triggerReclean(reclean.inspectionId);
                    setReclean(null);
                  } catch {
                    toast.error(t("inspect.reclean.error"));
                  } finally {
                    setRecleaning(false);
                  }
                }}
                loading={recleaning}
                variant="destructive"
                style={styles.confirmBtnFlex}
              />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!detailRecord} animationType="slide" transparent onRequestClose={() => setDetailRecord(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDetailRecord(null)}>
          <TouchableOpacity style={[styles.modalSheet, { backgroundColor: theme.background }]} activeOpacity={1}>
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {t("inspect.detail.title", { room: detailRecord?.room_number })}
              </Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setDetailRecord(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            {detailRecord ? (
              <>
                <Text style={[styles.detailMeta, { color: theme.textMuted }]}>
                  {detailRecord.inspector_name} · {formatClock(detailRecord.completed_at)}
                </Text>
                {(() => {
                  const meta = RESULT_META[detailRecord.overall_result] ?? RESULT_META.conditional;
                  return (
                    <View style={[styles.resultPill, { backgroundColor: meta.bg, borderColor: meta.line, alignSelf: "flex-start", marginTop: 8 }]}>
                      <Text style={[styles.resultText, { color: meta.fg }]}>
                        {t(`inspect.result.${detailRecord.overall_result}`)}
                      </Text>
                    </View>
                  );
                })()}
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!confirm} animationType="slide" transparent onRequestClose={() => setConfirm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <ScrollView
            style={[styles.confirmModalSheet, { backgroundColor: theme.background }]}
            contentContainerStyle={styles.modalSheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {confirm?.result === "passed"
                  ? t("inspect.modalTitlePass", { room: confirm?.room.room_number })
                  : confirm?.result === "conditional"
                    ? t("inspect.modalTitleTouchup", { room: confirm?.room.room_number })
                    : t("inspect.modalTitleFail", { room: confirm?.room.room_number })}
              </Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setConfirm(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            {confirm?.result === "failed" && template?.items && template.items.length > 0 ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t("inspect.failChecklistLabel")}</Text>
                <View style={styles.checklistWrap}>
                  {template.items.map((item) => {
                    const failed = Boolean(failedItems[item.id]);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.checklistRow}
                        onPress={() => setFailedItems((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                        activeOpacity={0.8}
                        accessibilityRole="checkbox"
                        accessibilityLabel={item.description}
                        accessibilityState={{ checked: failed }}
                      >
                        <View
                          style={[
                            styles.checkBox,
                            { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                            failed && { backgroundColor: theme.status.dirty, borderColor: theme.status.dirty },
                          ]}
                        >
                          {failed ? <Ionicons name="close" size={12} color={theme.onDestructive} /> : null}
                        </View>
                        <Text
                          style={[
                            styles.checklistLabel,
                            { color: theme.textPrimary },
                            failed && { color: theme.status.dirty, textDecorationLine: "line-through" },
                          ]}
                        >
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t("inspect.notesOptional")}</Text>
            <TextInput
              style={[styles.notesInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
              placeholder={
                confirm?.result === "failed"
                  ? t("inspect.failNotesPlaceholder")
                  : t("inspect.passNotesPlaceholder")
              }
              placeholderTextColor={theme.textDisabled}
              value={confirmNotes}
              onChangeText={setConfirmNotes}
              multiline
              maxLength={500}
            />

            <View style={styles.confirmRow}>
              <Button
                label={t("common.cancel")}
                onPress={() => setConfirm(null)}
                variant="secondary"
                style={styles.cancelBtnFlex}
              />
              {/* Tri-color pass/touchup/fail confirm action kept as a themed
                  TouchableOpacity rather than <Button> — Button's variant palette
                  (primary/secondary/ghost/destructive) has no amber/caution tone,
                  and force-fitting "conditional" onto "primary" would misleadingly
                  recolor a caution action forest-green. Mirrors the same queue
                  action buttons above and the 08-02 ChecklistSection precedent for
                  not force-fitting a status vocabulary onto a mismatched primitive. */}
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  {
                    backgroundColor:
                      confirm?.result === "passed"
                        ? theme.status.ready
                        : confirm?.result === "conditional"
                          ? theme.status.pickup
                          : theme.status.dirty,
                  },
                  submitting && styles.dimmed,
                ]}
                onPress={handleConfirm}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={
                  confirm?.result === "passed"
                    ? t("inspect.confirmPass")
                    : confirm?.result === "conditional"
                      ? t("inspect.confirmTouchup")
                      : t("inspect.confirmFail")
                }
                accessibilityState={{ disabled: submitting, busy: submitting }}
              >
                <Text style={[styles.confirmText, { color: confirmForeground }]}>
                  {submitting
                    ? t("inspect.submitting")
                    : confirm?.result === "passed"
                      ? t("inspect.confirmPass")
                      : confirm?.result === "conditional"
                        ? t("inspect.confirmTouchup")
                        : t("inspect.confirmFail")}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { fontSize: 13, marginTop: 7 },

  segmented: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 12,
    borderRadius: R.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: R.md - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    borderWidth: 1,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { fontSize: 12.5, fontWeight: "700" },

  body: { paddingHorizontal: 16, gap: 8 },

  queueCard: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  queueRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  queueBody: { flex: 1, minWidth: 0, gap: 2 },
  queueRoomNumber: { fontFamily: monoFont, fontSize: 24, lineHeight: 28, fontWeight: "800" },
  queueCleanedBy: { fontSize: 12.5, fontWeight: "700" },
  queueMeta: { fontSize: 11.5 },
  queueActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  doneRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  doneRoomNumber: { fontFamily: monoFont, fontSize: 18, fontWeight: "800" },
  doneBody: { flex: 1, minWidth: 0, gap: 1 },
  doneInspector: { fontSize: 12.5, fontWeight: "600" },
  doneTime: { fontSize: 11 },
  resultPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3.5 },
  resultText: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 10,
  },
  confirmModalSheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  modalSheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { fontSize: 20, fontWeight: "700", flex: 1, marginRight: 12 },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 84,
    textAlignVertical: "top",
  },
  confirmRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginTop: 18 },
  cancelBtnFlex: { flex: 1 },
  confirmBtnFlex: { flex: 2 },
  confirmBtn: {
    flex: 2,
    minHeight: 48,
    borderRadius: R.md,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  dimmed: { opacity: 0.5 },

  checklistWrap: { gap: 6, marginBottom: 12 },
  checklistRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  checkBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  checklistLabel: { fontSize: 13.5, flex: 1 },
  detailMeta: { fontSize: 12.5, marginTop: 4 },
  modalBody: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  recleanNotesCard: { borderRadius: 10, padding: 12, marginBottom: 12 },
  recleanNotesText: { fontSize: 12.5 },
});
