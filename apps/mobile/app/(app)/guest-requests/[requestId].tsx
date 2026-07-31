import { useCallback, useEffect, useState } from "react";
import {
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
import { R, monoFont } from "@/components/shared/tokens";
import { AIInsightCard, Pill, HeroButton } from "@/components/shared/mobileHandoff";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
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

const REQUEST_STATUS_BADGE_KEYS: Partial<Record<GuestRequest["status"], StatusKey>> = {
  in_progress: "inProgress",
  resolved: "completed",
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
  const theme = useTheme();
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
    return <StateBlock status="loading" style={[styles.center, { backgroundColor: theme.background }]} />;
  }

  if (!request) {
    return (
      <StateBlock
        status="error"
        errorIcon="alert-circle-outline"
        errorMessage="Request not found"
        onRetry={() => router.back()}
        retryLabel="Go back"
        style={[styles.center, { backgroundColor: theme.background }]}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.topBar,
          { backgroundColor: theme.background, borderBottomColor: theme.borderSubtle },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.primaryAction} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: theme.textPrimary }]}>Request Detail</Text>
        {REQUEST_STATUS_BADGE_KEYS[request.status] ? (
          <StatusBadge
            statusKey={REQUEST_STATUS_BADGE_KEYS[request.status]!}
            label={STATUS_LABELS[request.status] ?? request.status}
          />
        ) : (
          <Pill tone={STATUS_TONES[request.status] ?? "neutral"}>
            {STATUS_LABELS[request.status] ?? request.status}
          </Pill>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Card style={styles.cardLayoutOverrides}>
          <View style={styles.cardHeader}>
            <Text style={[styles.roomLabel, { color: theme.textPrimary }]}>Room {request.room_number}</Text>
            {request.guest_name ? (
              <Text style={[styles.guestName, { color: theme.textMuted }]}>
                {request.guest_name}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.requestType, { color: theme.textPrimary }]}>{request.request_type}</Text>
          <Text style={[styles.description, { color: theme.textSecondary }]}>{request.description}</Text>
          <View style={styles.meta}>
            <Text style={[styles.metaText, { color: theme.textDisabled }]}>{timeAgo(request.created_at)}</Text>
            {request.assigned_to_name ? (
              <Text style={[styles.metaText, { color: theme.textDisabled }]}>
                Assigned to {request.assigned_to_name}
              </Text>
            ) : null}
          </View>
        </Card>

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
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>Update Status</Text>
            <View style={styles.statusRow}>
              {STATUS_OPTIONS.map((s) => (
                <Button
                  key={s}
                  label={STATUS_LABELS[s]}
                  style={styles.statusBtn}
                  onPress={() => setSelectedStatus(s)}
                  variant={selectedStatus === s ? "primary" : "secondary"}
                  size="sm"
                />
              ))}
            </View>

            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>Assign To</Text>
            <Button
              label={request.assigned_to_name ?? "Select staff member"}
              style={styles.assignButton}
              onPress={() => setShowStaffPicker(!showStaffPicker)}
              variant="secondary"
              size="sm"
              icon={showStaffPicker ? "chevron-up" : "chevron-down"}
            />
            {showStaffPicker ? (
              <View style={[styles.staffList, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {staff.map((member) => (
                  <Button
                    key={member.id}
                    label={member.full_name}
                    style={[styles.staffItem, { borderBottomColor: theme.border }]}
                    onPress={() => {
                      setShowStaffPicker(false);
                      saveUpdate(undefined, member.id);
                    }}
                    variant="ghost"
                    size="sm"
                  />
                ))}
              </View>
            ) : null}

            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>Resolution Notes</Text>
            <TextInput
              style={[
                styles.notesInput,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  color: theme.textPrimary,
                },
              ]}
              value={resolutionNotes}
              onChangeText={setResolutionNotes}
              placeholder="Describe what was done..."
              placeholderTextColor={theme.textDisabled}
              multiline
              numberOfLines={3}
            />

            <Button label="Save Update" onPress={() => saveUpdate()} loading={saving} size="md" />
          </>
        ) : (
          <Card
            style={[
              styles.cardLayoutOverrides,
              {
                backgroundColor: theme.status.readySoft,
                borderColor: theme.status.readyLine,
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={theme.status.ready} />
            <Text style={[styles.requestType, { color: theme.status.ready }]}>Resolved</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  backBtn: { padding: 2 },
  topBarTitle: { flex: 1, fontSize: 16, fontWeight: "700" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 14 },
  cardLayoutOverrides: {
    padding: 14,
    gap: 6,
  },
  cardHeader: { gap: 2 },
  roomLabel: { fontSize: 15, fontWeight: "700" },
  guestName: { fontSize: 12 },
  requestType: { fontSize: 15, fontWeight: "600" },
  description: { fontSize: 13, lineHeight: 19 },
  meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  metaText: { fontSize: 11, fontFamily: monoFont },
  sectionTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  statusRow: { flexDirection: "row", gap: 8 },
  statusBtn: {
    flex: 1,
    paddingHorizontal: 8,
  },
  assignButton: {
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  staffList: {
    borderWidth: 1,
    borderRadius: R.md,
    overflow: "hidden",
  },
  staffItem: {
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    justifyContent: "flex-start",
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: "top",
  },
});
