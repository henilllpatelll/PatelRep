import { useTranslation } from "react-i18next";
import { NotConfiguredNotice } from "@/components/settings/NotConfiguredNotice";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function PersonalScreen() {
  const { t } = useTranslation();
  return (
    <SettingsScreen title={t("settings.personal.title")} back>
      <NotConfiguredNotice />
    </SettingsScreen>
  );
}
