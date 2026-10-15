import { useTranslation } from "react-i18next";
import { NotConfiguredNotice } from "@/components/settings/NotConfiguredNotice";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function SecurityScreen() {
  const { t } = useTranslation();
  return (
    <SettingsScreen title={t("settings.security.title")} back>
      <NotConfiguredNotice />
    </SettingsScreen>
  );
}
