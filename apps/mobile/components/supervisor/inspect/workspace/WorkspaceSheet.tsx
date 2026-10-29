import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, findNodeHandle, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";
import type { TextInstance } from "react-native";

/* ─── The one bottom drawer every workspace sheet uses ──────────────────────
   Exactly one is ever open (the screen holds a single `sheet` value), so drawers never stack. Android back and a
   backdrop tap call `onClose`; a sheet that must not be dismissed by accident passes `dismissOnBackdrop={false}`
   and decides for itself what back means. When it opens, a screen reader lands on its title. */

export function WorkspaceSheet({
  visible,
  title,
  onClose,
  onBackdrop,
  closeLabel,
  showClose = true,
  testID,
  children,
  footer,
  t,
}: {
  visible: boolean;
  title: string;
  /** Android back and the close button. */
  onClose: () => void;
  /** A tap outside. Omit to ignore it (the sheet then only leaves through its own buttons). */
  onBackdrop?: () => void;
  closeLabel?: string;
  showClose?: boolean;
  testID: string;
  children: ReactNode;
  footer?: ReactNode;
  t: Translate;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<TextInstance>(null);

  useEffect(() => {
    if (!visible || Platform.OS === "web") return undefined;
    const timer = setTimeout(() => {
      try {
        const handle = findNodeHandle(titleRef.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      } catch {
        // focus is a courtesy; the sheet works without it
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onBackdrop}
          disabled={!onBackdrop}
          accessible={Boolean(onBackdrop)}
          accessibilityRole="button"
          accessibilityLabel={closeLabel ?? t("common.close")}
          testID={`${testID}-backdrop`}
        />
        <View
          style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: Math.max(16, insets.bottom + 8) }]}
          accessibilityViewIsModal
          testID={testID}
        >
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <Text ref={titleRef} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID={`${testID}-title`}>
              {title}
            </Text>
            {showClose ? (
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={closeLabel ?? t("common.close")}
                hitSlop={6}
                style={[styles.close, { backgroundColor: theme.surfaceSubtle }]}
                testID={`${testID}-close`}
              >
                <Ionicons name="close" size={22} color={theme.textPrimary} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: 18, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 6 },
  title: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  close: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  content: { gap: 12, paddingVertical: 8 },
  footer: { gap: 8, paddingTop: 10 },
});
