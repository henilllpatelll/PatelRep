import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import { dueLabel, frequencyLabel, locationLabel, Meta, useDueTone } from "./pmUi";

interface Props {
  schedule: PmScheduleView;
  language?: string;
  /** A saved local draft exists for this schedule. */
  hasDraft: boolean;
  /** The viewer may perform inspections (engineer / chief engineer / gm per the API). */
  canInspect: boolean;
  onOpen: () => void;
  onInspect: () => void;
}

/** One PM task: what, where, when. The card opens the detail; the button goes straight to the inspection. */
export function PmScheduleCard({ schedule, language, hasDraft, canInspect, onOpen, onInspect }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = useDueTone(schedule.state);
  const place = [schedule.assetName ?? t("pmSchedules.unknownAsset"), locationLabel(schedule, t)].filter(Boolean).join(" · ");
  const frequency = frequencyLabel(schedule, t);
  const due = dueLabel(schedule, t, language);

  return (
    <Card style={styles.card} testID={`pm-card-${schedule.id}`}>
      <View style={[styles.rail, { backgroundColor: tone.fg }]} />
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`${schedule.name || t("pmSchedules.title")}, ${place}, ${due}`}
        testID={`pm-card-open-${schedule.id}`}
      >
        <View style={styles.titleRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
            {schedule.name || t("pmSchedules.title")}
          </Text>
          <View style={[styles.duePill, { backgroundColor: tone.bg }]}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dueText, { color: tone.fg }]}>
              {due}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.place, { color: theme.textSecondary }]} numberOfLines={1}>
          {place}
        </Text>
        <View style={styles.metaRow}>
          {frequency ? <Meta icon="refresh-outline" text={frequency} /> : null}
          {schedule.estimatedMinutes ? <Meta icon="time-outline" text={t("pmSchedules.minutes", { count: schedule.estimatedMinutes })} /> : null}
          {hasDraft ? <Meta icon="create-outline" text={t("pm.localDraft")} color={theme.status.pickup} /> : null}
        </View>
      </Pressable>
      {canInspect ? (
        <View style={styles.action}>
          <Button
            label={hasDraft ? t("pm.continueInspection") : t("pm.startInspection")}
            onPress={onInspect}
            variant={schedule.state === "overdue" || schedule.state === "due_today" ? "primary" : "secondary"}
            size="md"
            testID={`pm-card-inspect-${schedule.id}`}
            accessibilityLabel={`${hasDraft ? t("pm.continueInspection") : t("pm.startInspection")}: ${schedule.name}`}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { position: "relative", overflow: "hidden", paddingVertical: 14, paddingLeft: 18, paddingRight: 14, gap: 10 },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  body: { gap: 5 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { flex: 1, fontSize: 15, fontWeight: "700" },
  duePill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  dueText: { fontSize: 12, fontWeight: "700" },
  place: { fontSize: 13 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
  action: { marginTop: 2 },
});
