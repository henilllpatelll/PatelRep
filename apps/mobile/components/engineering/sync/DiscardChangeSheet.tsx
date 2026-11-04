import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

export type ConfirmMode = "discard" | "dismiss";

interface Props {
  visible: boolean;
  mode: ConfirmMode;
  /** What is being removed (a work-order label, an inspection name). */
  subject: string | null;
  /** Dismissing several refused claims at once. */
  all?: boolean;
  /** Overrides the default explanation (the inspection wording names its photos). */
  body?: string;
  busy?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}

/**
 * The one confirmation before anything leaves this phone. Nothing happens on the first tap that opens it; the safe action
 * (keep) is first and is what the back button and backdrop do. Discard removes only an UNSENT change from this phone; it
 * never reverses anything the server confirmed. Dismiss removes only the notice of a refusal, never a work order.
 */
export function DiscardChangeSheet({ visible, mode, subject, all, body, busy, onKeep, onConfirm }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const discard = mode === "discard";
  const title = discard ? t("engineeringSync.discardSheet.title") : t(all ? "engineeringSync.dismissSheet.titleAll" : "engineeringSync.dismissSheet.title");
  const text = body ?? (discard ? t("engineeringSync.discardWarning") : t("engineeringSync.dismissSheet.body"));
  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={busy ? () => undefined : onKeep}
      testID="esync-confirm-sheet"
      footer={
        <View style={styles.actions}>
          <Button label={t(discard ? "engineeringSync.keepChange" : "engineeringSync.keepNotice")} variant="secondary" onPress={onKeep} disabled={busy} testID="esync-confirm-keep" />
          <Button label={t(discard ? "engineeringSync.discardChange" : "engineeringSync.dismissNotice")} variant="destructive" onPress={onConfirm} loading={busy} testID="esync-confirm-go" />
        </View>
      }
    >
      {subject ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subject, { color: theme.textPrimary }]} testID="esync-confirm-subject">
          {subject}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="esync-confirm-body">
        {text}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subject: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  body: { fontSize: 14.5, lineHeight: 21 },
  actions: { gap: 10 },
});
