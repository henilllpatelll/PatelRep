import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { StickyAction, StickyActionId, StickyActions } from "@/lib/housekeeping/roomDetailState";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  actions: StickyActions;
  /** An action is in flight: the primary shows progress and can't be pressed twice. */
  busy: boolean;
  onAction: (id: StickyActionId) => void;
  onMore: () => void;
}

/**
 * The bottom action bar. It sits in the layout under the scroll area (not on top
 * of it), so nothing is ever hidden behind it and the safe-area inset is simply
 * its own padding. A disabled primary always says why, in text.
 */
export function RoomStickyActions({ actions, busy, onAction, onMore }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { primary, secondary, more } = actions;
  if (!primary && !secondary && !more) return null;

  const reason = primary && !primary.enabled && primary.disabledReasonKey ? t(primary.disabledReasonKey, primary.disabledParams) : null;

  function label(action: StickyAction): string {
    return t(action.labelKey, action.labelParams);
  }

  return (
    <View
      testID="room-sticky-actions"
      style={[styles.root, { paddingBottom: insets.bottom + 12, backgroundColor: theme.surface, borderTopColor: theme.border }]}
    >
      {reason ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.reason, { color: theme.textSecondary }]}
          testID="sticky-disabled-reason"
        >
          {reason}
        </Text>
      ) : null}
      {primary ? (
        <Button
          label={label(primary)}
          onPress={() => onAction(primary.id)}
          disabled={!primary.enabled}
          loading={busy && primary.enabled}
          size="lg"
          testID={`sticky-${primary.id}`}
        />
      ) : null}
      {secondary ? (
        <Button
          label={label(secondary)}
          onPress={() => onAction(secondary.id)}
          disabled={!secondary.enabled}
          variant="secondary"
          size="md"
          testID={`sticky-${secondary.id}`}
        />
      ) : null}
      {more ? (
        <Button label={t(more.labelKey)} onPress={onMore} variant="secondary" size="md" testID="sticky-more" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingTop: 12, gap: 8, borderTopWidth: 1 },
  reason: { fontSize: 13, lineHeight: 18, fontWeight: "600", textAlign: "center" },
});
