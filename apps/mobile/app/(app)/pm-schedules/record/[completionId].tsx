import { useCallback, useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { getPmCompletion, type PmCompletionDetail, type PmCompletionEvidence } from "@/lib/api/pm";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import { formatDueDate } from "@/lib/engineering/pmSchedules";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

function Evidence({ items }: { items: readonly PmCompletionEvidence[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={styles.thumbs}>
      {items.map((e) => (
        <Pressable
          key={e.evidence_id}
          onPress={() => void Linking.openURL(e.url)}
          style={[styles.thumb, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
          accessibilityRole="imagebutton"
          accessibilityLabel={e.file_name ?? t("pm.photo.attached")}
        >
          <Image source={{ uri: e.url }} style={styles.thumbImage} />
        </Pressable>
      ))}
    </View>
  );
}

/** A recorded inspection, read-only, exactly as it was stored - with the checklist items and version it was done against. */
export default function PmRecordScreen() {
  const { completionId, scheduleId } = useLocalSearchParams<{ completionId: string; scheduleId: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const [record, setRecord] = useState<PmCompletionDetail | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!completionId || !scheduleId) return;
    setLoading(true);
    try {
      setRecord(await getPmCompletion(scheduleId, completionId));
      setFailure(null);
    } catch (err) {
      setFailure(classifyLoadFailure(err));
    } finally {
      setLoading(false);
    }
  }, [completionId, scheduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const date = record ? formatDueDate(hotelDateKey(record.completed_at, hotelTimezone), i18n.language) : null;
  const status = loading ? "loading" : failure ? (failure === "forbidden" ? "forbidden" : failure === "offline" ? "offline" : "error") : record ? "ready" : "empty";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="pm-record-back">
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerTitle, { color: theme.shell.ink }]} accessibilityRole="header">
          {t("pm.record.title")}
        </Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <EngineeringState status={status} onRetry={() => void load()} emptyTitle={t("pm.record.notFound")} emptyIcon="clipboard-outline" />
        {record ? (
          <View style={styles.stack} testID="pm-record">
            <Card style={styles.card}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
                {t("pm.record.completedOn", { date })}
              </Text>
              {record.checklist_version != null ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                  {t("pm.record.version", { version: record.checklist_version })}
                </Text>
              ) : null}
              {record.labor_minutes ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
                  {t("pm.record.labor", { count: record.labor_minutes })}
                </Text>
              ) : null}
            </Card>

            {record.items.map((item, i) => {
              const color = item.result === "failed" ? theme.status.dirty : item.result === "passed" ? theme.status.ready : theme.textMuted;
              const icon = item.result === "failed" ? "close-circle" : item.result === "passed" ? "checkmark-circle" : "remove-circle";
              return (
                <Card key={item.id ?? i} style={styles.card} testID={`pm-record-item-${i}`}>
                  <View style={styles.itemHead}>
                    <Ionicons name={icon} size={20} color={color} />
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemLabel, { color: theme.textPrimary }]}>
                      {item.label}
                    </Text>
                  </View>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.resultText, { color }]}>
                    {item.result === "passed" ? t("pm.result.pass") : item.result === "failed" ? t("pm.result.fail") : t("pm.result.na")}
                  </Text>
                  {item.note ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
                      {item.note}
                    </Text>
                  ) : null}
                  <Evidence items={item.evidence ?? []} />
                </Card>
              );
            })}

            {(record.defects ?? []).length > 0 ? (
              <Card style={styles.card}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                  {t("pm.extras.defects")}
                </Text>
                {(record.defects ?? []).map((d, i) => (
                  <Text key={i} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemLabel, { color: theme.textPrimary }]}>
                    {[d.severity ? t(`pm.severity.${d.severity}`, { defaultValue: d.severity }) : null, d.description].filter(Boolean).join(" · ")}
                  </Text>
                ))}
              </Card>
            ) : null}

            {(record.parts_used ?? []).length > 0 ? (
              <Card style={styles.card}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                  {t("pm.extras.parts")}
                </Text>
                {(record.parts_used ?? []).map((p, i) => (
                  <Text key={i} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemLabel, { color: theme.textPrimary }]}>
                    {`${p.name ?? ""}${p.qty != null ? ` × ${p.qty}` : ""}`}
                  </Text>
                ))}
              </Card>
            ) : null}

            {record.photos.length > 0 ? (
              <Card style={styles.card}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                  {t("pm.photos")}
                </Text>
                <Evidence items={record.photos} />
              </Card>
            ) : null}

            {record.notes ? (
              <Card style={styles.card}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                  {t("pm.extras.notes")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemLabel, { color: theme.textPrimary }]}>
                  {record.notes}
                </Text>
              </Card>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 12 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700" },
  content: { padding: 16 },
  stack: { gap: 10 },
  card: { padding: 14, gap: 6 },
  title: { fontSize: 17, fontWeight: "700" },
  hint: { fontSize: 13, lineHeight: 18 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  resultText: { fontSize: 13, fontWeight: "700" },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  thumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  thumbImage: { width: 64, height: 64 },
});
