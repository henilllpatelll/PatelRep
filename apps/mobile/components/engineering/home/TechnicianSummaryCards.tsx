import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { UNKNOWN_DISPLAY } from "@/lib/engineering/homeContract";
import { HOME_MAX_FONT } from "./homeStyles";
import { createTypographyStyles } from "@/lib/design/reactiveTypography";

export const UNKNOWN_COUNT = UNKNOWN_DISPLAY;

export interface SummaryCardData {
  key: "myJobs" | "urgent" | "pmDue" | "needsOwner" | "inProgress" | "waiting";
  label: string;
  /** Display text. UNKNOWN_COUNT means the number is not known; it is never shown as a zero. */
  value: string;
  alert?: boolean;
  /** The number is still being read: shown as a quiet placeholder and announced as "loading", never as a zero. */
  loading?: boolean;
  onPress: () => void;
  testID: string;
}

function SummaryCard({ card }: { card: SummaryCardData }) {
  const styles = useStyles();
  const theme = useTheme();
  const x = useV2Text();
  const { t } = useTranslation();
  const unknown = card.value === UNKNOWN_COUNT;
  const loading = card.loading === true;
  const spoken = loading ? t("home.engineer.loadingCount") : unknown ? t("home.engineer.unavailable") : card.value;
  return (
    <Pressable
      onPress={card.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.label}: ${spoken}`}
      accessibilityState={{ busy: loading }}
      testID={card.testID}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      {loading ? (
        <View style={[styles.placeholder, { backgroundColor: theme.surfaceMuted }]} testID={`${card.testID}-loading`} />
      ) : (
        <View style={styles.valueRow}>
          {card.alert ? <Ionicons name="alert-circle" size={16} color={theme.status.dirty} accessibilityElementsHidden importantForAccessibility="no" /> : null}
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.value, x.num, { color: card.alert ? theme.status.dirty : theme.textPrimary }]}>
            {card.value}
          </Text>
        </View>
      )}
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.label, { color: theme.textMuted }]}>
        {card.label}
      </Text>
    </Pressable>
  );
}

/** Tappable counts. Each destination holds exactly what the number counted (see homeNavigation.ts). */
export function TechnicianSummaryCards({ cards }: { cards: SummaryCardData[] }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {cards.map((card) => (
        <SummaryCard key={card.key} card={card} />
      ))}
    </View>
  );
}

const useStyles = createTypographyStyles((t) => ({
  row: { flexDirection: "row", gap: 10 },
  card: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", gap: 2 },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  value: { fontSize: 26, fontWeight: "700", fontFamily: t.mono },
  // Same footprint as a one-digit value, so the card does not jump when the number arrives.
  placeholder: { width: 28, height: 26, borderRadius: R.sm },
  label: { fontSize: 12, fontWeight: "700", textAlign: "center" },
}));
