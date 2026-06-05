import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, displayFont } from "@/components/shared/tokens";
import {
  HandoffRow,
  IconButton,
  Mono,
  RoomNumberTile,
  Segmented,
} from "@/components/shared/mobileHandoff";
import { api } from "@/lib/api/client";
import { listInspectionTemplates, submitInspection } from "@/lib/api/inspections";

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

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeSince(iso: string | null): string {
  if (!iso) return "recently";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}

type Tab = "queue" | "passed";

export default function InspectScreen() {
  const [queue, setQueue] = useState<ReadyRoom[]>([]);
  const [passed, setPassed] = useState<InspectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("queue");
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<{ room: ReadyRoom; result: "passed" | "failed" } | null>(null);
  const [confirmNotes, setConfirmNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const today = localDate();
      const [queueRes, passedRes, templatesRes] = await Promise.allSettled([
        api.get<{ data: ReadyRoom[] }>(`/housekeeping/ready-for-inspection?date=${today}`),
        api.get<{ data: InspectionRecord[] }>(`/housekeeping/inspections?date_from=${today}&date_to=${today}`),
        listInspectionTemplates(),
      ]);
      if (queueRes.status === "fulfilled") setQueue(queueRes.value.data);
      if (passedRes.status === "fulfilled") setPassed(passedRes.value.data);
      if (templatesRes.status === "fulfilled" && templatesRes.value.data.length > 0) {
        setTemplateId(templatesRes.value.data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openConfirm = useCallback((room: ReadyRoom, result: "passed" | "failed") => {
    setConfirm({ room, result });
    setConfirmNotes("");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirm || submitting) return;
    setSubmitting(true);
    try {
      await submitInspection({
        room_id: confirm.room.room_id,
        template_id: templateId,
        overall_result: confirm.result,
        notes: confirmNotes.trim() || undefined,
      });
      setQueue((prev) => prev.filter((r) => r.room_id !== confirm.room.room_id));
      if (confirm.result === "passed") {
        setPassed((prev) => [
          {
            id: confirm.room.room_id + "-" + Date.now(),
            room_number: confirm.room.room_number,
            inspector_name: "You",
            overall_result: "passed",
            completed_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
      setConfirm(null);
    } catch {
      Alert.alert("Error", "Could not submit inspection. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [confirm, submitting, templateId, confirmNotes]);

  const displayList = activeTab === "queue" ? queue : passed;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <IconButton icon="filter-outline" />
        <Text style={styles.headerMeta}>{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</Text>
        <Text style={styles.title}>Inspections</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        >
          <View style={styles.summary}>
            <View style={styles.summaryCell}>
              <View style={styles.summaryLine}>
                <Text style={styles.summaryValue}>{passed.length}</Text>
                <Text style={styles.summaryLabel}>passed</Text>
              </View>
              <Text style={styles.summarySub}>today</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryCell}>
              <View style={styles.summaryLine}>
                <Text style={styles.summaryValue}>{queue.length}</Text>
                <Text style={styles.summaryLabel}>in queue</Text>
              </View>
              <Text style={[styles.summarySub, queue.length > 0 ? { color: C.caution } : { color: C.ready }]}>
                {queue.length > 0 ? "waiting" : "all clear"}
              </Text>
            </View>
          </View>

          <Segmented
            items={[
              { label: "To inspect", count: queue.length, active: activeTab === "queue", onPress: () => setActiveTab("queue") },
              { label: "Passed", count: passed.length, active: activeTab === "passed", onPress: () => setActiveTab("passed") },
            ]}
          />

          <View style={styles.rows}>
            {displayList.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{activeTab === "queue" ? "Queue is empty" : "No passed rooms yet"}</Text>
                <Text style={styles.emptySub}>Pull to refresh.</Text>
              </View>
            ) : activeTab === "queue" ? (
              (displayList as ReadyRoom[]).map((room) => (
                <View key={room.room_id} style={styles.rowWrap}>
                  <HandoffRow
                    lead={<RoomNumberTile roomNumber={room.room_number} status="CLEAN" size={48} />}
                    title={<Text style={styles.rowTitle}>{room.cleaned_by}</Text>}
                    sub={`Done ${timeSince(room.cleaned_at)}${room.clean_type ? ` — ${room.clean_type}` : ""}`}
                    right={
                      <View style={styles.actions}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.passBtn]}
                          onPress={() => openConfirm(room, "passed")}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="checkmark" size={18} color={C.ready} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.failBtn]}
                          onPress={() => openConfirm(room, "failed")}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="close" size={18} color={C.alert} />
                        </TouchableOpacity>
                      </View>
                    }
                  />
                </View>
              ))
            ) : (
              (displayList as InspectionRecord[]).map((rec) => (
                <HandoffRow
                  key={rec.id}
                  lead={<RoomNumberTile roomNumber={rec.room_number} status="INSPECTED" size={48} />}
                  title={<Text style={styles.rowTitle}>Room {rec.room_number}</Text>}
                  sub={`${rec.inspector_name} — ${rec.overall_result}`}
                  right={<Ionicons name="checkmark-circle" size={20} color={C.ready} />}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!confirm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {confirm?.result === "passed" ? "Pass" : "Fail"} Room {confirm?.room.room_number}?
              </Text>
              <TouchableOpacity onPress={() => setConfirm(null)}>
                <Ionicons name="close" size={22} color={C.ink} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder={confirm?.result === "failed" ? "Describe what needs attention…" : "Any observations…"}
              placeholderTextColor={C.ink4}
              value={confirmNotes}
              onChangeText={setConfirmNotes}
              multiline
              maxLength={500}
            />

            <View style={styles.confirmRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirm(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
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
                  {submitting ? "Submitting…" : confirm?.result === "passed" ? "Confirm Pass" : "Confirm Fail"}
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
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, backgroundColor: C.paper, borderBottomWidth: 1, borderBottomColor: C.line2 },
  headerMeta: { marginTop: 8, color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24, gap: 13 },
  summary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 18 },
  summaryCell: { flex: 1 },
  summaryLine: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  summaryValue: { fontFamily: displayFont, fontSize: 30, lineHeight: 32, color: C.ink },
  summaryLabel: { fontSize: 12, color: C.ink3 },
  summarySub: { fontSize: 11.5, color: C.ink3, marginTop: 4 },
  divider: { width: 1, alignSelf: "stretch", backgroundColor: C.line2 },
  rows: { gap: 8 },
  rowWrap: {},
  rowTitle: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 6 },
  actionBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  passBtn: { backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.25)" },
  failBtn: { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { backgroundColor: C.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontFamily: displayFont, fontSize: 22, color: C.ink, flex: 1, marginRight: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.ink3, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.ink },
  notesInput: { minHeight: 80, textAlignVertical: "top" },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontWeight: "600", color: C.ink3 },
  confirmBtn: { flex: 2, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  confirmPass: { backgroundColor: C.ready },
  confirmFail: { backgroundColor: C.alert },
  confirmText: { fontSize: 15, fontWeight: "700", color: C.paper },
  dimmed: { opacity: 0.5 },
});
