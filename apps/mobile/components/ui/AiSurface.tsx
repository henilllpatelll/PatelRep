import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radiusV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";

export interface AiSurfaceProps {
  /** Heading, e.g. "Today's briefing". */
  title: string;
  /** The word shown on the AI chip. Pass the translated "AI". */
  aiLabel: string;
  /** Honest provenance line, e.g. "Sample data. Not from a real forecast." */
  provenance?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** AiSurface: the single treatment for AI-generated content. Soft violet fill + violet edge, a
 *  sparkle icon and a literal "AI" chip, so AI content is identifiable without color. Used
 *  sparingly: one per screen region, never as a primary action. */
export function AiSurface({ title, aiLabel, provenance, children, style, testID }: AiSurfaceProps) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: theme.ai.soft, borderColor: theme.ai.line },
        style,
      ]}
    >
      <View style={styles.header}>
        <Ionicons name="sparkles" size={16} color={theme.ai.primary} />
        <AppText variant="label" tone="ai" style={styles.title} accessibilityRole="header">
          {title}
        </AppText>
        <View style={[styles.chip, { borderColor: theme.ai.line, backgroundColor: theme.surface }]}>
          <AppText variant="micro" tone="ai">
            {aiLabel}
          </AppText>
        </View>
      </View>
      {children}
      {provenance ? (
        <AppText variant="micro" tone="secondary">
          {provenance}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radiusV2.card,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1 },
  chip: {
    borderWidth: 1,
    borderRadius: radiusV2.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
