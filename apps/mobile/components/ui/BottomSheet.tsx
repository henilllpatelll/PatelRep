import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";
import { IconButton } from "./IconButton";

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Accessible name for the close control, e.g. "Close". */
  closeLabel: string;
  children: React.ReactNode;
  /** Pinned action area (buttons). Stays visible while the body scrolls. */
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** BottomSheet: the V2 sheet/modal foundation. Top radius 24, a drag-handle affordance, scrim
 *  tap and the system back gesture both close it, and the slide animation is skipped when the OS
 *  asks for reduced motion. Sheets hold one task; navigation-heavy flows should be screens. */
export function BottomSheet({
  visible,
  onClose,
  title,
  closeLabel,
  children,
  footer,
  style,
  testID,
}: BottomSheetProps) {
  const theme = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root} testID={testID}>
        <Pressable
          style={[styles.scrim, { backgroundColor: theme.textPrimary }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
            style,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <AppText variant="headline" style={styles.title} accessibilityRole="header">
              {title}
            </AppText>
            <IconButton icon="close" accessibilityLabel={closeLabel} onPress={onClose} />
          </View>
          <View style={styles.body}>{children}</View>
          {footer ? (
            <View style={[styles.footer, { borderColor: theme.borderSubtle }]}>{footer}</View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.45 },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radiusV2.sheet,
    borderTopRightRadius: radiusV2.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingBottom: spaceV2.lg,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginTop: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spaceV2.page,
    paddingRight: 6,
    paddingTop: 4,
  },
  title: { flex: 1 },
  body: { paddingHorizontal: spaceV2.page, paddingTop: 4 },
  footer: {
    marginTop: spaceV2.md,
    paddingHorizontal: spaceV2.page,
    paddingTop: spaceV2.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
