import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, displayFont } from "@/components/shared/tokens";
import { IconButton, Segmented } from "@/components/shared/mobileHandoff";
import { listItems, createLostFoundItem, listRooms, type LostFoundItem, type SimpleRoom } from "@/lib/api/lostFound";

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
  const [items, setItems] = useState<LostFoundItem[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch {
      setItems([]);
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
      .then((res) => setItems(res.data))
      .catch(() => setItems([]))
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
      Alert.alert("Error", "Could not log item. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [description, locationFound, selectedRoom, closeModal, load]);

  const filteredRooms = roomQuery.trim()
    ? rooms.filter((r) => r.room_number.toLowerCase().includes(roomQuery.toLowerCase()))
    : [];

  const unclaimed = items.filter((i) => i.status === "unclaimed").length;
  const claimed = items.filter((i) => i.status === "claimed").length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerMeta}>{items.length} item{items.length !== 1 ? "s" : ""} held</Text>
        <Text style={styles.title}>Lost & found</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        >
          <Segmented
            items={[
              { label: "All", count: items.length, active: activeTab === "all", onPress: () => handleTabChange("all") },
              { label: "Unclaimed", count: unclaimed, active: activeTab === "unclaimed", onPress: () => handleTabChange("unclaimed") },
              { label: "Claimed", count: claimed, active: activeTab === "claimed", onPress: () => handleTabChange("claimed") },
            ]}
          />

          <View style={styles.rows}>
            {items.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No items found</Text>
                <Text style={styles.emptySub}>Log a found item using the button below.</Text>
              </View>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.row}>
                  <IconButton
                    icon="cube-outline"
                    tone={item.status === "claimed" ? "ready" : item.status === "unclaimed" ? "caution" : "neutral"}
                    size={46}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{item.description}</Text>
                    <Text style={styles.rowSub}>
                      {item.location_found ?? item.rooms?.room_number ?? "Location unknown"} — {timeSince(item.created_at)}
                    </Text>
                    {item.claimed_by_name ? (
                      <Text style={styles.claimedBy}>Claimed by {item.claimed_by_name}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={C.ink4} />
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cta} onPress={openModal}>
          <Ionicons name="camera-outline" size={18} color={C.paper} />
          <Text style={styles.ctaText}>Log a found item</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log found item</Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={22} color={C.ink} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Description *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. iPhone charger, reading glasses..."
              placeholderTextColor={C.ink4}
              value={description}
              onChangeText={setDescription}
              maxLength={200}
            />

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Room (optional)</Text>
            {selectedRoom ? (
              <View style={styles.roomChip}>
                <Ionicons name="bed-outline" size={14} color={C.ink3} />
                <Text style={styles.roomChipText}>Room {selectedRoom.room_number}</Text>
                <TouchableOpacity onPress={() => { setSelectedRoom(null); setRoomQuery(""); }}>
                  <Ionicons name="close-circle" size={16} color={C.ink3} />
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <TextInput
                  style={styles.input}
                  placeholder="Search room number…"
                  placeholderTextColor={C.ink4}
                  value={roomQuery}
                  onChangeText={setRoomQuery}
                  keyboardType="numeric"
                  maxLength={10}
                />
                {filteredRooms.length > 0 && (
                  <View style={styles.roomDropdown}>
                    {filteredRooms.slice(0, 5).map((r) => (
                      <TouchableOpacity
                        key={r.id}
                        style={styles.roomOption}
                        onPress={() => { setSelectedRoom(r); setRoomQuery(""); }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.roomOptionNum}>Room {r.room_number}</Text>
                        {r.floor != null && (
                          <Text style={styles.roomOptionFloor}>Floor {r.floor}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Location found</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. lobby, pool area, hallway..."
              placeholderTextColor={C.ink4}
              value={locationFound}
              onChangeText={setLocationFound}
              maxLength={100}
            />

            <TouchableOpacity
              style={[styles.submitBtn, (!description.trim() || submitting) && styles.submitBtnDim]}
              onPress={handleSubmit}
              disabled={!description.trim() || submitting}
            >
              <Text style={styles.submitText}>{submitting ? "Logging…" : "Log item"}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line2 },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 120, gap: 13 },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  rowSub: { color: C.ink3, fontSize: 11.5, marginTop: 2 },
  claimedBy: { color: C.ready, fontSize: 11, marginTop: 3, fontWeight: "600" },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 26, backgroundColor: C.paper },
  cta: { minHeight: 46, borderRadius: 12, backgroundColor: C.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText: { color: C.paper, fontSize: 15, fontWeight: "700" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { backgroundColor: C.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontFamily: displayFont, fontSize: 22, color: C.ink },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.ink3, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.ink },
  roomChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  roomChipText: { flex: 1, fontSize: 14, fontWeight: "600", color: C.ink },
  roomDropdown: { marginTop: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  roomOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line2 },
  roomOptionNum: { fontSize: 14, fontWeight: "600", color: C.ink },
  roomOptionFloor: { fontSize: 12, color: C.ink3 },
  submitBtn: { marginTop: 20, minHeight: 46, borderRadius: 12, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" },
  submitBtnDim: { opacity: 0.4 },
  submitText: { color: C.paper, fontSize: 15, fontWeight: "700" },
});
