import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { fetchInspectionDetail, type InspectionDetail } from "@/lib/api/inspections";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { DoneItem } from "@/lib/inspections/lists";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";
import { resultLabel } from "@/components/supervisor/inspect/DoneRow";

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; detail: InspectionDetail };

/**
 * What the app already knows about a finished inspection: the row from today's list straight away, then the server's
 * record of it (failed items, correction) once it loads. It shows nothing it was not told; the full history view is a
 * later phase.
 */
export function InspectionRecordSheet({
  record,
  timeZone,
  language,
  t,
  onViewRoom,
  onClose,
}: {
  record: DoneItem | null;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  onViewRoom: (roomId: string, roomNumber: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: "loading" });
  const latest = useRef<string | null>(null);

  const load = useCallback((id: string) => {
    latest.current = id;
    setState({ status: "loading" });
    fetchInspectionDetail(id).then(
      (detail) => {
        if (latest.current === id) setState({ status: "ready", detail });
      },
      () => {
        if (latest.current === id) setState({ status: "failed" });
      },
    );
  }, []);

  useEffect(() => {
    if (record) load(record.id);
    else latest.current = null;
  }, [record, load]);

  const clock = record?.completedAtMs ? formatHotelTime(new Date(record.completedAtMs), timeZone, language) : null;
  const failedItems = state.status === "ready" ? state.detail.items.filter((item) => item.result === "fail") : [];
  const correction = state.status === "ready" ? state.detail.correction : null;

  return (
    <Modal visible={record !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("inspect.record.close")} />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(20, insets.bottom + 8) }]} accessibilityViewIsModal testID="inspect-record-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          {record ? (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.header}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
                  {t("inspect.detail.title", { room: record.roomNumber })}
                </Text>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("inspect.record.close")} style={styles.close} testID="inspect-record-close">
                  <Ionicons name="close" size={24} color={theme.textMuted} />
                </Pressable>
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.result, { color: theme.textPrimary }]}>
                {resultLabel(record.result, t)}
                {record.isReinspection ? ` · ${t("inspect.done.reinspection")}` : ""}
              </Text>
              <Fact label={t("inspect.record.inspector")} value={record.inspectorName ?? t("inspect.done.inspectorUnknown")} />
              <Fact label={t("inspect.record.completed")} value={clock ?? "—"} />
              {record.notes ? <Fact label={t("inspect.record.notes")} value={record.notes} /> : null}

              {state.status === "loading" ? (
                <View style={styles.row} accessibilityLabel={t("inspect.record.loading")}>
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
                  <Button label={t("inspect.record.retry")} variant="secondary" size="sm" onPress={() => load(record.id)} />
                </View>
              ) : record.result !== "passed" ? (
                <View style={styles.block} testID="inspect-record-failed-items">
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
                    {t("inspect.record.failedItems")}
                  </Text>
                  {failedItems.length === 0 ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                      {t("inspect.record.noFailedItems")}
                    </Text>
                  ) : (
                    failedItems.map((item, index) => (
                      <Text key={item.template_item_id ?? index} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
                        • {item.description ?? item.note ?? "—"}
                      </Text>
                    ))
                  )}
                </View>
              ) : null}

              {correction ? <Fact label={t("inspect.record.correction")} value={t(`inspect.correction.detail.${correction.status}`)} /> : null}

              {record.roomId ? (
                <Button
                  label={t("inspect.record.viewRoom")}
                  variant="secondary"
                  size="md"
                  onPress={() => onViewRoom(record.roomId as string, record.roomNumber)}
                  style={styles.viewRoom}
                  testID="inspect-record-view-room"
                />
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "85%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 8, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", fontFamily: monoFont },
  close: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  result: { fontSize: 16, fontWeight: "800" },
  fact: { gap: 2 },
  label: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  value: { fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  block: { gap: 6 },
  muted: { fontSize: 13.5, fontWeight: "600" },
  viewRoom: { marginTop: 6, borderRadius: R.md },
});
