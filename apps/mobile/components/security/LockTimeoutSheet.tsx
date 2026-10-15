import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { LOCK_TIMEOUTS_MS, type LockTimeoutMs } from "@/lib/security/appLockPrefs";
import { useTheme } from "@/lib/theme/useTheme";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

export function timeoutLabelKey(ms: LockTimeoutMs): string {
  return `security.lockAfter.options.${ms === 0 ? "immediately" : `m${ms / 60_000}`}`;
}

/** Radio-style choice of how long away (or idle) before the app locks. */
export function LockTimeoutSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: LockTimeoutMs;
  onSelect: (ms: LockTimeoutMs) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} title={t("security.lockAfter.title")} onClose={onClose} testID="lock-timeout-sheet">
      {LOCK_TIMEOUTS_MS.map((ms) => {
        const selected = ms === value;
        return (
          <Pressable
            key={ms}
            onPress={() => onSelect(ms)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(timeoutLabelKey(ms))}
            style={[styles.row, { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: theme.surface }]}
            testID={`lock-timeout-${ms}`}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textPrimary }]}>
              {t(timeoutLabelKey(ms))}
            </Text>
            {selected ? <Ionicons name="checkmark-circle" size={22} color={theme.primaryAction} /> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  label: { flex: 1, fontSize: 15.5, fontWeight: "600" },
});
