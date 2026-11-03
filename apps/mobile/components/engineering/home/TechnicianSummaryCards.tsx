import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { monoFont, R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MAX_FONT } from "./homeStyles";

export const UNKNOWN_COUNT = "—";

export interface SummaryCardData {
  key: "myJobs" | "urgent" | "pmDue" | "needsOwner" | "inProgress" | "waiting";
  label: string;
  /** Display text. UNKNOWN_COUNT means the number is not known; it is never shown as a zero. */
  value: string;
  alert?: boolean;
  onPress: () => void;
  testID: string;
}

function SummaryCard({ card }: { card: SummaryCardData }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const unknown = card.value === UNKNOWN_COUNT;
  return (
    <Pressable
      onPress={card.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.label}: ${unknown ? t("home.engineer.unavailable") : card.value}`}
      testID={card.testID}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.value, { color: card.alert ? theme.status.dirty : theme.textPrimary }]}>
        {card.value}
      </Text>
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={2} style={[styles.label, { color: theme.textMuted }]}>
        {card.label}
      </Text>
    </Pressable>
  );
}

/** Tappable counts. Each destination holds exactly what the number counted (see homeNavigation.ts). */
export function TechnicianSummaryCards({ cards }: { cards: SummaryCardData[] }) {
  return (
    <View style={styles.row}>
      {cards.map((card) => (
        <SummaryCard key={card.key} card={card} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  card: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", gap: 2 },
  value: { fontSize: 26, fontWeight: "700", fontFamily: monoFont },
  label: { fontSize: 12, fontWeight: "700", textAlign: "center" },
});
