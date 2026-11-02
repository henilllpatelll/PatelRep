import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { DraftSaveState } from "@/lib/engineering/usePmInspection";

interface Props {
  /** "Boiler #1 - Monthly Safety Inspection", or just the inspection name while the schedule is still loading. */
  title: string;
  /** "BOILER-001 · Mechanical Room". */
  subtitle: string | null;
  /** "Boiler Safety v3". */
  checklist: string | null;
  saveState: DraftSaveState;
  onBack: () => void;
  /** Opens the exact equipment record; null when there is none to open. */
  onOpenEquipment: (() => void) | null;
}

/** The inspection's identity at a glance: what is being inspected, against which procedure, and whether work is safe. */
export function PmInspectionHeader({ title, subtitle, checklist, saveState, onBack, onOpenEquipment }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const saveLabel = saveState === "idle" ? null : t(`pm.save.${saveState}`);
  const metaLine = [checklist, saveLabel].filter(Boolean).join("  ·  ");

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <Pressable onPress={onBack} style={styles.icon} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="pm-inspect-back">
        <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
      </Pressable>
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.shell.ink }]} numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.shell.ink3 }]} numberOfLines={1} testID="pm-inspect-subtitle">
            {subtitle}
          </Text>
        ) : null}
        {metaLine ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.sub, { color: saveState === "failed" ? theme.status.dirty : theme.shell.ink3 }]}
            numberOfLines={2}
            accessibilityLiveRegion={saveState === "failed" ? "polite" : "none"}
            testID="pm-save-state"
          >
            {metaLine}
          </Text>
        ) : null}
      </View>
      {onOpenEquipment ? (
        <Pressable onPress={onOpenEquipment} style={styles.icon} accessibilityRole="button" accessibilityLabel={t("pm.header.viewEquipment")} testID="pm-inspect-equipment">
          <Ionicons name="hardware-chip-outline" size={22} color={theme.shell.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 12 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 1 },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 13 },
});
