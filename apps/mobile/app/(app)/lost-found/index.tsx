import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { displayFont } from "@/components/shared/tokens";
import { IconButton, Segmented } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { listItems, createLostFoundItem, listRooms, type LostFoundItem, type SimpleRoom } from "@/lib/api/lostFound";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

type Tab = "all" | "unclaimed" | "claimed";

const TAB_STATUS: Record<Tab, string | undefined> = {
  all: undefined,
  unclaimed: "unclaimed",
  claimed: "claimed",
};

function timeSince(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export default function LostFoundScreen() {
  const theme = useTheme();
  const toast = useToast();
  const [items, setItems] = useState<LostFoundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState("");
  const [locationFound, setLocationFound] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [rooms, setRooms] = useState<SimpleRoom[]>([]);
  const [roomQuery, setRoomQuery] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<SimpleRoom | null>(null);
  const roomsLoaded = useRef(false);

  const load = useCallback(async (tab: Tab = activeTab) => {
    try {
      const res = await listItems(TAB_STATUS[tab]);
      setItems(res.data);
      setLoadError(false);
    } catch {
      setItems([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setLoading(true);
    listItems(TAB_STATUS[tab])
      .then((res) => {
        setItems(res.data);
        setLoadError(false);
      })
      .catch(() => {
        setItems([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const openModal = useCallback(async () => {
    setModalVisible(true);
    if (!roomsLoaded.current) {
      try {
        const res = await listRooms();
        setRooms(res.data.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })));
        roomsLoaded.current = true;
      } catch {
        // rooms optional — silently ignore
      }
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setDescription("");
    setLocationFound("");
    setSelectedRoom(null);
    setRoomQuery("");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      await createLostFoundItem({
        description: description.trim(),
        location_found: locationFound.trim() || undefined,
        room_id: selectedRoom?.id || undefined,
      });
      closeModal();
      load();
    } catch {
      toast.error("Could not log item. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [description, locationFound, selectedRoom, closeModal, load, toast]);

  const filteredRooms = roomQuery.trim()
    ? rooms.filter((r) => r.room_number.toLowerCase().includes(roomQuery.toLowerCase()))
    : [];

  const unclaimed = items.filter((i) => i.status === "unclaimed").length;
  const claimed = items.filter((i) => i.status === "claimed").length;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{items.length} item{items.length !== 1 ? "s" : ""} held</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Lost & found</Text>
      </View>

      {loading ? (
        <StateBlock status="loading" style={styles.center} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        >
          <Segmented
            items={[
              { label: "All", count: items.length, active: activeTab === "all", onPress: () => handleTabChange("all") },
              { label: "Unclaimed", count: unclaimed, active: activeTab === "unclaimed", onPress: () => handleTabChange("unclaimed") },
              { label: "Claimed", count: claimed, active: activeTab === "claimed", onPress: () => handleTabChange("claimed") },
            ]}
          />

          <View style={styles.rows}>
            {loadError ? (
              <StateBlock
                status="error"
                errorIcon="cloud-offline-outline"
                errorMessage="Could not load found items."
                onRetry={() => void load()}
                retryLabel="Try again"
                style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}
              />
            ) : items.length === 0 ? (
              <StateBlock
                status="empty"
                emptyIcon="cube-outline"
                emptyTitle="No items found"
                emptyBody="Log a found item using the button below."
                style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}
              />
            ) : (
              items.map((item) => (
                <Card key={item.id} style={styles.row}>
                  <IconButton
                    icon="cube-outline"
                    tone={item.status === "claimed" ? "ready" : item.status === "unclaimed" ? "caution" : "neutral"}
                    size={46}
                  />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{item.description}</Text>
                    <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                      {item.location_found ?? item.rooms?.room_number ?? "Location unknown"} — {timeSince(item.created_at)}
                    </Text>
                    {item.claimed_by_name ? (
                      <Text style={[styles.claimedBy, { color: theme.status.ready }]}>Claimed by {item.claimed_by_name}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
                </Card>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <View style={[styles.footer, { backgroundColor: theme.background }]}>
        <Button label="Log a found item" onPress={() => void openModal()} icon="camera-outline" />
      </View>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: theme.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Log found item</Text>
              <Pressable onPress={closeModal} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={theme.textPrimary} />
              </Pressable>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Description *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
              placeholder="e.g. iPhone charger, reading glasses..."
              placeholderTextColor={theme.textDisabled}
              value={description}
              onChangeText={setDescription}
              maxLength={200}
            />

            <Text style={[styles.fieldLabel, { marginTop: 12, color: theme.textMuted }]}>Room (optional)</Text>
            {selectedRoom ? (
              <View style={[styles.roomChip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Ionicons name="bed-outline" size={14} color={theme.textMuted} />
                <Text style={[styles.roomChipText, { color: theme.textPrimary }]}>Room {selectedRoom.room_number}</Text>
                <Pressable onPress={() => { setSelectedRoom(null); setRoomQuery(""); }} accessibilityRole="button" accessibilityLabel="Clear room">
                  <Ionicons name="close-circle" size={16} color={theme.textMuted} />
                </Pressable>
              </View>
            ) : (
              <View>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
                  placeholder="Search room number…"
                  placeholderTextColor={theme.textDisabled}
                  value={roomQuery}
                  onChangeText={setRoomQuery}
                  keyboardType="numeric"
                  maxLength={10}
                />
                {filteredRooms.length > 0 && (
                  <View style={[styles.roomDropdown, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    {filteredRooms.slice(0, 5).map((r) => (
                      <Pressable
                        key={r.id}
                        style={[styles.roomOption, { borderBottomColor: theme.borderSubtle }]}
                        onPress={() => { setSelectedRoom(r); setRoomQuery(""); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Room ${r.room_number}`}
                      >
                        <Text style={[styles.roomOptionNum, { color: theme.textPrimary }]}>Room {r.room_number}</Text>
                        {r.floor != null && (
                          <Text style={[styles.roomOptionFloor, { color: theme.textMuted }]}>Floor {r.floor}</Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 12, color: theme.textMuted }]}>Location found</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
              placeholder="e.g. lobby, pool area, hallway..."
              placeholderTextColor={theme.textDisabled}
              value={locationFound}
              onChangeText={setLocationFound}
              maxLength={100}
            />

            <Button
              label="Log item"
              onPress={() => void handleSubmit()}
              loading={submitting}
              disabled={!description.trim()}
              style={styles.submitBtn}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, borderBottomWidth: 1 },
  headerMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 34 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 120, gap: 13 },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13.5, fontWeight: "600" },
  rowSub: { fontSize: 11.5, marginTop: 2 },
  claimedBy: { fontSize: 11, marginTop: 3, fontWeight: "600" },
  empty: { borderWidth: 1, borderRadius: 12 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 26 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontFamily: displayFont, fontSize: 22 },
  fieldLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  roomChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  roomChipText: { flex: 1, fontSize: 14, fontWeight: "600" },
  roomDropdown: { marginTop: 4, borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  roomOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1 },
  roomOptionNum: { fontSize: 14, fontWeight: "600" },
  roomOptionFloor: { fontSize: 12 },
  submitBtn: { marginTop: 20 },
});
