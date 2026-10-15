import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { PasswordForm } from "@/components/auth/PasswordForm";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { changePassword } from "@/lib/auth/passwordChange";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  return (
    <SettingsScreen title={t("security.password.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
        {t("security.password.intro")}
      </Text>
      <PasswordForm
        requireCurrent
        submitLabel={t("security.password.save")}
        onSubmit={async ({ current, next }) => {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const email = session?.user?.email;
          if (!email) return "session";
          const failure = await changePassword(email, current, next);
          if (!failure) {
            toast.success(t("security.password.saved"));
            if (router.canGoBack()) router.back();
          }
          return failure;
        }}
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20 },
});
