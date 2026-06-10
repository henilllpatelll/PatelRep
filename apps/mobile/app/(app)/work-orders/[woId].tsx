import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { enqueueAction } from "@/lib/offline/db";
import { useAppStore } from "@/stores/appStore";
import { C } from "@/components/shared/tokens";
import { Avatar, CopilotHero, HeroButton, IconButton, Mono, Pill, SectionLabel } from "@/components/shared/mobileHandoff";

type WorkOrder = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  room_number?: string;
  location_detail?: string;
  photos?: string[];
};

const STEPS = [
  { label: "Power off unit - LOTO applied", done: true },
  { label: "Remove access panel", done: true },
  { label: "Belt removed (photo)", done: true },
  { label: "Install new belt", now: true },
  { label: "Verify tension" },
  { label: "Power on - test airflow" },
];

export default function WorkOrderDetailScreen() {
  const { woId } = useLocalSearchParams<{ woId: string }>();
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [completionNotes, setCompletionNotes] = useState("");
  const [photos] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    let mounted = true;

    api
      .get<WorkOrder>(`/work-orders/${woId}`)
      .then((wo) => {
        if (mounted) setWorkOrder(wo);
      })
      .catch(() => {
        if (mounted) setWorkOrder(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [woId]);

  async function completeWorkOrder() {
    if (!workOrder) return;
    setCompleting(true);

    try {
      if (isOnline) {
        await api.post(`/work-orders/${workOrder.id}/complete`, {
          completion_notes: completionNotes,
          photo_urls: photos,
        });
        Alert.alert(t("workOrders.completedTitle"), t("workOrders.completedMessage"), [{ text: "OK", onPress: () => router.back() }]);
      } else {
        await enqueueAction("work_order", "complete", { completion_notes: completionNotes }, workOrder.id);
        setWorkOrder({ ...workOrder, status: "completed" });
        Alert.alert(t("common.offline"), "Will sync when back online.");
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!workOrder) {
    return (
      <View style={styles.center}>
        <Text>{t("common.error")}</Text>
      </View>
    );
  }

  const priorityTone = workOrder.priority === "emergency" || workOrder.priority === "urgent" ? "alert" : "caution";
  const location = workOrder.room_number
    ? `R-${workOrder.room_number}${workOrder.location_detail ? ` - ${workOrder.location_detail}` : ""}`
    : workOrder.location_detail ?? "Property";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={C.ink} />
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>{workOrder.id}</Text>
          <Text style={styles.headerSub}>{t("workOrders.inProgressTime", { time: "22m" })}</Text>
        </View>
        <Pill tone={priorityTone}>{workOrder.priority.toUpperCase()}</Pill>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.title}>{workOrder.title}</Text>
          <View style={styles.locationLine}>
            <Ionicons name="location-outline" size={13} color={C.ink3} />
            <Mono style={styles.locationText}>{location}</Mono>
            <View style={styles.dot} />
            <Avatar name="Dev Patel" size={18} />
            <Text style={styles.locationText}>You</Text>
          </View>
        </View>

        <CopilotHero
          tone="violet"
          kicker={t("workOrders.insight")}
          confidence={88}
          actions={
            <HeroButton onDark={false} primary icon="add">
              Create 2 linked WOs
            </HeroButton>
          }
        >
          <Text>
            Same zone as WO-1140. Recommend a pre-emptive belt swap on adjacent units <Text style={styles.heroStrong}>211 and 213</Text> while you are in there.
          </Text>
        </CopilotHero>

        <View>
          <SectionLabel hint={t("workOrders.stepsHint", { done: 3, total: 6 })}>{t("workOrders.steps")}</SectionLabel>
          <View style={styles.steps}>
            {STEPS.map((step, index) => (
              <View key={step.label} style={[styles.step, index > 0 && styles.stepBorder, step.now && styles.nowStep]}>
                <View style={[styles.checkbox, step.done && styles.checked, step.now && styles.nowBox]}>
                  {step.done ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                </View>
                <Text style={[styles.stepTitle, step.done && styles.doneText]}>{step.label}</Text>
                {step.now ? <Pill tone="accent">now</Pill> : null}
              </View>
            ))}
          </View>
        </View>

        <View>
          <SectionLabel>{t("workOrders.partsUsed")}</SectionLabel>
          <View style={styles.partCard}>
            <IconButton icon="cube-outline" size={40} />
            <View style={styles.partBody}>
              <Text style={styles.partTitle}>Fan-coil belt - A-4L360</Text>
              <Text style={styles.partSub}>2 in stock after this</Text>
            </View>
            <Mono style={styles.partQty}>x1</Mono>
          </View>
        </View>

        {workOrder.status === "in_progress" ? (
          <View>
            <SectionLabel>{t("workOrders.notes")}</SectionLabel>
            <TextInput
              testID="completion-notes"
              style={styles.notesInput}
              multiline
              numberOfLines={4}
              placeholder={t("workOrders.completionPlaceholder")}
              placeholderTextColor={C.ink4}
              value={completionNotes}
              onChangeText={setCompletionNotes}
            />
          </View>
        ) : null}
      </ScrollView>

      {workOrder.status === "in_progress" ? (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.completeButton} onPress={completeWorkOrder} disabled={completing}>
            {completing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.completeText}>{t("workOrders.complete")}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, backgroundColor: C.paper, borderBottomWidth: 1, borderBottomColor: C.line2 },
  backButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1 },
  headerTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  headerSub: { color: C.ink3, fontSize: 11.5, marginTop: 2 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 120, gap: 14 },
  title: { color: C.ink, fontSize: 27, fontWeight: "600", lineHeight: 31 },
  locationLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  locationText: { color: C.ink3, fontSize: 12.5 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.ink4 },
  heroStrong: { fontStyle: "normal", fontWeight: "700", color: C.ink },
  steps: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden" },
  step: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14, paddingVertical: 13 },
  stepBorder: { borderTopWidth: 1, borderTopColor: C.line2 },
  nowStep: { backgroundColor: C.accentSoft },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: C.ready, borderColor: C.ready },
  nowBox: { borderWidth: 2, borderColor: C.accent },
  stepTitle: { flex: 1, color: C.ink, fontSize: 14 },
  doneText: { textDecorationLine: "line-through", color: C.ink2 },
  partCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  partBody: { flex: 1 },
  partTitle: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  partSub: { color: C.ink3, fontSize: 11.5, marginTop: 2 },
  partQty: { color: C.ink2, fontSize: 12 },
  notesInput: { minHeight: 92, textAlignVertical: "top", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, color: C.ink, fontSize: 14 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 26, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line },
  completeButton: { minHeight: 52, borderRadius: 13, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  completeText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
