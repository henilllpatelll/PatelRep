import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont } from "@/components/shared/tokens";
import { AIInsightCard, Pill, HeroButton } from "@/components/shared/mobileHandoff";
import type { GuestRequest } from "./index";

type StaffMember = { id: string; full_name: string };

const STATUS_OPTIONS = ["new", "in_progress", "resolved"] as const;
type StatusOption = typeof STATUS_OPTIONS[number];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_progress: "In Progress",
  resolved: "Resolved",
  escalated: "Escalated",
};

type ToneType = "alert" | "caution" | "ready" | "info" | "neutral" | "progress";

const STATUS_TONES: Record<string, ToneType> = {
  new: "info",
  in_progress: "progress",
  resolved: "ready",
  escalated: "alert",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function GuestRequestDetailScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { isOnline } = useAppStore();
  const [request, setRequest] = useState<GuestRequest | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<StatusOption>("new");
  const [showStaffPicker, setShowStaffPicker] = useState(false);

  const loadRequest = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const [reqRes, staffRes] = await Promise.all([
        api.get<{ data: GuestRequest }>(`/guest-requests/${requestId}`),
        api.get<{ data: StaffMember[] }>("/staff?role=front_desk,housekeeping_supervisor,gm"),
      ]);
      setRequest(reqRes.data);
      setSelectedStatus((reqRes.data?.status as StatusOption) ?? "new");
      setStaff(staffRes.data ?? []);
    } catch {
      setRequest(null);
    } finally {
      setLoading(false);
    }
  }, [isOnline, requestId]);

  useEffect(() => { loadRequest(); }, [loadRequest]);

  const saveUpdate = async (overrideStatus?: StatusOption, assignedTo?: string) => {
    if (!request) return;
    setSaving(true);
    try {
      await api.patch(`/guest-requests/${request.id}`, {
        status: overrideStatus ?? selectedStatus,
        ...(resolutionNotes ? { resolution_notes: resolutionNotes } : {}),
        ...(assignedTo ? { assigned_to: assignedTo } : {}),
      });
      await loadRequest();
    } catch {
      // show nothing — reload handles it
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!request) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={32} color={C.ink4} />
        <Text style={styles.emptyTitle}>Request not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={C.accent} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Request Detail</Text>
        <Pill tone={STATUS_TONES[request.status] ?? "neutral"}>
          {STATUS_LABELS[request.status] ?? request.status}
        </Pill>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.roomLabel}>Room {request.room_number}</Text>
            {request.guest_name ? <Text style={styles.guestName}>{request.guest_name}</Text> : null}
          </View>
          <Text style={styles.requestType}>{request.request_type}</Text>
          <Text style={styles.description}>{request.description}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaText}>{timeAgo(request.created_at)}</Text>
            {request.assigned_to_name ? (
              <Text style={styles.metaText}>Assigned to {request.assigned_to_name}</Text>
            ) : null}
          </View>
        </View>

        <AIInsightCard
          title="AI recovery"
          compact
          actions={
            <HeroButton onDark={false} onPress={() => router.push("/(app)/copilot")}>
              Ask AI
            </HeroButton>
          }
        >
          {request.status === "escalated"
            ? "Assign ownership first, then update the guest before closing the loop."
            : "Fastest path: assign a clear owner and keep the resolution note short."}
        </AIInsightCard>

        {request.status !== "resolved" ? (
          <>
            <Text style={styles.sectionTitle}>Update Status</Text>
            <View style={styles.statusRow}>
              {STATUS_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusBtn, selectedStatus === s && styles.statusBtnActive]}
                  onPress={() => setSelectedStatus(s)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.statusLabel, selectedStatus === s && styles.statusLabelActive]}>
                    {STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Assign To</Text>
            <TouchableOpacity
              style={styles.assignRow}
              onPress={() => setShowStaffPicker(!showStaffPicker)}
              activeOpacity={0.75}
            >
              <Text style={styles.assignLabel}>
                {request.assigned_to_name ?? "Select staff member"}
              </Text>
              <Ionicons name={showStaffPicker ? "chevron-up" : "chevron-down"} size={14} color={C.ink4} />
            </TouchableOpacity>
            {showStaffPicker ? (
              <View style={styles.staffList}>
                {staff.map((member) => (
                  <TouchableOpacity
                    key={member.id}
                    style={styles.staffItem}
                    onPress={() => { setShowStaffPicker(false); saveUpdate(undefined, member.id); }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.staffName}>{member.full_name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Resolution Notes</Text>
            <TextInput
              style={styles.notesInput}
              value={resolutionNotes}
              onChangeText={setResolutionNotes}
              placeholder="Describe what was done..."
              placeholderTextColor={C.ink4}
              multiline
              numberOfLines={3}
            />

            <HeroButton primary onPress={() => saveUpdate()}>
              {saving ? "Saving..." : "Save Update"}
            </HeroButton>
          </>
        ) : (
          <View style={[styles.card, { backgroundColor: C.readySoft, borderColor: C.readyLine }]}>
            <Ionicons name="checkmark-circle" size={20} color={C.ready} />
            <Text style={[styles.requestType, { color: C.ready }]}>Resolved</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper, gap: 10 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    backgroundColor: C.paper,
    gap: 10,
  },
  backBtn: { padding: 2 },
  topBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: C.ink },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 14 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 14,
    gap: 6,
  },
  cardHeader: { gap: 2 },
  roomLabel: { fontSize: 15, fontWeight: "700", color: C.ink },
  guestName: { fontSize: 12, color: C.ink3 },
  requestType: { fontSize: 15, fontWeight: "600", color: C.ink },
  description: { fontSize: 13, color: C.ink2, lineHeight: 19 },
  meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  metaText: { fontSize: 11, color: C.ink4, fontFamily: monoFont },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: C.ink3, textTransform: "uppercase", letterSpacing: 0.8 },
  statusRow: { flexDirection: "row", gap: 8 },
  statusBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
  },
  statusBtnActive: { backgroundColor: C.ink, borderColor: C.ink },
  statusLabel: { fontSize: 12, fontWeight: "600", color: C.ink3 },
  statusLabelActive: { color: C.paper },
  assignRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  assignLabel: { fontSize: 13, color: C.ink2 },
  staffList: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    overflow: "hidden",
  },
  staffItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  staffName: { fontSize: 13, color: C.ink },
  notesInput: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: C.ink,
    minHeight: 80,
    textAlignVertical: "top",
  },

  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  backLink: { fontSize: 14, color: C.accent, fontWeight: "600" },
});
