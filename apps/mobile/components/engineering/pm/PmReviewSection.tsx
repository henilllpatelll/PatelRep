import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmDraft, PmProgress, PmTemplate } from "@/lib/engineering/pmChecklist";
import { evaluateReading, hasReferenceLimits, parseReading, type PmMeter } from "@/lib/engineering/pmReadings";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import { locationLabel } from "./pmUi";

interface Props {
  schedule: PmScheduleView;
  template: PmTemplate;
  draft: PmDraft;
  progress: PmProgress;
  meters: readonly PmMeter[];
  technician: string | null;
  onJump: (itemId: string) => void;
}

function Block({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.block} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockTitle, { color: theme.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: color ?? theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

/** Everything that will be recorded, in one place, before the single Complete button. */
export function PmReviewSection({ schedule, template, draft, progress, meters, technician, onJump }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const failedItems = template.items.filter((i) => draft.items[i.id]?.result === "failed");
  const readings = meters.flatMap((meter) => {
    const parsed = parseReading(draft.readings[meter.id]?.value);
    return parsed.kind === "ok" ? [{ meter, value: parsed.value, status: hasReferenceLimits(meter) ? evaluateReading(meter, parsed.value) : null }] : [];
  });
  const photoCount = draft.photos.length + template.items.reduce((n, i) => n + (draft.items[i.id]?.evidence.length ?? 0), 0);
  const itemName = (id: string) => template.items.find((i) => i.id === id)?.label ?? id;

  return (
    <View style={styles.stack} testID="pm-review">
      <Block title={t("pm.review.summary")}>
        <Line label={t("pm.review.inspection")} value={schedule.name} />
        <Line label={t("pm.review.equipment")} value={[schedule.assetName, locationLabel(schedule, t)].filter(Boolean).join(" · ") || "–"} />
        <Line label={t("pm.review.checklist")} value={template.version != null ? `${template.name} (v${template.version})` : template.name} />
        {technician ? <Line label={t("pm.review.technician")} value={technician} /> : null}
      </Block>

      <Block title={t("pm.review.results")} testID="pm-review-results">
        <Line label={t("pm.review.total")} value={String(progress.total)} />
        <Line label={t("pm.result.pass")} value={String(progress.passed)} color={theme.status.ready} />
        <Line label={t("pm.result.fail")} value={String(progress.failed)} color={progress.failed > 0 ? theme.status.dirty : undefined} />
        <Line label={t("pm.result.na")} value={String(progress.notApplicable)} />
        <Line label={t("pm.review.unanswered")} value={String(progress.unansweredIds.length)} color={progress.unansweredIds.length > 0 ? theme.status.dirty : undefined} />
        {progress.unansweredIds.map((id) => (
          <Pressable key={id} onPress={() => onJump(id)} style={styles.jump} accessibilityRole="button" testID={`pm-review-jump-${id}`}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.jumpText, { color: theme.status.dirty }]} numberOfLines={2}>
              {t("pm.review.answerStep", { name: itemName(id) })}
            </Text>
          </Pressable>
        ))}
        {progress.evidenceMissingIds.map((id) => (
          <Pressable key={id} onPress={() => onJump(id)} style={styles.jump} accessibilityRole="button" testID={`pm-review-evidence-${id}`}>
            <Ionicons name="camera-outline" size={16} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.jumpText, { color: theme.status.dirty }]} numberOfLines={2}>
              {t("pm.review.addPhotoFor", { name: itemName(id) })}
            </Text>
          </Pressable>
        ))}
      </Block>

      {readings.length > 0 ? (
        <Block title={t("pm.review.measurements")}>
          {readings.map(({ meter, value, status }) => (
            <Line
              key={meter.id}
              label={meter.name}
              value={`${value} ${meter.unit}${status && status !== "normal" ? ` · ${t(`pm.reading.status.${status}`)}` : ""}`}
              color={status === "critical" ? theme.status.dirty : status === "warning" ? theme.status.pickup : undefined}
            />
          ))}
        </Block>
      ) : null}

      <Block title={t("pm.review.evidence")}>
        <Line label={t("pm.photos")} value={String(photoCount)} />
      </Block>

      {failedItems.length > 0 || draft.defects.length > 0 ? (
        <Block title={t("pm.review.issues")} testID="pm-review-issues">
          {failedItems.map((item) => (
            <View key={item.id} style={styles.issue}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.status.dirty }]}>
                {item.label}
              </Text>
              {draft.items[item.id].note.trim() ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textSecondary }]}>
                  {draft.items[item.id].note.trim()}
                </Text>
              ) : null}
            </View>
          ))}
          {draft.defects.map((defect) => (
            <Line key={defect.id} label={defect.severity ? t(`pm.severity.${defect.severity}`) : t("pm.extras.defects")} value={defect.description} />
          ))}
          {failedItems.length > 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textSecondary }]} testID="pm-review-wo-notice">
              {t("pm.review.willOpenWorkOrders", { count: failedItems.length })}
            </Text>
          ) : null}
        </Block>
      ) : null}

      {draft.laborMinutes.trim() || draft.parts.length > 0 ? (
        <Block title={t("pm.review.laborParts")}>
          {draft.laborMinutes.trim() ? <Line label={t("pm.extras.labor")} value={t("pmSchedules.minutes", { count: Number(draft.laborMinutes) })} /> : null}
          {draft.parts.map((part) => (
            <Line key={part.id} label={part.name} value={part.qty.trim() ? `× ${part.qty.trim()}` : ""} />
          ))}
        </Block>
      ) : null}

      {draft.notes.trim() ? (
        <Block title={t("pm.extras.notes")}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textPrimary, textAlign: "left" }]}>
            {draft.notes.trim()}
          </Text>
        </Block>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  block: { gap: 6 },
  blockTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  card: { padding: 14, gap: 8 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineLabel: { fontSize: 13, flexShrink: 1 },
  lineValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  jump: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  jumpText: { flex: 1, fontSize: 14, fontWeight: "600" },
  issue: { gap: 2 },
});
