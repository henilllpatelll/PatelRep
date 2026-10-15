import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/EmptyState";
import { monoFont } from "@/components/shared/tokens";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { loadLicenses } from "@/lib/app/licenses";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

/** Notices for the open-source packages PatelRep ships directly. Bundled, so it works offline. */
export default function LicensesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  // Read on first open, not at app start.
  const packages = useMemo(() => loadLicenses(), []);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <SettingsScreen title={t("about.licenses.title")} back>
      {packages.length === 0 ? (
        <View testID="licenses-empty">
          <EmptyState icon="library-outline" title={t("about.licenses.emptyTitle")} />
        </View>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]} testID="licenses-intro">
            {t("about.licenses.intro", { count: packages.length })}
          </Text>
          <SettingsSection testID="licenses-list">
            {packages.map((pkg, index) => {
              const expanded = open === pkg.name;
              const meta = [pkg.version ? `v${pkg.version}` : null, pkg.license].filter(Boolean).join(" · ");
              return (
                <View key={pkg.name} style={index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }}>
                  <Pressable
                    onPress={() => setOpen(expanded ? null : pkg.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`${pkg.name}, ${meta}`}
                    accessibilityState={{ expanded }}
                    accessibilityHint={expanded ? t("about.licenses.collapseHint") : t("about.licenses.expandHint")}
                    testID={`license-${pkg.name}`}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceMuted }]}
                  >
                    <View style={styles.rowText}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                        {pkg.name}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                        {meta}
                      </Text>
                    </View>
                    <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.textDisabled} />
                  </Pressable>
                  {expanded ? (
                    <View style={styles.body} testID={`license-text-${pkg.name}`}>
                      {pkg.text ? (
                        <Text selectable maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textSecondary }]}>
                          {pkg.text}
                        </Text>
                      ) : (
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textSecondary }]}>
                          {t("about.licenses.noText", { license: pkg.license ?? t("about.unavailable") })}
                        </Text>
                      )}
                      {pkg.repository ? (
                        <Text selectable maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                          {pkg.repository}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </SettingsSection>
        </>
      )}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13.5, lineHeight: 19, paddingHorizontal: 4 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 15, fontWeight: "600" },
  meta: { fontFamily: monoFont, fontSize: 12 },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  text: { fontSize: 12.5, lineHeight: 18 },
});
