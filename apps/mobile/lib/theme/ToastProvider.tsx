import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "./useTheme";
import { R } from "@/components/shared/tokens";

export type ToastVariant = "success" | "error" | "info";

type ToastState = { id: number; variant: ToastVariant; message: string } | null;

type ToastActionsContextValue = { show: (variant: ToastVariant, message: string) => void };

type ToastStateContextValue = { toast: ToastState; dismiss: () => void };

const ToastActionsContext = createContext<ToastActionsContextValue | null>(null);
const ToastStateContext = createContext<ToastStateContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const idRef = useRef(0);

  const show = useCallback((variant: ToastVariant, message: string) => {
    idRef.current += 1;
    setToast({ id: idRef.current, variant, message });
  }, []);

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);

  const actionsValue = useMemo(() => ({ show }), [show]);
  const stateValue = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastActionsContext.Provider value={actionsValue}>
      <ToastStateContext.Provider value={stateValue}>{children}</ToastStateContext.Provider>
    </ToastActionsContext.Provider>
  );
}

export function useToastActions(): ToastActionsContextValue {
  const ctx = useContext(ToastActionsContext);
  if (!ctx) {
    throw new Error("useToastActions must be used within a ToastProvider");
  }
  return ctx;
}

function useToastState(): ToastStateContextValue {
  const ctx = useContext(ToastStateContext);
  if (!ctx) {
    throw new Error("useToastState must be used within a ToastProvider");
  }
  return ctx;
}

const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 3000,
  info: 3000,
  error: 5000,
};

const SWIPE_DISMISS_THRESHOLD = 80;

const VARIANT_ICON: Record<ToastVariant, React.ComponentProps<typeof Ionicons>["name"]> = {
  success: "checkmark-circle",
  error: "alert-circle",
  info: "information-circle",
};

export function ToastViewport({ topOffset }: { topOffset: number }) {
  const theme = useTheme();
  const { toast, dismiss } = useToastState();
  const translateY = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;

  const runExit = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -20, duration: 150, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(({ finished }) => {
      // A new toast interrupting this exit animation stops it with finished=false —
      // in that case a newer toast has already replaced state, so dismiss() must not fire
      // or it would wipe out the toast that just replaced this one.
      if (finished) dismiss();
    });
  }, [translateY, opacity, dismiss]);

  useEffect(() => {
    if (!toast) return;

    translateY.setValue(-20);
    opacity.setValue(0);
    dragX.setValue(0);

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      runExit();
    }, AUTO_DISMISS_MS[toast.variant]);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 4,
      onPanResponderMove: (_evt, gesture) => {
        dragX.setValue(gesture.dx);
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (Math.abs(gesture.dx) > SWIPE_DISMISS_THRESHOLD) {
          runExit();
        } else {
          Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  if (!toast) return null;

  const fill =
    toast.variant === "success"
      ? theme.status.ready
      : toast.variant === "error"
        ? theme.status.dirty
        : theme.shell.bg;

  return (
    <Animated.View
      style={[
        styles.base,
        {
          top: topOffset,
          opacity,
          transform: [{ translateY }, { translateX: dragX }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <View style={[styles.card, { backgroundColor: fill }]}>
        <Ionicons name={VARIANT_ICON[toast.variant]} size={18} color="#FFFFFF" />
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1000,
  },
  card: {
    borderRadius: R.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  message: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
