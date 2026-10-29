import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { TeamScheduleView } from "@/lib/navigation/teamScheduleLink";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const VIEWS: readonly TeamScheduleView[] = ["today", "week"];

/** Today / Week segmented control. The selected segment is filled AND announced as selected. */
export function ViewSwitch({ value, onChange, t }: { value: TeamScheduleView; onChange: (view: TeamScheduleView) => void; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="tablist" accessibilityLabel={t("teamSchedule.view.label")} testID="team-schedule-view-switch">
      {VIEWS.map((view) => {
        const selected = view === value;
        return (
          <Pressable
            key={view}
            onPress={() => onChange(view)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`teamSchedule.view.${view}`)}
            testID={`team-schedule-view-${view}`}
            style={[styles.segment, selected && { backgroundColor: theme.primaryAction }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: selected ? theme.onPrimary : theme.textPrimary }]}>
              {t(`teamSchedule.view.${view}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderWidth: 1, borderRadius: R.md, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: MIN_TARGET - 6, borderRadius: R.md - 3, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  label: { fontSize: 15, fontWeight: "700" },
});
