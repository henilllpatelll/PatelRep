import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";

interface SimpleConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  /** Extra short line, e.g. an inline error from the last attempt. */
  error?: string | null;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
}

/** Two-button confirmation drawer (explain, then Confirm / Cancel). */
export function SimpleConfirmSheet({
  visible,
  title,
  body,
  error,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  onConfirm,
  onClose,
  testID = "confirm-sheet",
}: SimpleConfirmSheetProps) {
  const theme = useTheme();
  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={busy ? () => undefined : onClose}
      testID={testID}
      footer={
        <View style={styles.actions}>
          <Button
            label={confirmLabel}
            variant={destructive ? "destructive" : "primary"}
            onPress={onConfirm}
            loading={busy}
            testID={`${testID}-confirm`}
          />
          <Button label={cancelLabel} variant="secondary" onPress={onClose} disabled={busy} testID={`${testID}-cancel`} />
        </View>
      }
    >
      <Text maxFontSizeMultiplier={1.4} style={[styles.body, { color: theme.textSecondary }]}>
        {body}
      </Text>
      {error ? (
        <Text maxFontSizeMultiplier={1.4} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
