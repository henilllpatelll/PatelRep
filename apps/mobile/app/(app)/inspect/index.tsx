import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { api } from "@/lib/api/client";
import { type InspectionTemplate, listInspectionTemplates, submitInspection } from "@/lib/api/inspections";
import { localDate } from "@/lib/utils/date";
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

const RESULT_META: Record<InspectionRecord["overall_result"], { fg: string; bg: string; line: string }> = {
  passed: { fg: C.ready, bg: C.readySoft, line: C.readyLine },
  failed: { fg: C.alert, bg: C.alertSoft, line: C.alertLine },
  conditional: { fg: C.caution, bg: C.cautionSoft, line: C.cautionLine },
};

export default function InspectScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  const [queue, setQueue] = useState<ReadyRoom[]>([]);
  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("queue");
  const [template, setTemplate] = useState<InspectionTemplate | undefined>();
  const [confirm, setConfirm] = useState<{ room: ReadyRoom; result: "passed" | "failed" } | null>(null);
  const [confirmNotes, setConfirmNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const today = localDate();
    const [queueRes, recordsRes, templatesRes] = await Promise.allSettled([
      api.get<{ data: ReadyRoom[] }>(`/housekeeping/ready-for-inspection?date=${today}`),
      api.get<{ data: InspectionRecord[] }>(`/housekeeping/inspections?date_from=${today}&date_to=${today}`),
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
          fg: C.info,
          bg: C.infoSoft,
          line: C.infoLine,
        },
        queue.length === 0 && !loading && {
          key: "clear",
          label: t("inspect.allClear"),
          fg: C.ready,
          bg: C.readySoft,
          line: C.readyLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [queue.length, loading, t],
  );

  const openConfirm = useCallback((room: ReadyRoom, result: "passed" | "failed") => {
    setConfirm({ room, result });
    setConfirmNotes("");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirm || submitting) return;
    setSubmitting(true);
    try {
      const itemResult = confirm.result === "passed" ? "pass" : "fail";
      const items = (template?.items ?? []).map((item) => ({
        template_item_id: item.id,
        result: itemResult as "pass" | "fail" | "na",
      }));
      await submitInspection({
        room_id: confirm.room.room_id,
        template_id: template?.id,
        overall_result: confirm.result,
        notes: confirmNotes.trim() || undefined,
        items,
      });
      setQueue((prev) => prev.filter((room) => room.room_id !== confirm.room.room_id));
      setConfirm(null);
      // Pull the authoritative record (inspector name, timestamps) from the API.
      await load();
    } catch {
      Alert.alert(t("inspect.submitError"));
    } finally {
      setSubmitting(false);
    }
  }, [confirm, submitting, template, confirmNotes, t, load]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "queue", label: t("inspect.toInspect"), count: queue.length },
    { key: "done", label: t("inspect.doneTab"), count: records.length },
  ];

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        >
          <View style={styles.topBleed} />
          <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
            <Text style={styles.heroKicker}>{t("inspect.kicker")}</Text>
            <Text style={styles.heroTitle}>{t("inspect.title")}</Text>
            <Text style={styles.heroSummary}>
              {t("inspect.summary", { waiting: queue.length, passed: passedToday })}
            </Text>
            <HeroSignalRow signals={signals} />
          </View>

          <View style={styles.segmented}>
            {tabs.map((item) => {
              const isActive = tab === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.segment, isActive && styles.segmentActive]}
                  onPress={() => setTab(item.key)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
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
                <View style={styles.empty}>
                  <Ionicons name="shield-checkmark-outline" size={30} color={C.ink4} />
                  <Text style={styles.emptyTitle}>{t("inspect.queueEmpty")}</Text>
                  <Text style={styles.emptyHint}>{t("inspect.queueEmptyHint")}</Text>
                </View>
              ) : (
                queue.map((room) => (
                  <View key={room.room_id} style={styles.queueCard} testID={`inspect-${room.room_number}`}>
                    <View style={styles.queueRail} />
                    <View style={styles.queueBody}>
                      <Text style={styles.queueRoomNumber}>{room.room_number}</Text>
                      <Text style={styles.queueCleanedBy} numberOfLines={1}>{room.cleaned_by}</Text>
                      <Text style={styles.queueMeta}>
                        {t("inspect.doneAgo", { time: timeSince(room.cleaned_at) })}
                        {room.clean_type ? ` · ${room.clean_type}` : ""}
                      </Text>
                    </View>
                    <View style={styles.queueActions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.failBtn]}
                        onPress={() => openConfirm(room, "failed")}
                        activeOpacity={0.78}
                        accessibilityLabel={t("inspect.confirmFail")}
                      >
                        <Ionicons name="close" size={20} color={C.alert} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.passBtn]}
                        onPress={() => openConfirm(room, "passed")}
                        activeOpacity={0.78}
                        accessibilityLabel={t("inspect.confirmPass")}
                      >
                        <Ionicons name="checkmark" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )
            ) : records.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="moon-outline" size={30} color={C.ink4} />
                <Text style={styles.emptyTitle}>{t("inspect.noneDoneYet")}</Text>
                <Text style={styles.emptyHint}>{t("inspect.pullToRefresh")}</Text>
              </View>
            ) : (
              records.map((record) => {
                const meta = RESULT_META[record.overall_result] ?? RESULT_META.conditional;
                return (
                  <View key={record.id} style={styles.doneRow}>
                    <Text style={styles.doneRoomNumber}>{record.room_number}</Text>
                    <View style={styles.doneBody}>
                      <Text style={styles.doneInspector} numberOfLines={1}>{record.inspector_name}</Text>
                      <Text style={styles.doneTime}>{formatClock(record.completed_at)}</Text>
                    </View>
                    <View style={[styles.resultPill, { backgroundColor: meta.bg, borderColor: meta.line }]}>
                      <Text style={[styles.resultText, { color: meta.fg }]}>
                        {t(`inspect.result.${record.overall_result}`)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!confirm} animationType="slide" transparent onRequestClose={() => setConfirm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.grabber} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {confirm?.result === "passed"
                  ? t("inspect.modalTitlePass", { room: confirm?.room.room_number })
                  : t("inspect.modalTitleFail", { room: confirm?.room.room_number })}
              </Text>
              <TouchableOpacity onPress={() => setConfirm(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={C.ink3} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>{t("inspect.notesOptional")}</Text>
            <TextInput
              style={styles.notesInput}
              placeholder={
                confirm?.result === "failed"
                  ? t("inspect.failNotesPlaceholder")
                  : t("inspect.passNotesPlaceholder")
              }
              placeholderTextColor={C.ink4}
              value={confirmNotes}
              onChangeText={setConfirmNotes}
              multiline
              maxLength={500}
            />

            <View style={styles.confirmRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirm(null)}>
                <Text style={styles.cancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  confirm?.result === "passed" ? styles.confirmPass : styles.confirmFail,
                  submitting && styles.dimmed,
                ]}
                onPress={handleConfirm}
                disabled={submitting}
              >
                <Text style={styles.confirmText}>
                  {submitting
                    ? t("inspect.submitting")
                    : confirm?.result === "passed"
                      ? t("inspect.confirmPass")
                      : t("inspect.confirmFail")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: {
    color: shellTokens.ink3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { color: shellTokens.ink2, fontSize: 13, marginTop: 7 },

  segmented: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: C.surface3,
    borderRadius: R.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: R.md - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: C.ink,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { color: C.ink3, fontSize: 12.5, fontWeight: "700" },
  segmentLabelActive: { color: C.ink },

  body: { paddingHorizontal: 16, gap: 8 },

  queueCard: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    shadowColor: C.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  queueRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.info },
  queueBody: { flex: 1, minWidth: 0, gap: 2 },
  queueRoomNumber: { fontFamily: monoFont, fontSize: 24, lineHeight: 28, fontWeight: "800", color: C.ink },
  queueCleanedBy: { fontSize: 12.5, fontWeight: "700", color: C.ink2 },
  queueMeta: { fontSize: 11.5, color: C.ink3 },
  queueActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  passBtn: { backgroundColor: C.ready, borderColor: C.ready },
  failBtn: { backgroundColor: C.alertSoft, borderColor: C.alertLine },

  doneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  doneRoomNumber: { fontFamily: monoFont, fontSize: 18, fontWeight: "800", color: C.ink },
  doneBody: { flex: 1, minWidth: 0, gap: 1 },
  doneInspector: { fontSize: 12.5, fontWeight: "600", color: C.ink2 },
  doneTime: { fontSize: 11, color: C.ink3 },
  resultPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3.5 },
  resultText: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },

  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 32, gap: 7 },
  emptyTitle: { color: C.ink, fontSize: 15.5, fontWeight: "700", marginTop: 4 },
  emptyHint: { color: C.ink3, fontSize: 12.5, textAlign: "center", lineHeight: 18 },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    backgroundColor: C.paper,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.line,
    marginBottom: 14,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { fontSize: 20, fontWeight: "700", color: C.ink, flex: 1, marginRight: 12 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: C.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  notesInput: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: C.ink,
    minHeight: 84,
    textAlignVertical: "top",
  },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600", color: C.ink3 },
  confirmBtn: { flex: 2, minHeight: 46, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  confirmPass: { backgroundColor: C.ready },
  confirmFail: { backgroundColor: C.alert },
  confirmText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dimmed: { opacity: 0.5 },
});
