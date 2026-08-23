import type { ComponentProps } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { monoFont, serifFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

interface WhileYouWaitAction {
  key: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint: string;
  onPress: () => void;
}

interface Props {
  message: string;
  hint: string;
  /** Formatted "waiting · last checked HH:MM" line — null until the first
   *  successful poll resolves. Always a real local timestamp, never a guess
   *  at when the supervisor will publish. */
  waitingLabel: string | null;
  actions: WhileYouWaitAction[];
}

/** Home's stage==="empty" state — nothing assigned yet today. No fabricated
 *  "board published at X" signal exists server-side, so this stays to real,
 *  known facts: the companion copy, the app's own last-refresh time, and
 *  real navigation shortcuts. */
export function EmptyBoardState({ message, hint, waitingLabel, actions }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.wrap} testID="empty-board-state">
      <View
        style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accentBrassLine }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: theme.accentBrassSoft, borderColor: theme.accentBrassLine }]}>
          <Ionicons name="time-outline" size={22} color={theme.accentBrass} />
        </View>
        <Text style={[styles.message, { color: theme.textPrimary }]}>{message}</Text>
        <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text>
        {waitingLabel ? (
          <View style={styles.waitingRow} testID="empty-board-waiting">
            <View style={[styles.waitingDot, { backgroundColor: theme.accentBrass }]} />
            <Text style={[styles.waitingText, { color: theme.textMuted }]}>{waitingLabel}</Text>
          </View>
        ) : null}
      </View>

      {actions.length > 0 ? (
        <View style={styles.actionList}>
          {actions.map((action) => (
            <TouchableOpacity
              key={action.key}
              style={[styles.actionRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={action.onPress}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              testID={`empty-board-action-${action.key}`}
            >
              <Ionicons name={action.icon} size={17} color={theme.textPrimary} />
              <Text style={[styles.actionLabel, { color: theme.textPrimary }]} numberOfLines={1}>
                {action.label}
              </Text>
              <Text style={[styles.actionHint, { color: theme.textDisabled }]} numberOfLines={1}>
                {action.hint}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    gap: 8,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  message: { fontFamily: serifFont, fontSize: 21, textAlign: "center", lineHeight: 25 },
  hint: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  waitingRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  waitingDot: { width: 6, height: 6, borderRadius: 3 },
  waitingText: { fontFamily: monoFont, fontSize: 11.5, fontWeight: "600" },
  actionList: { gap: 8 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 13,
    minHeight: 48,
  },
  actionLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  actionHint: { fontSize: 11.5 },
});
