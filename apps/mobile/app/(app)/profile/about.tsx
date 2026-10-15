import { useTranslation } from "react-i18next";
import { NotConfiguredNotice } from "@/components/settings/NotConfiguredNotice";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function AboutScreen() {
  const { t } = useTranslation();
  return (
    <SettingsScreen title={t("settings.about.title")} back>
      <NotConfiguredNotice />
    </SettingsScreen>
  );
}
