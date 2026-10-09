import { useCallback } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";

/**
 * Closing a form with something typed asks first; a clean form just closes.
 * Used for the swipe/backdrop/close button and the Android back button alike,
 * because they all arrive as the sheet's single onClose.
 *
 * `busy` blocks dismissal while a write is in flight: leaving then would hide
 * whether it landed.
 */
export function useDiscardGuard(options: { dirty: boolean; busy?: boolean; onClose: () => void; onDiscard?: () => void }) {
  const { t } = useTranslation();
  const { dirty, busy = false, onClose, onDiscard } = options;

  return useCallback(() => {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    // A genuine keep/discard choice: this stays a blocking native alert.
    Alert.alert(t("rooms.work.sheets.discard.title"), t("rooms.work.sheets.discard.message"), [
      { text: t("rooms.work.sheets.discard.keep"), style: "cancel" },
      {
        text: t("rooms.work.sheets.discard.discard"),
        style: "destructive",
        onPress: () => {
          onDiscard?.();
          onClose();
        },
      },
    ]);
  }, [busy, dirty, onClose, onDiscard, t]);
}
