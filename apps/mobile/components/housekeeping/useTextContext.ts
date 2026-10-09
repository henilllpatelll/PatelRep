import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import type { TextContext } from "@/lib/housekeeping/myRoomsText";

/** Language + the hotel's timezone, so every shown time is hotel-local. */
export function useTextContext(): TextContext {
  const { i18n } = useTranslation();
  const timeZone = useAppStore((state) => state.hotelTimezone);
  return { language: i18n.resolvedLanguage ?? i18n.language, timeZone };
}
