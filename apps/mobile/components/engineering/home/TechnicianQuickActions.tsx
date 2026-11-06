import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { R } from "@/components/shared/tokens";
import type { QuickActionKey } from "@/lib/engineering/homeNavigation";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MAX_FONT, HOME_MIN_TOUCH, useHomeStyles } from "./homeStyles";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const ICONS: Record<QuickActionKey, IconName> = {
  report: "alert-circle-outline",
  scan: "qr-code-outline",
  room: "bed-outline",
  available: "list-outline",
  pm: "calendar-outline",
  assign: "person-add-outline",
  team: "people-outline",
  assets: "construct-outline",
};

const LABELS: Record<QuickActionKey, string> = {
  report: "home.engineer.quickReport",
  scan: "home.engineer.quickScan",
  room: "home.engineer.quickRoom",
  available: "home.engineer.quickAvailable",
  pm: "home.engineer.quickPm",
  assign: "home.chief.quickAssign",
  team: "home.chief.quickTeam",
  assets: "home.chief.quickAssets",
};

/** Four real shortcuts into existing screens. No confirmation steps, no placeholders. */
export function TechnicianQuickActions<K extends QuickActionKey>({
  keys,
  onOpen,
  labelOverrides,
}: {
  keys: K[];
  onOpen: (key: K) => void;
  /** i18n keys that replace a shortcut's default label (the chief's "pm" reads "PM Planning"). */
  labelOverrides?: Partial<Record<QuickActionKey, string>>;
}) {
  const homeStyles = useHomeStyles();
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[homeStyles.sectionTitle, { color: theme.textMuted }]}>
        {t("home.engineer.quickTitle")}
      </Text>
      <View style={styles.grid}>
        {keys.map((key) => (
          <Pressable
            key={key}
            onPress={() => onOpen(key)}
            accessibilityRole="button"
            accessibilityLabel={t(labelOverrides?.[key] ?? LABELS[key])}
            testID={`quick-${key}`}
            style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.primaryLine }]}
          >
            <Ionicons name={ICONS[key]} size={22} color={theme.primaryAction} accessibilityElementsHidden importantForAccessibility="no" />
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.text, { color: theme.primaryAction }]}>
              {t(labelOverrides?.[key] ?? LABELS[key])}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexBasis: "47%", flexGrow: 1, minHeight: HOME_MIN_TOUCH + 12, borderWidth: 1, borderRadius: R.md, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, fontSize: 14, fontWeight: "800" },
});
