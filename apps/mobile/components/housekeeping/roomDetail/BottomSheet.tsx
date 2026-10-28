import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "@/lib/accessibility/useReducedMotion";
import { useTheme } from "@/lib/theme/useTheme";
import type { TextInstance, ScrollViewInstance } from "react-native";

export const MAX_FONT_SCALE = 1.6;

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling content (primary buttons). */
  footer?: ReactNode;
  /**
   * When this value changes (and is set), the body scrolls to its end so a field or
   * message that just appeared below the fold is not missed. Forms use it for the
   * time entry that opens after a choice and for the error under it.
   */
  scrollKey?: string | null;
  testID?: string;
  /** Show the small drag handle above the title (Tasks sheets). */
  grabber?: boolean;
  /** Taller sheet for long feeds. */
  tall?: boolean;
  /** Let the person pull the header down to dismiss (opt-in; the body still scrolls normally). */
  dragToDismiss?: boolean;
  /** Pin the sheet's colours (the assistant's sheets are always dark). Defaults to the app theme. */
  palette?: ReturnType<typeof useTheme>;
}

/** How far, or how fast, a downward pull has to be to count as "dismiss". */
const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.9;

/**
 * The one sheet Room Detail uses for Room Information, Linen Exchange, the
 * completion confirmation and Report / More. It respects the safe area and the
 * keyboard, closes from the backdrop and the Android back button, and scrolls
 * rather than clipping under large text.
 */
export function BottomSheet({ visible, title, onClose, children, footer, scrollKey, testID, grabber = false, tall = false, dragToDismiss = false, palette }: Props) {
  const { t } = useTranslation();
  const appTheme = useTheme();
  const theme = palette ?? appTheme;
  const insets = useSafeAreaInsets();
  const titleRef = useRef<TextInstance>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const reduceMotion = useReducedMotion();
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  const pan = useMemo(
    () =>
      dragToDismiss
        ? PanResponder.create({
            onMoveShouldSetPanResponder: (_event, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
            onPanResponderMove: (_event, g) => {
              if (g.dy > 0) dragY.setValue(g.dy);
            },
            onPanResponderRelease: (_event, g) => {
              if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
                onCloseRef.current();
              } else {
                Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
              }
            },
            onPanResponderTerminate: () => {
              Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
            },
          })
        : null,
    [dragToDismiss, dragY],
  );

  useEffect(() => {
    if (!visible || !scrollKey) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [visible, scrollKey]);

  // Screen readers land on the sheet's title, not on whatever is behind it.
  useEffect(() => {
    // findNodeHandle throws on react-native-web; there the browser manages focus.
    if (!visible || Platform.OS === "web") return;
    const timer = setTimeout(() => {
      const node = titleRef.current ? findNodeHandle(titleRef.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 250);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          importantForAccessibility="no"
        />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            tall && styles.sheetTall,
            { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: insets.bottom + 12 },
            dragToDismiss ? { transform: [{ translateY: dragY }] } : null,
          ]}
        >
          <View {...(pan?.panHandlers ?? {})}>
          {grabber ? <View style={[styles.grabber, { backgroundColor: theme.border }]} /> : null}
          <View style={styles.header}>
            <Text
              ref={titleRef}
              accessibilityRole="header"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.title, { color: theme.textPrimary }]}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          </View>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 8,
  },
  sheetTall: { maxHeight: "94%", minHeight: "60%" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, minHeight: 52 },
  title: { flex: 1, fontSize: 18, fontWeight: "900", letterSpacing: -0.2 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
});
