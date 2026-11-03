import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { R } from "@/components/shared/tokens";
import type { TeamOverview } from "@/lib/api/engineeringTeam";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MAX_FONT, HOME_MIN_TOUCH, homeStyles } from "../homeStyles";

interface Props {
  overview: TeamOverview;
  onOpenRooms: () => void;
  onOpenPmPlan: () => void;
}

interface RowProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
  onPress: () => void;
  testID: string;
}

function OversightRow({ icon, label, value, hint, alert, onPress, testID }: RowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[label, value, hint].filter(Boolean).join(". ")}
      style={[styles.row, { backgroundColor: theme.surface, borderColor: alert ? theme.status.dirtyLine : theme.border }]}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={alert ? theme.status.dirty : theme.textSecondary} />
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.label, { color: theme.textPrimary }]}>
          {label}
        </Text>
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: alert ? theme.status.dirty : theme.textMuted }]}>
          {[value, hint].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );
}

/**
 * Room and PM oversight as two honest aggregates. The rooms figure is only what the server confirms is down (an open repair
 * does not make a room unavailable) and opens the existing room screen; PM opens the existing Plan. A figure the server
 * could not read is "Unavailable", never zero. The individual records are in Property Priorities and Team Overview.
 */
export function ChiefOversight({ overview, onOpenRooms, onOpenPmPlan }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rooms = overview.rooms_down;
  const pmOverdue = overview.counts.pm_overdue;
  const repeats = overview.pm_oversight?.repeat_defects.length ?? 0;
  const unavailable = t("engineeringTeam.tiles.unknown");
  return (
    <View style={styles.section} testID="chief-oversight">
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[homeStyles.sectionTitle, { color: theme.textMuted }]}>
        {t("home.chief.oversightTitle")}
      </Text>
      <OversightRow
        icon="bed-outline"
        label={t("engineeringTeam.roomOversight")}
        value={rooms == null ? unavailable : t("home.chief.roomsDownTitle", { count: rooms.total })}
        hint={rooms != null && rooms.past_expected_return > 0 ? t("home.chief.roomsPastReturn", { count: rooms.past_expected_return }) : undefined}
        alert={rooms != null && rooms.past_expected_return > 0}
        onPress={onOpenRooms}
        testID="oversight-rooms"
      />
      <OversightRow
        icon="calendar-outline"
        label={t("engineeringTeam.pmOversight")}
        value={pmOverdue == null ? unavailable : t("engineeringTeam.pmOverdueCount", { count: pmOverdue })}
        hint={repeats > 0 ? t("home.chief.repeatCount", { count: repeats }) : undefined}
        alert={(pmOverdue ?? 0) > 0}
        onPress={onOpenPmPlan}
        testID="oversight-pm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: HOME_MIN_TOUCH + 12, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: 15, fontWeight: "700" },
});
