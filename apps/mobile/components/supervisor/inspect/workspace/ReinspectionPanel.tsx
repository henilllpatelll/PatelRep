import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { fetchInspectionDetail, type InspectionDetail } from "@/lib/api/inspections";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { ReinspectionContext } from "@/lib/inspections/corrections";
import type { AnswerMap, ChecklistTemplate } from "@/lib/inspections/types";
import { recheckStanding, type RecheckStanding } from "@/lib/inspections/workspace";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * CORRECTION VERIFICATION. The earlier failures, first, in the words and photos of the inspection that recorded them,
 * with what the housekeeper submitted (only when the server has it). Each shows how it stands NOW from the answers on
 * the checklist: this panel never marks anything fixed - the supervisor's own Pass on that standard does. The whole
 * checklist is still completed below; untouched standards are never counted as passed.
 */
export function ReinspectionPanel({
  context,
  template,
  answers,
  timeZone,
  language,
  t,
  onGoToItem,
  onViewPhoto,
}: {
  context: ReinspectionContext;
  template: Pick<ChecklistTemplate, "items">;
  answers: AnswerMap;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  onGoToItem: (itemId: string) => void;
  onViewPhoto: (uri: string, label: string) => void;
}) {
  const theme = useTheme();
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const failureId = context.failureInspectionId;

  // Photos and the housekeeper's submission come from the original inspection's own record. Without them the panel
  // still lists exactly what failed (from the queue row); nothing is made up to fill the gap.
  useEffect(() => {
    let live = true;
    setDetail(null);
    if (failureId) {
      Promise.resolve()
        .then(() => fetchInspectionDetail(failureId))
        .then(
          (loaded) => live && loaded && setDetail(loaded),
          () => undefined,
        );
    }
    return () => {
      live = false;
    };
  }, [failureId]);

  if (!context.isReinspection) return null;
  const onChecklist = new Set(template.items.map((item) => item.id));
  const byItem = new Map((detail?.items ?? []).map((item) => [item.template_item_id, item] as const));
  const submitted = detail?.correction?.resubmission ?? null;
  const submittedTime = submitted ? formatHotelTime(submitted.at, timeZone, language) : null;
  const lines = context.failedItems.map((failed, index) => {
    const onThisChecklist = failed.id !== null && onChecklist.has(failed.id);
    const standing: RecheckStanding = onThisChecklist && failed.id ? recheckStanding(answers, failed.id) : "unchecked";
    return { key: failed.id ?? `${failed.label}-${index}`, failed, standing, onThisChecklist, photo: failed.id ? (byItem.get(failed.id)?.photo_url ?? null) : null };
  });

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.status.pickupLine }]} testID="reinspection-panel">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.kicker, { color: theme.status.pickup }]}>
        {t("inspect.reinspect.kicker").toUpperCase()}
      </Text>
      {submitted ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="reinspection-submitted">
          {submitted.housekeeper_name
            ? t("inspect.reinspect.submittedBy", { name: submitted.housekeeper_name, time: submittedTime ?? "—" })
            : t("inspect.reinspect.submitted", { time: submittedTime ?? "—" })}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, { color: theme.textPrimary }]}>
        {t("inspect.reinspect.original", { count: lines.length })}
      </Text>
      {lines.map((line, index) => (
        <View key={line.key} style={[styles.item, { borderColor: theme.border }]} testID={`reinspection-item-${line.key}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
            {index + 1}. {line.failed.label}
          </Text>
          {line.failed.note ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
              {t("inspect.reinspect.originalNote", { note: line.failed.note })}
            </Text>
          ) : null}
          {line.photo ? (
            <Pressable
              onPress={() => onViewPhoto(line.photo as string, line.failed.label)}
              accessibilityRole="imagebutton"
              accessibilityLabel={t("inspect.drawer.photoA11y", { item: line.failed.label })}
              style={styles.photoWrap}
              testID={`reinspection-photo-${line.key}`}
            >
              <Image source={{ uri: line.photo }} style={[styles.photo, { backgroundColor: theme.surfaceMuted }]} resizeMode="cover" />
            </Pressable>
          ) : null}
          <View style={styles.footer}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.standing, { color: line.standing === "fixed" ? theme.status.ready : line.standing === "still_failing" ? theme.status.dirty : theme.status.pickup }]}
              accessibilityLiveRegion="polite"
              testID={`reinspection-standing-${line.key}`}
            >
              {t(`inspect.workspace.reviewScreen.standing.${line.standing}`)}
            </Text>
            {line.onThisChecklist && line.failed.id ? (
              <Button label={t("inspect.reinspect.check")} variant="secondary" size="sm" onPress={() => onGoToItem(line.failed.id as string)} accessibilityLabel={t("inspect.reinspect.checkA11y", { item: line.failed.label })} testID={`reinspection-go-${line.key}`} />
            ) : (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]}>
                {t("inspect.reinspect.notOnChecklist")}
              </Text>
            )}
          </View>
        </View>
      ))}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]} testID="reinspection-note">
        {t("inspect.reinspect.fullChecklist")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  heading: { fontSize: 15, lineHeight: 21, fontWeight: "800" },
  item: { borderTopWidth: 1, paddingTop: 8, gap: 3 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  sub: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  photoWrap: { alignSelf: "flex-start", marginVertical: 4 },
  photo: { width: 96, height: 72, borderRadius: R.sm },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
  standing: { flexShrink: 1, fontSize: 14, fontWeight: "800" },
});
