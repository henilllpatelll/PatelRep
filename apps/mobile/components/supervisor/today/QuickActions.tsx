import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { SectionHeader } from "@/components/supervisor/today/TodayBlocks";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;
type IconName = ComponentProps<typeof Ionicons>["name"];

export type QuickActionKey = "shiftNote" | "messageTeam" | "messageStaff" | "handoff";

interface Props {
  t: Translate;
  onAction: (key: QuickActionKey) => void;
}

const ACTIONS: Array<{ key: QuickActionKey; icon: IconName; tone: "clean" | "pickup" | "inProgress" | "ready" }> = [
  { key: "shiftNote", icon: "book-outline", tone: "clean" },
  { key: "messageTeam", icon: "megaphone-outline", tone: "pickup" },
  { key: "messageStaff", icon: "chatbubble-ellipses-outline", tone: "inProgress" },
  { key: "handoff", icon: "swap-horizontal-outline", tone: "ready" },
];

/** Four always-visible actions. Each one does something real; availability problems are explained on tap, never hidden. */
export function QuickActions({ t, onAction }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.wrap} testID="today-actions">
      <SectionHeader title={t("supervisorToday.actions.title")} />
      <View style={styles.grid}>
        {ACTIONS.map((action) => {
          const label = t(`supervisorToday.actions.${action.key}`);
          const color = theme.status[action.tone];
          return (
            <Pressable
              key={action.key}
              onPress={() => onAction(action.key)}
              testID={`today-action-${action.key}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: theme.status[`${action.tone}Soft` as const], borderColor: theme.status[`${action.tone}Line` as const] },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Ionicons name={action.icon} size={22} color={color} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textPrimary }]} numberOfLines={2}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 72,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  label: { flex: 1, fontSize: 15, fontWeight: "700" },
});
