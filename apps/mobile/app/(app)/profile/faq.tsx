import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ContactSheet } from "@/components/settings/ContactSheet";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/Button";
import { faqsForRole } from "@/lib/support/faq";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.4;

export default function FaqScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role ?? null);
  const items = useMemo(() => faqsForRole(role), [role]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <SettingsScreen title={t("help.faq.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]}>
        {t("help.faq.intro")}
      </Text>
      <SettingsSection testID="faq-list">
        {items.map((item, index) => {
          const open = openId === item.id;
          const question = t(`help.faq.items.${item.id}.q`);
          return (
            <View key={item.id} style={index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }}>
              <Pressable
                onPress={() => setOpenId(open ? null : item.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={question}
                style={({ pressed }) => [styles.question, pressed && { backgroundColor: theme.surfaceMuted }]}
                testID={`faq-${item.id}`}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.questionText, { color: theme.textPrimary }]}>
                  {question}
                </Text>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.textDisabled} />
              </Pressable>
              {open ? (
                <View style={styles.answer} testID={`faq-${item.id}-answer`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.answerText, { color: theme.textSecondary }]}>
                    {t(`help.faq.items.${item.id}.a`)}
                  </Text>
                  {item.action ? (
                    <Button
                      label={t(item.action.labelKey)}
                      variant="secondary"
                      size="sm"
                      onPress={() => (item.action?.kind === "contact" ? setContactOpen(true) : item.action && router.push(item.action.route as never))}
                      testID={`faq-${item.id}-action`}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </SettingsSection>
      <ContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  question: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  questionText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "600" },
  answer: { paddingHorizontal: 14, paddingBottom: 14, gap: 10, alignItems: "flex-start" },
  answerText: { fontSize: 14, lineHeight: 21 },
});
